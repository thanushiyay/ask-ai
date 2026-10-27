import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMockOpenAI } from './fixtures/mock-openai.js';

let mock;
let agents;
let createWorld;
let registry;
let createSession;
const script = {
  summary: 'Created the follow-up tasks.',
  plans: [
    {
      match: 'Create a contact named Sarah Lee',
      plan: {
        message: "I'll create the contact.",
        kind: 'execute',
        steps: [
          {
            id: 's1',
            label: 'Create contact',
            action: 'contacts.create',
            args: { firstName: 'Sarah', lastName: 'Lee', email: 'sarah.lee@acme.io' },
          },
        ],
      },
    },
    {
      match: 'Remind all overdue',
      plan: {
        message: 'Sending reminders for invoices 30+ days overdue.',
        kind: 'execute',
        steps: [
          { id: 's1', action: 'invoices.list_overdue', args: { minDaysOverdue: 30 } },
          {
            id: 's2',
            label: 'Send reminders',
            action: 'invoices.send_reminder',
            foreach: '$s1.items',
            args: { invoiceId: '$item.id' },
          },
        ],
      },
    },
    {
      match: 'Text Sarah',
      plan: {
        message: 'Texting Sarah.',
        kind: 'execute',
        steps: [
          { id: 's1', action: 'contacts.search', args: { query: 'Sarah' }, expect: 'one' },
          { id: 's2', action: 'sms.send', args: { contactId: '$s1.item.id', body: 'Hi' } },
        ],
      },
    },
    {
      match: 'Post on Instagram',
      plan: {
        message:
          "I can't post to Instagram — there is no social media integration. I can draft the copy as a campaign email instead.",
        kind: 'unsupported',
        steps: [],
      },
    },
    {
      match: 'Task for webinar leads',
      plan: {
        message: 'Creating tasks.',
        kind: 'execute',
        steps: [
          { id: 's1', action: 'leads.search', args: { source: 'webinar', status: 'new' } },
          {
            id: 's2',
            action: 'tasks.create',
            foreach: '$s1.items',
            args: { title: 'Follow up with {{item.name}}', leadId: '$item.id' },
          },
        ],
      },
    },
    {
      match: 'Automate lead follow-ups',
      plan: (user) =>
        user.includes('some steps failed')
          ? {
              message: 'Publishing the workflow first, then enabling the trigger.',
              kind: 'execute',
              steps: [
                { id: 'r1', action: 'workflows.publish', args: { workflowId: '$s1.id' } },
                { id: 'r2', action: 'triggers.enable', args: { triggerId: '$s2.id' }, after: ['r1'] },
              ],
            }
          : {
              message: "I'll set up an automation for new leads.",
              kind: 'execute',
              steps: [
                {
                  id: 's1',
                  action: 'workflows.create',
                  args: {
                    name: 'New lead follow-up',
                    steps: [{ type: 'create_task', config: { title: 'Follow up' } }],
                  },
                },
                {
                  id: 's2',
                  action: 'triggers.create',
                  args: { name: 'On new lead', eventType: 'lead.created', workflowId: '$s1.id' },
                },
                { id: 's3', action: 'triggers.enable', args: { triggerId: '$s2.triggerId' } },
                { id: 's4', action: 'workflows.publish', args: { workflowId: '$s1.workflowId' } },
              ],
            },
    },
    {
      match: 'Assign those tasks to Omar',
      plan: (user) => {
        const ids = [...user.matchAll(/"id":"(task_\d+)"/g)].map((m) => m[1]);
        return {
          message: 'Assigning to Omar.',
          kind: 'execute',
          steps: [
            { id: 's1', action: 'users.list', args: { query: 'Omar' } },
            { id: 's2', op: 'pluck', from: '$s1.items', path: 'id' },
            ...ids.map((id, i) => ({
              id: `a${i}`,
              action: 'tasks.assign_owner',
              args: { taskId: id, ownerId: '$s2[0]' },
            })),
          ],
        };
      },
    },
  ],
};

beforeAll(async () => {
  mock = await startMockOpenAI(script);
  process.env.OPENAI_API_KEY = 'test';
  process.env.OPENAI_BASE_URL = mock.url;
  process.env.RETRIEVAL = 'bm25';
  ({ createWorld } = await import('../src/core/world.js'));
  ({ createSession } = await import('../src/agent/session.js'));
  registry = await (await import('../src/core/registry.js')).loadRegistry();
  agents = (await import('../src/agent/index.js')).createAgents(registry);
});
afterAll(() => mock?.close());

const run = (session, world, input) => agents.optimized.handle({ session, world, requestId: 'r', ...input });

describe('optimized agent orchestration (mock model)', () => {
  it('direct request: one planner call, template summary, state changed, metrics traced', async () => {
    const world = createWorld();
    const s = createSession();
    const events = [];
    const r = await agents.optimized.handle({
      session: s,
      world,
      requestId: 'r',
      message: 'Create a contact named Sarah Lee with the email sarah.lee@acme.io',
      onEvent: (e) => events.push(e.type),
    });
    const sum = r.trace.finish(r.outcome);
    expect(r.outcome).toBe('completed');
    expect(world.db.find('contacts', (c) => c.email === 'sarah.lee@acme.io')).toHaveLength(1);
    expect(sum.modelCalls).toBe(1);
    expect(sum.costUsd).toBeGreaterThan(0);
    expect(events).toContain('plan_preview');
    expect(sum.firstUsefulMs).not.toBeNull();
  });
  it('pauses for confirmation, then resumes without another planner call', async () => {
    const world = createWorld();
    const s = createSession();
    const first = await run(s, world, { message: 'Remind all overdue invoices older than 30 days' });
    expect(first.outcome).toBe('confirm');
    expect(world.db.find('emails', (e) => e.createdAt === world.clock.nowIso())).toHaveLength(0);
    const before = mock.calls.filter((c) => c.kind === 'plan').length;
    const second = await run(s, world, { confirm: true, message: '' });
    expect(['completed', 'partial']).toContain(second.outcome);
    expect(mock.calls.filter((c) => c.kind === 'plan').length).toBe(before);
    expect(
      world.db.find('emails', (e) => e.status === 'sent' && e.createdAt === world.clock.nowIso()).length,
    ).toBeGreaterThan(0);
  });
  it('repairs steps that fail after approval, and asks again before the new risky steps', async () => {
    const world = createWorld();
    const s = createSession();
    const first = await run(s, world, { message: 'Automate lead follow-ups for me' });
    expect(first.outcome).toBe('confirm');

    const afterApproval = await run(s, world, { confirm: true });
    expect(afterApproval.outcome).toBe('confirm');
    expect(s.pending.preview.map((p) => p.stepId).sort()).toEqual(['r1']);
    expect(world.db.find('triggers', (t) => t.enabled && t.name === 'On new lead')).toHaveLength(0);

    let final = await run(s, world, { confirm: true });
    if (final.outcome === 'confirm') final = await run(s, world, { confirm: true });
    expect(final.outcome).toBe('completed');
    const workflow = world.db.find('workflows', (w) => w.name === 'New lead follow-up')[0];
    expect(workflow.status).toBe('published');
    expect(world.db.find('triggers', (t) => t.name === 'On new lead')[0].enabled).toBe(true);
  });
  it('answers empty messages and stray confirmations without calling the model', async () => {
    const world = createWorld();
    const s = createSession();
    const empty = await run(s, world, { message: '   ' });
    expect(empty.outcome).toBe('answer');
    expect(empty.trace.finish(empty.outcome).modelCalls).toBe(0);
    const stray = await run(s, world, { confirm: true });
    expect(stray.reply).toMatch(/nothing waiting/);
    expect(stray.trace.finish(stray.outcome).modelCalls).toBe(0);
  });
  it('asks a clarifying question for ambiguous names and writes nothing', async () => {
    const world = createWorld();
    const s = createSession();
    const r = await run(s, world, { message: 'Text Sarah that the demo moved' });
    expect(r.outcome).toBe('clarify');
    expect(r.reply).toMatch(/Which one/);
    expect(s.pending.options.length).toBeGreaterThanOrEqual(2);
    expect(world.db.find('sms', (m) => m.createdAt === world.clock.nowIso())).toHaveLength(0);
  });
  it('is honest about unsupported requests', async () => {
    const world = createWorld();
    const s = createSession();
    const r = await run(s, world, { message: 'Post on Instagram about our sale' });
    expect(r.outcome).toBe('unsupported');
    expect(r.trace.actionCalls).toHaveLength(0);
  });
  it('follow-up turns see the records the previous turn created', async () => {
    const world = createWorld();
    const s = createSession();
    await run(s, world, { message: 'Task for webinar leads that are new' });
    const created = world.db.find('tasks', (t) => t.createdAt === world.clock.nowIso());
    expect(created.length).toBeGreaterThan(0);
    const r = await run(s, world, { message: 'Assign those tasks to Omar' });
    expect(r.outcome).toBe('completed');
    expect(created.every((t) => world.db.get('tasks', t.id).ownerId === 'usr_0007')).toBe(true);
  });
});

describe('stopping and cancelling (mock model)', () => {
  it('a request stopped while planning changes nothing and says so', async () => {
    const world = createWorld();
    const s = createSession();
    const controller = new AbortController();
    controller.abort();
    const r = await run(s, world, {
      message: 'Create a contact named Sarah Lee with the email sarah.lee@acme.io',
      signal: controller.signal,
    });
    expect(r.outcome).toBe('cancelled');
    expect(r.reply).toMatch(/nothing was changed/i);
    expect(world.db.find('contacts', (c) => c.email === 'sarah.lee@acme.io')).toHaveLength(0);
    expect(s.busy).toBeFalsy();
  });

  it('baseline mode handles the Cancel button without calling the model', async () => {
    const world = createWorld();
    const s = createSession();
    const before = mock.calls.length;
    const r = await agents.baseline.handle({ session: s, world, requestId: 'r', cancel: true });
    expect(r.outcome).toBe('cancelled');
    expect(mock.calls.length).toBe(before);
  });
});
