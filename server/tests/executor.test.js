import { describe, it, expect } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { createWorld, handlerContext } from '../src/core/world.js';
import { Executor, resolveValue, runOp, validatePlan } from '../src/agent/execution/index.js';
import { Trace } from '../src/agent/trace.js';

const registry = await loadRegistry();
const setup = () => {
  const world = createWorld();
  const trace = new Trace({ agent: 'test', requestId: 't', message: '' });
  return {
    world,
    trace,
    ex: new Executor({ registry, ctx: handlerContext(world), trace, bulkThreshold: 10 }),
  };
};

describe('reference resolution', () => {
  const scope = {
    results: {
      s1: {
        items: [
          { id: 'a', contactId: 'c1', name: 'Ann' },
          { id: 'b', contactId: 'c2', name: 'Bob' },
        ],
        total: 2,
      },
    },
    item: { name: 'Zed', id: 'z' },
  };
  it('resolves list paths, single items and templates', () => {
    expect(resolveValue('$s1.items[*].contactId', scope)).toEqual(['c1', 'c2']);
    expect(resolveValue('$s1.items.contactId', scope)).toEqual(['c1', 'c2']);
    expect(resolveValue('$s1.items[1].name', scope)).toBe('Bob');
    expect(resolveValue('Follow up with {{item.name}}', scope)).toBe('Follow up with Zed');
    expect(resolveValue({ ids: '$s1.items[*].id', n: '$s1.total' }, scope)).toEqual({
      ids: ['a', 'b'],
      n: 2,
    });
  });
  it('runs set operations', () => {
    expect(
      runOp({ op: 'exclude', from: '$s1.items', key: 'contactId', values: ['c1'] }, scope).map((x) => x.id),
    ).toEqual(['b']);
    expect(
      runOp({ op: 'distribute', from: '$s1.items', pool: ['u1', 'u2'], as: 'ownerId' }, scope).map(
        (x) => x.ownerId,
      ),
    ).toEqual(['u1', 'u2']);
    expect(
      runOp({ op: 'filter', from: '$s1.items', where: [{ path: 'name', op: 'eq', value: 'ann' }] }, scope),
    ).toHaveLength(1);
  });
  it('rejects invalid plans', () => {
    expect(validatePlan({ steps: [{ id: 's1', action: 'nope.nothing' }] }, registry)[0]).toMatch(
      /unknown action/,
    );
    expect(
      validatePlan(
        {
          steps: [
            { id: 'a', op: 'count', from: '$b' },
            { id: 'b', op: 'count', from: '$a' },
          ],
        },
        registry,
      ).join(),
    ).toMatch(/cycle/);
  });
});

describe('use case: complex lead follow-up workflow', () => {
  it('finds last-week leads without replies or booked appointments, assigns available reps, creates tasks', async () => {
    const { world, ex } = setup();
    const cal = world.clock.calendar();
    const plan = {
      steps: [
        {
          id: 's1',
          action: 'leads.search',
          args: { createdFrom: cal.lastWeek.from, createdTo: cal.lastWeek.to, limit: 200 },
        },
        {
          id: 's2',
          action: 'conversations.search',
          args: { contactIds: '$s1.items[*].contactId', hasInbound: true, limit: 200 },
        },
        {
          id: 's3',
          action: 'appointments.search',
          args: { contactIds: '$s1.items[*].contactId', status: 'booked', limit: 200 },
        },
        { id: 's4', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
        { id: 's5', op: 'exclude', from: '$s4', key: 'contactId', values: '$s3.items[*].contactId' },
        { id: 's6', action: 'teams.workload', args: {} },
        {
          id: 's7',
          op: 'filter',
          from: '$s6.members',
          where: [{ path: 'available', op: 'eq', value: true }],
        },
        {
          id: 's8',
          op: 'distribute',
          from: '$s5',
          pool: '$s7',
          poolKey: 'userId',
          as: 'ownerId',
          strategy: 'least_loaded',
          loadKey: 'openTasks',
        },
        {
          id: 's9',
          action: 'leads.assign_owner',
          foreach: '$s8',
          args: { leadId: '$item.id', ownerId: '$item.ownerId' },
        },
        {
          id: 's10',
          action: 'tasks.create',
          foreach: '$s8',
          args: {
            title: 'Follow up with {{item.name}}',
            leadId: '$item.id',
            ownerId: '$item.ownerId',
            dueDate: `${cal.tomorrow}T17:00:00.000Z`,
            type: 'follow_up',
          },
        },
      ],
    };
    const run = await ex.run(plan);
    expect(run.status).toBe('completed');

    const db = world.db;
    const lw = db.find('leads', (l) => l.createdAt >= cal.lastWeek.from && l.createdAt < cal.lastWeek.to);
    const replied = new Set(db.find('conversations', (c) => c.hasInbound).map((c) => c.contactId));
    const booked = new Set(db.find('appointments', (a) => a.status === 'booked').map((a) => a.contactId));
    const eligible = lw.filter((l) => !replied.has(l.contactId) && !booked.has(l.contactId));
    expect(eligible.length).toBeGreaterThan(3);
    const newTasks = db.find('tasks', (t) => t.createdAt === world.clock.nowIso() && t.type === 'follow_up');
    expect(new Set(newTasks.map((t) => t.relatedTo.id))).toEqual(new Set(eligible.map((l) => l.id)));
    const unavailable = db
      .find('users', (u) => ['Hannah Kim', 'Diego Alvarez'].includes(u.name))
      .map((u) => u.id);
    expect(newTasks.every((t) => t.ownerId && !unavailable.includes(t.ownerId))).toBe(true);
    expect(eligible.every((l) => db.get('leads', l.id).ownerId)).toBe(true);
  });
});

describe('use case: conditional invoice reminders', () => {
  it('drafts reminders for >15 days overdue, skipping customers reminded this week', async () => {
    const { world, ex } = setup();
    const cal = world.clock.calendar();
    const plan = {
      steps: [
        { id: 's1', action: 'invoices.list_overdue', args: { minDaysOverdue: 16 } },
        {
          id: 's2',
          action: 'email.search',
          args: {
            category: 'invoice_reminder',
            sentFrom: cal.thisWeek.from,
            contactIds: '$s1.items[*].contactId',
          },
        },
        { id: 's3', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
        { id: 's4', action: 'templates.search', args: { query: 'invoice', channel: 'email' }, expect: 'one' },
        {
          id: 's5',
          action: 'email.draft',
          foreach: '$s3',
          args: { contactId: '$item.contactId', invoiceId: '$item.id', templateId: '$s4.item.id' },
        },
      ],
    };
    const run = await ex.run(plan);
    expect(run.status).toBe('completed');
    const db = world.db;
    const remindedThisWeek = new Set(
      db
        .find('emails', (e) => e.category === 'invoice_reminder' && e.sentAt >= cal.thisWeek.from)
        .map((e) => e.contactId),
    );
    const expected = db.find(
      'invoices',
      (i) =>
        i.status === 'issued' &&
        i.balance > 0 &&
        (world.clock.now() - new Date(i.dueDate)) / 864e5 > 15 &&
        !remindedThisWeek.has(i.contactId),
    );
    const drafts = db.find('emails', (e) => e.status === 'draft' && e.category === 'invoice_reminder');
    expect(new Set(drafts.map((d) => d.invoiceId))).toEqual(new Set(expected.map((i) => i.id)));
    expect(drafts.every((d) => d.body.includes('was due on'))).toBe(true);
    expect(
      db.find('emails', (e) => e.status === 'sent' && e.createdAt === world.clock.nowIso()),
    ).toHaveLength(0);
  });
});

describe('safety: confirmation and clarification', () => {
  it('pauses before externally visible steps and resumes once approved', async () => {
    const { world, ex } = setup();
    const plan = {
      steps: [
        { id: 's1', action: 'invoices.list_overdue', args: { minDaysOverdue: 30 } },
        { id: 's2', action: 'invoices.send_reminder', foreach: '$s1.items', args: { invoiceId: '$item.id' } },
      ],
    };
    const first = await ex.run(plan);
    expect(first.status).toBe('awaiting_confirmation');
    expect(first.pending[0].count).toBeGreaterThan(0);
    expect(world.db.find('emails', (e) => e.createdAt === world.clock.nowIso())).toHaveLength(0);
    const second = await ex.run(plan, { ...first.state, approved: true });
    expect(['completed', 'partial']).toContain(second.status);
    expect(
      world.db.find('emails', (e) => e.status === 'sent' && e.createdAt === world.clock.nowIso()).length,
    ).toBe(second.state.results.s2.items.length);
  });
  it('asks which record when a name lookup is ambiguous', async () => {
    const { ex } = setup();
    const run = await ex.run({
      steps: [
        { id: 's1', action: 'contacts.search', args: { query: 'Sarah' }, expect: 'one' },
        { id: 's2', action: 'tasks.create', args: { title: 'Call', contactId: '$s1.item.id' } },
      ],
    });
    expect(run.status).toBe('needs_clarification');
    expect(run.clarification.options.length).toBeGreaterThanOrEqual(2);
  });
  it('reports business-rule failures instead of fake success', async () => {
    const { world, ex } = setup();
    const paid = world.db.findOne('invoices', (i) => i.status === 'paid');
    const run = await ex.run(
      { steps: [{ id: 's1', action: 'invoices.void', args: { invoiceId: paid.id } }] },
      { approved: true },
    );
    expect(run.status).toBe('failed');
    expect(run.state.errors.s1.code).toBe('INVALID_STATE');
    expect(world.db.get('invoices', paid.id).status).toBe('paid');
  });
});

describe('references and ordering', () => {
  const automation = (extra = {}) => [
    {
      id: 's1',
      action: 'workflows.create',
      args: { name: 'Lead follow-up', steps: [{ type: 'create_task', config: { title: 'Follow up' } }] },
    },
    {
      id: 's2',
      action: 'triggers.create',
      args: { name: 'On new lead', eventType: 'lead.created', workflowId: '$s1.id' },
    },
    { id: 's3', action: 'workflows.publish', args: { workflowId: '$s1.item.id' } },
    { id: 's4', action: 'triggers.enable', args: { triggerId: '$s2.id' }, ...extra },
  ];

  it('runs a step after one it does not reference when "after" is given', async () => {
    const { world, ex } = setup();
    const run = await ex.run({ steps: automation({ after: ['s3'] }) }, { approved: true });
    expect(run.status).toBe('completed');
    expect(world.db.find('triggers', (t) => t.name === 'On new lead')[0].enabled).toBe(true);
  });

  it('treats $sX.item on a single record as the record itself', async () => {
    const { world, ex } = setup();
    await ex.run({ steps: automation({ after: ['s3'] }) }, { approved: true });
    expect(world.db.find('workflows', (w) => w.name === 'Lead follow-up')[0].status).toBe('published');
  });

  it('fails clearly when a reference does not resolve, naming the fields that exist', async () => {
    const { ex } = setup();
    const steps = automation();
    steps[3] = { id: 's4', action: 'triggers.enable', args: { triggerId: '$s2.triggerId' }, after: ['s3'] };
    const run = await ex.run({ steps }, { approved: true });
    expect(run.state.status.s4).toBe('failed');
    expect(run.state.errors.s4.code).toBe('VALIDATION');
    expect(run.state.errors.s4.message).toMatch(
      /\$s2\.triggerId did not resolve; step s2 returned fields .*\bid\b/,
    );
  });

  it('rejects "after" pointing at a step that does not exist', () => {
    const problems = validatePlan(
      { steps: [{ id: 's1', action: 'tasks.search', args: {}, after: ['s9'] }] },
      registry,
    );
    expect(problems.join()).toMatch(/unknown step s9/);
  });
});

describe('op results used like search results', () => {
  it('resolves $sX.items and $sX.total on a plain list from an op step', async () => {
    const { world, ex } = setup();
    const cal = world.clock.calendar();
    const plan = {
      steps: [
        {
          id: 's1',
          action: 'leads.search',
          args: { createdFrom: cal.lastWeek.from, createdTo: cal.lastWeek.to },
        },
        {
          id: 's2',
          action: 'conversations.search',
          args: { contactIds: '$s1.items[*].contactId', hasInbound: true },
        },
        { id: 's3', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
        {
          id: 's4',
          action: 'appointments.search',
          args: { contactIds: '$s3.items[*].contactId', status: 'booked' },
        },
        { id: 's5', op: 'exclude', from: '$s3.items', key: 'contactId', values: '$s4.items[*].contactId' },
      ],
    };
    const run = await ex.run(plan);
    expect(run.state.results.s3.length).toBeGreaterThan(0);
    expect(run.state.results.s4.items.length).toBeGreaterThan(0);
    expect(run.state.results.s5.length).toBe(
      run.state.results.s3.length - new Set(run.state.results.s4.items.map((a) => a.contactId)).size,
    );
    expect(resolveValue('$s3.total', { results: run.state.results })).toBe(run.state.results.s3.length);
  });
});

describe('write ordering and confirmation scope', () => {
  const startOrder = (trace) => trace.events.filter((e) => e.type === 'step_start').map((e) => e.stepId);

  it('runs independent writes in plan order, without letting a failed write block later ones', async () => {
    const { ex, trace, world } = setup();
    const run = await ex.run({
      steps: [
        { id: 'w1', action: 'tasks.create', args: { title: 'First' } },
        { id: 'w2', action: 'tasks.create', args: { title: '' } }, // fails validation
        { id: 'w3', action: 'tasks.create', args: { title: 'Third' } },
      ],
    });
    expect(startOrder(trace)).toEqual(['w1', 'w2', 'w3']);
    expect(run.state.status).toMatchObject({ w1: 'completed', w2: 'failed', w3: 'completed' });
    expect(world.db.find('tasks', (t) => t.title === 'Third')).toHaveLength(1);
  });

  it('previews independent risky writes together in one confirmation', async () => {
    const { ex } = setup();
    const run = await ex.run({
      steps: [
        { id: 'c1', action: 'tasks.cancel', args: { taskId: 'task_0001' } },
        { id: 'c2', action: 'tasks.cancel', args: { taskId: 'task_0002' } },
      ],
    });
    expect(run.status).toBe('awaiting_confirmation');
    expect(run.pending.map((p) => p.stepId)).toEqual(['c1', 'c2']);
  });

  it('only runs the risky steps that were approved', async () => {
    const { ex, world } = setup();
    const steps = [
      { id: 'c1', action: 'tasks.cancel', args: { taskId: 'task_0001' } },
      { id: 'c2', action: 'tasks.cancel', args: { taskId: 'task_0002' }, after: ['c1'] },
    ];
    const first = await ex.run({ steps });
    expect(first.pending.map((p) => p.stepId)).toEqual(['c1']);
    const second = await ex.run({ steps }, { ...first.state, approvedSteps: ['c1'] });
    expect(second.status).toBe('awaiting_confirmation');
    expect(second.pending.map((p) => p.stepId)).toEqual(['c2']);
    expect(world.db.get('tasks', 'task_0001').status).toBe('cancelled');
    expect(world.db.get('tasks', 'task_0002').status).not.toBe('cancelled');
  });
});
