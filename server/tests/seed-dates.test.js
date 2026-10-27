import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { createWorld, handlerContext } from '../src/core/world.js';
import { Executor } from '../src/agent/execution/index.js';
import { Trace } from '../src/agent/trace.js';

const registry = await loadRegistry();

// The app runs on the real date, so the planted demo cases must exist on any day and at any hour.
const DATES = [
  '2026-10-26T04:40:00.000Z',
  '2026-10-25T23:50:00.000Z',
  '2026-10-31T09:00:00.000Z',
  '2026-11-04T12:00:00.000Z',
  '2027-02-01T00:05:00.000Z',
];

describe.each(DATES)('sample data generated for %s', (now) => {
  it('keeps every planted demo case', async () => {
    const world = createWorld({ now });
    const cal = world.clock.calendar();
    const ex = new Executor({
      registry,
      ctx: handlerContext(world),
      trace: new Trace({ agent: 'test', requestId: 't', message: '' }),
    });
    const run = await ex.run({
      steps: [
        {
          id: 'leads',
          action: 'leads.search',
          args: { createdFrom: cal.lastWeek.from, createdTo: cal.lastWeek.to },
        },
        { id: 'reps', action: 'users.list', args: { role: 'sales_rep', availableNow: true } },
        { id: 'overdue', action: 'invoices.list_overdue', args: { minDaysOverdue: 16 } },
        { id: 'sarahs', action: 'contacts.search', args: { query: 'Sarah' } },
      ],
    });
    const { leads, reps, overdue, sarahs } = run.state.results;
    expect(leads.total).toBe(14);
    expect(reps.items.some((u) => u.name.startsWith('Hannah'))).toBe(false);
    expect(overdue.total).toBeGreaterThan(0);
    expect(sarahs.total).toBe(2);
    expect(world.db.col('leads').every((l) => l.createdAt <= world.clock.nowIso())).toBe(true);
  });
});
