import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { createWorld, handlerContext } from '../src/core/world.js';
import { Executor } from '../src/agent/execution/index.js';
import { Trace } from '../src/agent/trace.js';

// Plans written the way the model actually wrote them in live sessions, slips included.
// Each must reach the correct final data state, computed independently from the seed.
const registry = await loadRegistry();
const NOW = '2026-10-26T05:00:00.000Z';

function setup() {
  const world = createWorld({ now: NOW });
  const trace = new Trace({ agent: 'test', requestId: 't', message: '' });
  return {
    world,
    cal: world.clock.calendar(),
    ex: new Executor({ registry, ctx: handlerContext(world), trace }),
  };
}

describe('conditional reminders, as the model wrote them', () => {
  it('handles contact.id paths and drafts without naming a template', async () => {
    const { world, cal, ex } = setup();
    const run = await ex.run({
      steps: [
        { id: 's1', action: 'invoices.search', args: { unpaid: true, minDaysOverdue: 16 } },
        { id: 's2', op: 'pluck', from: '$s1.items', path: 'contact.id' },
        {
          id: 's3',
          action: 'email.search',
          args: { contactIds: '$s2', category: 'invoice_reminder', sentFrom: cal.thisWeek.from },
        },
        { id: 's4', op: 'pluck', from: '$s3.items', path: 'contact.id' },
        { id: 's5', op: 'exclude', from: '$s1.items', key: 'contact.id', values: '$s4' },
        {
          id: 's6',
          action: 'email.draft',
          foreach: '$s5',
          args: { contactId: '$item.contact.id', invoiceId: '$item.id', category: 'invoice_reminder' },
        },
      ],
    });
    expect(run.status).toBe('completed');
    const reminded = new Set(
      world.db
        .find('emails', (e) => e.category === 'invoice_reminder' && e.sentAt >= cal.thisWeek.from)
        .map((e) => e.contactId),
    );
    const expected = run.state.results.s1.items.filter((i) => !reminded.has(i.contactId)).map((i) => i.id);
    const drafted = run.state.results.s6.items.map((d) => d.invoiceId);
    expect(expected.length).toBeGreaterThan(0);
    expect(new Set(drafted)).toEqual(new Set(expected));
    expect(
      world.db.find('emails', (e) => e.status === 'sent' && e.createdAt === world.clock.nowIso()),
    ).toHaveLength(0);
  });
});

describe('complex lead workflow, as the model wrote it', () => {
  it('handles a single-ID filter given a list and op results referenced like search results', async () => {
    const { world, cal, ex } = setup();
    const run = await ex.run(
      {
        steps: [
          {
            id: 's1',
            action: 'leads.search',
            args: { createdFrom: cal.lastWeek.from, createdTo: cal.lastWeek.to },
          },
          {
            id: 's2',
            action: 'conversations.search',
            args: { contactId: '$s1.items[*].contactId', hasInbound: true },
          },
          { id: 's3', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
          {
            id: 's4',
            action: 'appointments.search',
            args: { contactIds: '$s3.items[*].contactId', status: 'booked' },
          },
          { id: 's5', op: 'exclude', from: '$s3.items', key: 'contactId', values: '$s4.items[*].contact.id' },
          { id: 's6', action: 'users.list', args: { role: 'sales_rep', availableNow: true } },
          { id: 's7', op: 'distribute', from: '$s5', pool: '$s6.items', poolKey: 'userId', as: 'ownerId' },
          {
            id: 's8',
            action: 'leads.assign_owner',
            foreach: '$s7',
            args: { leadId: '$item.id', ownerId: '$item.ownerId' },
          },
          {
            id: 's9',
            action: 'tasks.create',
            foreach: '$s7',
            args: { title: 'Follow up with {{item.name}}', leadId: '$item.id', ownerId: '$item.ownerId' },
          },
        ],
      },
      { approved: true },
    );
    expect(run.status).toBe('completed');
    const replied = new Set(world.db.find('conversations', (c) => c.hasInbound).map((c) => c.contactId));
    const booked = new Set(
      world.db.find('appointments', (a) => a.status === 'booked').map((a) => a.contactId),
    );
    const eligible = run.state.results.s1.items.filter(
      (l) => !replied.has(l.contactId) && !booked.has(l.contactId),
    );
    expect(run.state.results.s9.items).toHaveLength(eligible.length);
    expect(run.state.results.s8.items.every((l) => l.ownerId && l.ownerId !== 'usr_0006')).toBe(true);
  });
});

describe('follow-up on the created tasks, as the model wrote it', () => {
  it('finds the tasks of several leads through a single-ID filter given a list', async () => {
    const { world, ex } = setup();
    const leads = world.db.col('leads').slice(0, 3);
    const created = await ex.run({
      steps: [
        {
          id: 's1',
          action: 'tasks.create',
          foreach: leads,
          args: { title: 'Follow up', leadId: '$item.id' },
        },
      ],
    });
    const run = await ex.run({
      steps: [
        { id: 's1', action: 'tasks.search', args: { leadId: leads.map((l) => l.id), status: 'open' } },
        {
          id: 's2',
          op: 'filter',
          from: '$s1.items',
          where: [{ path: 'title', op: 'eq', value: 'Follow up' }],
        },
      ],
    });
    expect(run.state.results.s2.map((t) => t.id).sort()).toEqual(
      created.state.results.s1.items.map((t) => t.id).sort(),
    );
  });
});

describe('covering for a rep who is out, as the model wrote it', () => {
  it('reassigns her open tasks and leads using its own parameter names', async () => {
    const { world, ex } = setup();
    const run = await ex.run(
      {
        steps: [
          { id: 's1', action: 'users.list', args: { query: 'Hannah' }, expect: 'one' },
          { id: 's2', action: 'tasks.search', args: { assigneeId: '$s1.item.id', status: 'open' } },
          { id: 's3', action: 'leads.search', args: { ownerId: '$s1.item.id', status: 'open' } },
          { id: 's4', action: 'users.list', args: { role: 'sales_rep', availableNow: true } },
          { id: 's5', op: 'distribute', from: '$s2.items', pool: '$s4.items', as: 'newOwner' },
          { id: 's6', op: 'distribute', from: '$s3.items', pool: '$s4.items', as: 'newOwner' },
          {
            id: 's7',
            action: 'tasks.assign_owner',
            foreach: '$s5',
            args: { taskId: '$item.id', ownerId: '$item.newOwner' },
          },
          {
            id: 's8',
            action: 'leads.assign_owner',
            foreach: '$s6',
            args: { leadId: '$item.id', ownerId: '$item.newOwner' },
          },
        ],
      },
      { approved: true },
    );
    expect(run.status).toBe('completed');
    expect(run.state.results.s2.total).toBeGreaterThan(0);
    expect(world.db.find('tasks', (t) => t.ownerId === 'usr_0006' && t.status === 'open')).toHaveLength(0);
    expect(
      world.db.find('leads', (l) => l.ownerId === 'usr_0006' && l.status !== 'disqualified'),
    ).toHaveLength(0);
  });
});
