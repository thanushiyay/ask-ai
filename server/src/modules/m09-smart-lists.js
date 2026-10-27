import { z, ref, crud, action, fail, out, ruleSchema, matchRule, listResult } from '../core/kit.js';
import { COLLECTION_FOR } from './_shared.js';

const moduleEnum = z.enum(Object.keys(COLLECTION_FOR));
const evaluate = (db, sl) =>
  db.find(
    COLLECTION_FOR[sl.module],
    (r) => r.status !== 'archived' && sl.rules.every((rule) => matchRule(r, rule)),
  );
const live = (sl) => {
  if (sl.status === 'deleted') throw fail.state(`Smart list ${sl.id} was deleted`);
};

export default {
  id: 'smart_lists',
  code: 'M09',
  title: 'Smart Lists',
  description: 'Define dynamic audiences using saved filters.',
  keywords: ['smart list', 'segment', 'audience', 'saved filter', 'dynamic list', 'saved view'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create smart list',
      effect: 'write',
      description:
        'Create a saved, dynamic list of contacts/leads/companies/opportunities defined by filter rules (field, op, value).',
      input: z.object({ name: z.string().min(1), module: moduleEnum, rules: z.array(ruleSchema).min(1) }),
      handler(a, { db, actor }) {
        if (
          db.findOne(
            'smart_lists',
            (x) => x.name.toLowerCase() === a.name.toLowerCase() && x.status === 'active',
          )
        )
          throw fail.conflict(`Smart list "${a.name}" exists`);
        const sl = db.insert('smart_lists', { ...a, status: 'active' }, actor);
        return { ...sl, matchCount: evaluate(db, sl).length };
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get smart list definition',
      collection: 'smart_lists',
      idField: 'smartListId',
      description: "Get a smart list's rules.",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List smart lists',
      collection: 'smart_lists',
      description: 'List smart lists, optionally by module.',
      text: ['name'],
      filters: { module: moduleEnum },
      hide: (x) => x.status === 'deleted',
    }),
    crud.setField({
      code: 'A04',
      name: 'rename',
      title: 'Rename smart list',
      collection: 'smart_lists',
      idField: 'smartListId',
      field: 'name',
      schema: z.string().min(1),
      description: 'Rename a smart list.',
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'update_rules',
      title: 'Update filter rules',
      collection: 'smart_lists',
      idField: 'smartListId',
      field: 'rules',
      schema: z.array(ruleSchema).min(1),
      description: 'Replace the filter rules of a smart list.',
      guard: live,
    }),
    action({
      code: 'A06',
      name: 'preview',
      title: 'Preview matching records',
      effect: 'read',
      description: 'Show the records currently matching a smart list.',
      input: z.object({
        smartListId: ref('smart_lists'),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      output: out.list,
      handler({ smartListId, limit }, { db }) {
        const sl = db.must('smart_lists', smartListId);
        live(sl);
        return listResult(evaluate(db, sl), limit ?? 25);
      },
    }),
    action({
      code: 'A07',
      name: 'count',
      title: 'Count matching records',
      effect: 'read',
      description: 'Count records matching a smart list.',
      input: z.object({ smartListId: ref('smart_lists') }),
      output: out.shape({ smartListId: z.string(), count: z.number() }),
      handler({ smartListId }, { db }) {
        const sl = db.must('smart_lists', smartListId);
        live(sl);
        return { smartListId: sl.id, name: sl.name, count: evaluate(db, sl).length };
      },
    }),
    action({
      code: 'A08',
      name: 'export',
      title: 'Export matching records',
      effect: 'write',
      description: 'Export matching records to a CSV file (simulated) and return the download link.',
      input: z.object({ smartListId: ref('smart_lists'), fields: z.array(z.string()).optional() }),
      output: out.shape({ id: z.string(), rows: z.number(), url: z.string() }),
      handler({ smartListId, fields }, { db, actor }) {
        const sl = db.must('smart_lists', smartListId);
        live(sl);
        const rows = evaluate(db, sl);
        const cols = fields ?? ['id', 'name', 'email'];
        const csv = [
          cols.join(','),
          ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(',')),
        ].join('\n');
        const e = db.insert(
          'exports',
          { source: 'smart_list', sourceId: sl.id, rows: rows.length, columns: cols, csv },
          actor,
        );
        return {
          id: e.id,
          rows: rows.length,
          url: `https://files.northwind.example/exports/${e.id}.csv`,
          preview: csv.split('\n').slice(0, 4),
        };
      },
    }),
    action({
      code: 'A09',
      name: 'duplicate',
      title: 'Duplicate smart list',
      effect: 'write',
      description: 'Copy a smart list under a new name.',
      input: z.object({ smartListId: ref('smart_lists'), name: z.string().optional() }),
      handler({ smartListId, name }, { db, actor }) {
        const sl = db.must('smart_lists', smartListId);
        live(sl);
        return db.insert(
          'smart_lists',
          {
            name: name ?? `${sl.name} (copy)`,
            module: sl.module,
            rules: structuredClone(sl.rules),
            status: 'active',
          },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'delete',
      title: 'Delete smart list',
      collection: 'smart_lists',
      idField: 'smartListId',
      from: ['active'],
      to: 'deleted',
      effect: 'destructive',
      description: 'Delete a smart list (records are not affected).',
    }),
  ],
};
