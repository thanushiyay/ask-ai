import { z, s, ref, crud, action, fail, out, between } from '../core/kit.js';
import { daysOverdue } from './_commerce.js';

const METRICS = {
  leads_created: { col: 'leads', date: 'createdAt', value: () => 1 },
  contacts_created: { col: 'contacts', date: 'createdAt', value: () => 1 },
  deals_won: { col: 'opportunities', date: 'closedAt', where: (o) => o.status === 'won', value: () => 1 },
  revenue_won: {
    col: 'opportunities',
    date: 'closedAt',
    where: (o) => o.status === 'won',
    value: (o) => o.value,
  },
  revenue: {
    col: 'payments',
    date: 'processedAt',
    where: (p) => p.status === 'succeeded',
    value: (p) => p.amount - p.refundedAmount,
  },
  tasks_completed: {
    col: 'tasks',
    date: 'completedAt',
    where: (t) => t.status === 'completed',
    value: () => 1,
  },
  appointments_booked: {
    col: 'appointments',
    date: 'startAt',
    where: (a) => a.status !== 'cancelled',
    value: () => 1,
  },
  tickets_opened: { col: 'tickets', date: 'createdAt', value: () => 1 },
  invoices_overdue: {
    col: 'invoices',
    date: 'dueDate',
    where: (i, clock) => daysOverdue(i, clock) > 0,
    value: (i) => i.balance,
  },
};
const GROUPS = ['none', 'source', 'ownerId', 'status', 'day', 'week', 'priority', 'platform'];
const PRESETS = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_365_days: 365 };
const dateRange = z.object({
  from: s.datetime('Start').optional(),
  to: s.datetime('End').optional(),
  preset: z.enum(Object.keys(PRESETS)).optional(),
});

function resolveRange(r, clock) {
  if (r?.from || r?.to) return { from: r.from ?? null, to: r.to ?? clock.nowIso() };
  const days = PRESETS[r?.preset ?? 'last_30_days'];
  return { from: clock.daysAgo(days).toISOString(), to: clock.nowIso() };
}

function runMetric(db, clock, { metric, filters = [], dateRange: dr, groupBy = 'none' }) {
  const m = METRICS[metric];
  const range = resolveRange(dr, clock);
  const rows = db.find(
    m.col,
    (r) =>
      (!m.where || m.where(r, clock)) &&
      (metric === 'invoices_overdue' || between(r[m.date], range.from, range.to)) &&
      filters.every((f) =>
        Array.isArray(r[f.field]) ? r[f.field].includes(f.value) : String(r[f.field]) === String(f.value),
      ),
  );
  const keyOf = (r) => {
    if (groupBy === 'none') return 'all';
    if (groupBy === 'day') return String(r[m.date]).slice(0, 10);
    if (groupBy === 'week') {
      const d = new Date(r[m.date]);
      return clock.date(clock.startOfWeek(d));
    }
    if (groupBy === 'ownerId') return db.get('users', r.ownerId)?.name ?? 'Unassigned';
    return r[groupBy] ?? 'none';
  };
  const groups = {};
  for (const r of rows) {
    const k = keyOf(r);
    groups[k] = Math.round(((groups[k] ?? 0) + m.value(r)) * 100) / 100;
  }
  const total = Math.round(rows.reduce((a, r) => a + m.value(r), 0) * 100) / 100;
  return {
    metric,
    range,
    groupBy,
    total,
    count: rows.length,
    groups: Object.entries(groups)
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([key, value]) => ({ key, value })),
  };
}

const filterSchema = z.array(
  z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
);

export default {
  id: 'reports',
  code: 'M50',
  title: 'Reports',
  description: 'Query business metrics and manage saved reports.',
  keywords: [
    'report',
    'analytics',
    'metrics',
    'dashboard',
    'kpi',
    'how many',
    'revenue',
    'trend',
    'compare',
    'stats',
    'performance',
  ],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create saved report',
      collection: 'reports',
      description: `Save a report definition on a metric (${Object.keys(METRICS).join(', ')}).`,
      fields: {
        name: z.string().min(1),
        metric: z.enum(Object.keys(METRICS)),
        groupBy: z.enum(GROUPS).optional(),
        dateRange: dateRange.optional(),
        filters: filterSchema.optional(),
      },
      defaults: () => ({
        filters: [],
        dateRange: { preset: 'last_30_days' },
        groupBy: 'none',
        schedule: null,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get report definition',
      collection: 'reports',
      idField: 'reportId',
      description: "Get a saved report's metric, filters, date range and grouping.",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List saved reports',
      collection: 'reports',
      description: 'List saved reports.',
      text: ['name'],
      filters: { metric: z.enum(Object.keys(METRICS)) },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_filters',
      title: 'Update report filters',
      collection: 'reports',
      idField: 'reportId',
      field: 'filters',
      schema: filterSchema,
      description: 'Replace a report\'s filters, e.g. [{"field":"source","value":"facebook"}].',
    }),
    crud.setField({
      code: 'A05',
      name: 'set_date_range',
      title: 'Set report date range',
      collection: 'reports',
      idField: 'reportId',
      field: 'dateRange',
      schema: dateRange,
      description: "Set a report's date range (explicit from/to or preset).",
    }),
    crud.setField({
      code: 'A06',
      name: 'set_grouping',
      title: 'Set report grouping',
      collection: 'reports',
      idField: 'reportId',
      field: 'groupBy',
      schema: z.enum(GROUPS),
      description: 'Group report results by source, owner, status, day or week.',
    }),
    action({
      code: 'A07',
      name: 'run',
      title: 'Run report',
      effect: 'read',
      description: `Run a saved report (reportId) or an ad-hoc metric query (metric + optional groupBy/dateRange/filters). Metrics: ${Object.keys(METRICS).join(', ')}.`,
      input: z.object({
        reportId: ref('reports').optional(),
        metric: z.enum(Object.keys(METRICS)).optional(),
        groupBy: z.enum(GROUPS).optional(),
        dateRange: dateRange.optional(),
        filters: filterSchema.optional(),
      }),
      output: out.shape({
        metric: z.string(),
        total: z.number(),
        groups: z.array(z.object({ key: z.string(), value: z.number() })),
      }),
      handler(a, { db, clock }) {
        const def = a.reportId ? db.must('reports', a.reportId) : null;
        const metric = a.metric ?? def?.metric;
        if (!metric) throw fail.validation('Provide reportId or metric');
        return {
          reportId: def?.id ?? null,
          name: def?.name ?? null,
          ...runMetric(db, clock, {
            metric,
            groupBy: a.groupBy ?? def?.groupBy,
            dateRange: a.dateRange ?? def?.dateRange,
            filters: a.filters ?? def?.filters,
          }),
        };
      },
    }),
    action({
      code: 'A08',
      name: 'compare_periods',
      title: 'Compare report periods',
      effect: 'read',
      description:
        'Compare a metric between the current period and the previous equal-length period (or two explicit ranges).',
      input: z.object({
        reportId: ref('reports').optional(),
        metric: z.enum(Object.keys(METRICS)).optional(),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .meta({ description: 'Period length in days (default 30)' }),
        current: dateRange.optional(),
        previous: dateRange.optional(),
      }),
      output: out.shape({
        metric: z.string(),
        current: z.number(),
        previous: z.number(),
        change: z.number().nullable(),
      }),
      handler(a, { db, clock }) {
        const def = a.reportId ? db.must('reports', a.reportId) : null;
        const metric = a.metric ?? def?.metric;
        if (!metric) throw fail.validation('Provide reportId or metric');
        const days = a.days ?? 30;
        const cur = a.current ?? { from: clock.daysAgo(days).toISOString(), to: clock.nowIso() };
        const prev = a.previous ?? {
          from: clock.daysAgo(days * 2).toISOString(),
          to: clock.daysAgo(days).toISOString(),
        };
        const c = runMetric(db, clock, { metric, dateRange: cur, filters: def?.filters }).total;
        const p = runMetric(db, clock, { metric, dateRange: prev, filters: def?.filters }).total;
        return {
          metric,
          current: c,
          previous: p,
          change: p ? Math.round(((c - p) / p) * 1000) / 10 : null,
          currentRange: cur,
          previousRange: prev,
        };
      },
    }),
    action({
      code: 'A09',
      name: 'export',
      title: 'Export report results',
      effect: 'write',
      description: "Export a saved report's results to CSV (simulated download link).",
      input: z.object({ reportId: ref('reports') }),
      output: out.shape({ id: z.string(), url: z.string(), rows: z.number() }),
      handler({ reportId }, { db, clock, actor }) {
        const r = db.must('reports', reportId);
        const res = runMetric(db, clock, r);
        const csv = ['key,value', ...res.groups.map((g) => `${JSON.stringify(g.key)},${g.value}`)].join('\n');
        const e = db.insert(
          'exports',
          { source: 'report', sourceId: r.id, rows: res.groups.length, csv },
          actor,
        );
        return {
          id: e.id,
          rows: res.groups.length,
          url: `https://files.northwind.example/exports/${e.id}.csv`,
        };
      },
    }),
    action({
      code: 'A10',
      name: 'schedule_delivery',
      title: 'Schedule report delivery',
      effect: 'external',
      description: 'Email a saved report to recipients on a schedule (daily/weekly/monthly).',
      input: z.object({
        reportId: ref('reports'),
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        recipients: z.array(z.string().email()).min(1),
      }),
      handler({ reportId, frequency, recipients }, { db, actor }) {
        const r = db.must('reports', reportId);
        return db.update('reports', r.id, { schedule: { frequency, recipients } }, actor);
      },
    }),
  ],
};
