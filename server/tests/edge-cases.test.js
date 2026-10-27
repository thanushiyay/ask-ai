import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { createWorld, handlerContext } from '../src/core/world.js';
import { Executor, resolveRef, runOp, validatePlan } from '../src/agent/execution/index.js';
import { Trace } from '../src/agent/trace.js';
import { templateSummary } from '../src/agent/summarizer.js';
import { writtenRecords } from '../src/agent/session.js';

const registry = await loadRegistry();

function setup() {
  const world = createWorld();
  const ctx = handlerContext(world);
  const trace = new Trace({ agent: 'test', requestId: 't', message: '' });
  return { world, ctx, trace, ex: new Executor({ registry, ctx, trace, bulkThreshold: 10 }) };
}

describe('argument repair: lossless fixes for common model slips', () => {
  it('unwraps a one-item array where a single ID is expected', async () => {
    const { world, ctx } = setup();
    const contactId = world.db.col('contacts')[0].id;
    const res = await registry.invoke('tasks.create', { title: 'Call back', contactId: [contactId] }, ctx);
    expect(res.ok).toBe(true);
    expect(res.result.contactId).toBe(contactId);
    expect(res.repairs).toEqual(['contactId']);
  });

  it('wraps a single value where a list is expected', async () => {
    const { world, ctx } = setup();
    const contactId = world.db.col('invoices')[0].contactId;
    const res = await registry.invoke('invoices.search', { contactIds: contactId }, ctx);
    expect(res.ok).toBe(true);
    expect(res.result.items.every((i) => i.contactId === contactId)).toBe(true);
  });

  it('converts numbers sent as strings and matches enum values regardless of case', async () => {
    const { ctx } = setup();
    const search = await registry.invoke('leads.search', { limit: '3' }, ctx);
    expect(search.ok).toBe(true);
    expect(search.result.items).toHaveLength(3);
    const task = await registry.invoke('tasks.create', { title: 'Urgent call', priority: 'High' }, ctx);
    expect(task.ok).toBe(true);
    expect(task.result.priority).toBe('high');
  });

  it('moves a list sent to a single-ID field into its plural sibling', async () => {
    const { world, ctx } = setup();
    const ids = world.db
      .col('contacts')
      .slice(0, 14)
      .map((c) => c.id);
    const res = await registry.invoke('conversations.search', { contactId: ids, hasInbound: true }, ctx);
    expect(res.ok).toBe(true);
    expect(res.repairs).toEqual(['contactId → contactIds']);
    expect(res.result.items.every((c) => ids.includes(c.contactId))).toBe(true);
  });

  it('treats null for an optional field as not provided', async () => {
    const { ctx } = setup();
    const res = await registry.invoke('conversations.search', { contactId: null, hasInbound: true }, ctx);
    expect(res.ok).toBe(true);
    expect(res.result.items.every((c) => c.hasInbound)).toBe(true);
  });

  it('still rejects input it cannot safely repair, naming the field', async () => {
    const { ctx } = setup();
    const res = await registry.invoke('tasks.create', { title: '', priority: 'whenever' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION');
    expect(res.error.message).toMatch(/title|priority/);
  });
});

describe('reference resolution: tolerant of result shapes', () => {
  const results = {
    s1: { id: 'con_1', name: 'Sarah' },
    s2: { items: [{ id: 'con_9', name: 'Omar' }], total: 1 },
    s3: { items: [{ id: 'a' }, { id: 'b' }], total: 2 },
    s4: [{ contactId: 'x' }, { contactId: 'y' }],
  };
  const scope = { results };

  it.each([
    ['$s1.id', 'con_1'],
    ['$s1.result.id', 'con_1'],
    ['$s1.data.name', 'Sarah'],
    ['$s1.item.id', 'con_1'],
    ['$s2.id', 'con_9'],
    ['$s2.item.id', 'con_9'],
    ['$s2.items[0].id', 'con_9'],
    ['$s4.items[*].contactId', ['x', 'y']],
    ['$s4.total', 2],
  ])('%s', (expr, expected) => {
    expect(resolveRef(expr, scope)).toEqual(expected);
  });

  it('does not guess when a search matched several records', () => {
    expect(resolveRef('$s3.id', scope)).toBeUndefined();
  });
});

describe('data ops: fail loudly instead of silently dropping records', () => {
  const leads = [
    { id: 'l1', contactId: 'c1', source: 'facebook' },
    { id: 'l2', contactId: 'c2', source: 'google' },
  ];
  const scope = { results: { s1: leads, s2: [{ contactId: 'c1' }] } };

  it('rejects a filter on a field no item has', () => {
    expect(() =>
      runOp({ op: 'filter', from: '$s1', where: [{ path: 'channel', op: 'eq', value: 'facebook' }] }, scope),
    ).toThrow(/none of the 2 items has "channel"; available fields: id, contactId, source/);
  });

  it('allows absence checks on missing fields', () => {
    expect(
      runOp({ op: 'filter', from: '$s1', where: [{ path: 'ownerId', op: 'exists', value: false }] }, scope),
    ).toHaveLength(2);
  });

  it('rejects an exclude keyed on a field the values do not have', () => {
    expect(() =>
      runOp({ op: 'exclude', from: '$s1', key: 'contactId', values: '$s2', valuesKey: 'id' }, scope),
    ).toThrow(/none of the 1 values has "id"/);
  });

  it('rejects an op whose input reference does not resolve', () => {
    expect(() => runOp({ op: 'exclude', from: '$s9', key: 'id', values: [] }, scope)).toThrow(/\$s9/);
  });

  it('assigns by id when the pool key is missing, and does nothing when there is nothing to assign', () => {
    const pool = [{ id: 'usr_1' }, { id: 'usr_2' }];
    const assigned = runOp({ op: 'distribute', from: '$s1', pool, poolKey: 'userId', as: 'ownerId' }, scope);
    expect(assigned.map((x) => x.ownerId)).toEqual(['usr_1', 'usr_2']);
    expect(runOp({ op: 'distribute', from: [], pool: [], as: 'ownerId' }, scope)).toEqual([]);
  });
});

describe('execution: complete result sets and helpful plan errors', () => {
  it('fetches every match when later steps depend on a search, not just the first 50', async () => {
    const { world, ex } = setup();
    const total = world.db.col('contacts').filter((c) => !c.archived).length;
    expect(total).toBeGreaterThan(50);
    const run = await ex.run({ steps: [{ id: 's1', action: 'contacts.search', args: {} }] });
    expect(run.state.results.s1.items.length).toBe(run.state.results.s1.total);
  });

  it('respects an explicit limit', async () => {
    const { ex } = setup();
    const run = await ex.run({ steps: [{ id: 's1', action: 'contacts.search', args: { limit: 5 } }] });
    expect(run.state.results.s1.items).toHaveLength(5);
  });

  it('suggests the closest real action for a misspelled one', () => {
    const problems = validatePlan({ steps: [{ id: 's1', action: 'contact.create', args: {} }] }, registry);
    expect(problems[0]).toMatch(/did you mean contacts\.create/);
  });
});

describe('fallback answers', () => {
  it('answers a data question with the actual records, not just counts', async () => {
    const { world, ex } = setup();
    const sarah = world.db.find('contacts', (c) => `${c.firstName} ${c.lastName}` === 'Sarah Johnson')[0];
    const plan = {
      steps: [
        { id: 's1', label: 'Open deals', action: 'opportunities.search', args: { contactId: sarah.id } },
        {
          id: 's2',
          label: 'Unpaid invoices',
          action: 'invoices.search',
          args: { contactId: sarah.id, unpaid: true },
        },
      ],
    };
    const run = await ex.run(plan);
    const reply = templateSummary(registry, plan, run);
    expect(reply.startsWith("Here's what I found:")).toBe(true);
    expect(reply).not.toMatch(/\d+ found/);
    const deal = run.state.results.s1.items[0];
    if (deal) expect(reply).toContain(deal.name);
  });
});

describe('workflow steps are validated when written', () => {
  it('rejects a wait step without a duration at creation, naming the missing setting', async () => {
    const { ctx } = setup();
    const res = await registry.invoke(
      'workflows.create',
      {
        name: 'Lead nurture',
        steps: [
          { type: 'wait', config: {} },
          { type: 'create_task', config: { title: 'Call' } },
        ],
      },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION');
    expect(res.error.message).toMatch(/Step 1 \(wait\) needs config\.days or config\.hours/);
  });

  it('accepts a complete workflow that can then be published', async () => {
    const { ctx } = setup();
    const created = await registry.invoke(
      'workflows.create',
      {
        name: 'Lead nurture',
        steps: [
          { type: 'wait', config: { days: 1 } },
          { type: 'create_task', config: { title: 'Follow up with the new lead', dueInDays: 1 } },
        ],
      },
      ctx,
    );
    expect(created.ok).toBe(true);
    const published = await registry.invoke('workflows.publish', { workflowId: created.result.id }, ctx);
    expect(published.ok).toBe(true);
  });

  it('rejects an incomplete step added later', async () => {
    const { ctx } = setup();
    const created = await registry.invoke(
      'workflows.create',
      { name: 'Tagging', steps: [{ type: 'create_task', config: { title: 'Review' } }] },
      ctx,
    );
    const res = await registry.invoke(
      'workflows.add_step',
      { workflowId: created.result.id, type: 'add_tag' },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(/Step 2 \(add_tag\) needs config\.tag/);
  });
});

describe('follow-ups on records the previous turn created', () => {
  it('finds tasks for many leads at once', async () => {
    const { world, ctx } = setup();
    const leads = world.db.col('leads').slice(0, 3);
    for (const lead of leads)
      await registry.invoke('tasks.create', { title: 'Follow up', leadId: lead.id }, ctx);
    const res = await registry.invoke('tasks.search', { leadIds: leads.slice(0, 2).map((l) => l.id) }, ctx);
    expect(res.ok).toBe(true);
    expect(res.result.total).toBe(2);
  });

  it('gives every generated search a list version of its ID filters', async () => {
    const { world, ctx } = setup();
    const contactIds = [...new Set(world.db.col('opportunities').map((o) => o.contactId))].slice(0, 2);
    const res = await registry.invoke('opportunities.search', { contactIds }, ctx);
    expect(res.ok).toBe(true);
    expect(res.result.items.every((o) => contactIds.includes(o.contactId))).toBe(true);
  });

  it('keeps the lead each created task belongs to in the conversation context', async () => {
    const { world, ex } = setup();
    const lead = world.db.col('leads')[0];
    const plan = {
      steps: [{ id: 's1', action: 'tasks.create', args: { title: 'Follow up', leadId: lead.id } }],
    };
    const run = await ex.run(plan);
    const [written] = writtenRecords(registry, plan, run.state);
    expect(written.records[0].relatedTo).toEqual({ id: lead.id, type: 'lead' });
  });
});

describe('workflow and paging inputs in everyday formats', () => {
  it.each([
    [{ delayDays: 2 }, { days: 2 }],
    [{ duration: '2d' }, { days: 2 }],
    [{ delay: '48 hours' }, { hours: 48 }],
    [{ after: '1 week' }, { days: 7 }],
    [{ days: '2' }, { days: 2 }],
  ])('reads wait %j as %j', async (config, expected) => {
    const { ctx } = setup();
    const res = await registry.invoke(
      'workflows.create',
      {
        name: `Wait ${JSON.stringify(config)}`,
        steps: [
          { type: 'wait', config },
          { type: 'create_task', config: { title: 'Call' } },
        ],
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.result.steps[0].config).toEqual(expected);
  });

  it('caps a page size above the maximum instead of failing', async () => {
    const { ctx } = setup();
    const res = await registry.invoke('email.search', { category: 'invoice_reminder', limit: 1000 }, ctx);
    expect(res.ok).toBe(true);
    expect(res.repairs).toEqual(['limit']);
  });
});

describe('parameter names the action does not declare', () => {
  it.each([
    ['appointments.search', { ownerId: 'usr_0006' }, 'ownerId → hostId'],
    ['tasks.search', { assigneeId: 'usr_0006' }, 'assigneeId → ownerId'],
    ['tasks.search', { assigned_to: 'usr_0006' }, 'assigned_to → ownerId'],
    ['opportunities.search', { customerId: 'con_0061' }, 'customerId → contactId'],
  ])('%s maps %j', async (id, args, rename) => {
    const { ctx } = setup();
    const res = await registry.invoke(id, args, ctx);
    expect(res.ok).toBe(true);
    expect(res.repairs).toContain(rename);
  });

  it('applies the mapped filter instead of silently dropping it', async () => {
    const { world, ctx } = setup();
    const res = await registry.invoke('appointments.search', { ownerId: 'usr_0006' }, ctx);
    const expected = world.db.find('appointments', (a) => a.hostId === 'usr_0006').length;
    expect(res.result.total).toBe(expected);
  });

  it('rejects a parameter it cannot map, listing the valid ones', async () => {
    const { ctx } = setup();
    const res = await registry.invoke('tasks.search', { colour: 'red' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error.message).toMatch(
      /Unknown parameter colour for tasks\.search; valid parameters: .*ownerId/,
    );
  });

  it('reads status "open" as every status that is not closed', async () => {
    const { world, ctx } = setup();
    const res = await registry.invoke('leads.search', { status: 'open' }, ctx);
    expect(res.ok).toBe(true);
    const open = world.db.find('leads', (l) => ['new', 'contacted', 'qualified'].includes(l.status)).length;
    expect(res.result.total).toBe(open);
  });
});
