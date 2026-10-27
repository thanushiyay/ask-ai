import { z, crud, action, fail, out, ref, listResult } from '../core/kit.js';

const TAGGABLE = {
  contact: 'contacts',
  lead: 'leads',
  company: 'companies',
  opportunity: 'opportunities',
  ticket: 'tickets',
};
const recordType = z.enum(Object.keys(TAGGABLE));
const usage = (db, name) =>
  Object.fromEntries(
    Object.entries(TAGGABLE).map(([t, col]) => [
      t,
      db.find(col, (r) => (r.tags ?? []).includes(name)).length,
    ]),
  );
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .meta({ description: 'Hex color like #22c55e' });

export default {
  id: 'tags',
  code: 'M08',
  title: 'Tags',
  description: 'Maintain labels and apply them to records.',
  keywords: ['tag', 'label', 'categorize', 'segment', 'mark as'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create tag',
      collection: 'tags',
      description: 'Create a new tag with an optional color.',
      fields: { name: z.string().min(1).max(40), color: color.optional() },
      validate: (a, { db }) => {
        if (db.findOne('tags', (t) => t.name === a.name.toLowerCase()))
          throw fail.conflict(`Tag "${a.name}" already exists`);
        a.name = a.name.toLowerCase();
      },
      defaults: () => ({ color: '#64748b' }),
    }),
    crud.search({
      code: 'A02',
      name: 'list',
      title: 'List tags',
      collection: 'tags',
      description: 'List all tags (optionally filter by name text).',
      text: ['name'],
    }),
    action({
      code: 'A03',
      name: 'rename',
      title: 'Rename tag',
      effect: 'write',
      description: 'Rename a tag everywhere it is applied.',
      input: z.object({ tagId: ref('tags'), name: z.string().min(1) }),
      handler({ tagId, name }, { db, actor }) {
        const t = db.must('tags', tagId);
        const nn = name.toLowerCase();
        if (db.findOne('tags', (x) => x.name === nn && x.id !== t.id))
          throw fail.conflict(`Tag "${nn}" already exists; use merge instead`);
        for (const col of Object.values(TAGGABLE))
          db.find(col, (r) => (r.tags ?? []).includes(t.name)).forEach((r) => {
            r.tags = r.tags.map((x) => (x === t.name ? nn : x));
          });
        return db.update('tags', t.id, { name: nn }, actor);
      },
    }),
    crud.setField({
      code: 'A04',
      name: 'set_color',
      title: 'Set tag color',
      collection: 'tags',
      idField: 'tagId',
      field: 'color',
      schema: color,
      description: 'Set the display color of a tag.',
    }),
    action({
      code: 'A05',
      name: 'delete_unused',
      title: 'Delete unused tag',
      effect: 'destructive',
      description: 'Delete a tag that is not applied to any record.',
      input: z.object({ tagId: ref('tags') }),
      handler({ tagId }, { db, actor }) {
        const t = db.must('tags', tagId);
        const u = usage(db, t.name);
        const n = Object.values(u).reduce((a, b) => a + b, 0);
        if (n) throw fail.state(`Tag "${t.name}" is still used on ${n} records`, u);
        return { ...db.remove('tags', t.id, actor), deleted: true };
      },
    }),
    action({
      code: 'A06',
      name: 'apply',
      title: 'Apply tag to record',
      effect: 'write',
      description:
        'Apply a tag (by name) to a contact, lead, company, opportunity or ticket. Creates the tag if it does not exist.',
      input: z.object({
        tag: z.string().min(1).meta({ description: 'Tag name' }),
        recordType,
        recordId: z.string().min(1),
      }),
      handler({ tag, recordType: t, recordId }, { db, actor }) {
        const name = tag.toLowerCase();
        const rec = db.must(TAGGABLE[t], recordId, TAGGABLE[t]);
        if ((rec.tags ?? []).includes(name)) throw fail.conflict(`Record already has tag "${name}"`);
        if (!db.findOne('tags', (x) => x.name === name)) db.insert('tags', { name, color: '#64748b' }, actor);
        return db.update(TAGGABLE[t], rec.id, { tags: [...(rec.tags ?? []), name] }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'remove',
      title: 'Remove tag from record',
      effect: 'write',
      description: 'Remove a tag from a record.',
      input: z.object({ tag: z.string().min(1), recordType, recordId: z.string().min(1) }),
      handler({ tag, recordType: t, recordId }, { db, actor }) {
        const rec = db.must(TAGGABLE[t], recordId, TAGGABLE[t]);
        const name = tag.toLowerCase();
        if (!(rec.tags ?? []).includes(name)) throw fail.state(`Record does not have tag "${name}"`);
        return db.update(TAGGABLE[t], rec.id, { tags: rec.tags.filter((x) => x !== name) }, actor);
      },
    }),
    action({
      code: 'A08',
      name: 'list_records',
      title: 'List records with tag',
      effect: 'read',
      description: 'List records (optionally of one type) that carry a tag.',
      input: z.object({
        tag: z.string().min(1),
        recordType: recordType.optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      output: out.list,
      handler({ tag, recordType: t, limit }, { db }) {
        const name = tag.toLowerCase();
        const types = t ? [t] : Object.keys(TAGGABLE);
        const rows = types.flatMap((ty) =>
          db.find(TAGGABLE[ty], (r) => (r.tags ?? []).includes(name)).map((r) => ({ ...r, recordType: ty })),
        );
        return listResult(rows, limit ?? 100);
      },
    }),
    action({
      code: 'A09',
      name: 'merge',
      title: 'Merge tags',
      effect: 'destructive',
      description: 'Merge a source tag into a target tag: re-tag all records, then delete the source tag.',
      input: z.object({ sourceTagId: ref('tags'), targetTagId: ref('tags') }),
      output: out.shape({ id: z.string(), retagged: z.number() }),
      handler({ sourceTagId, targetTagId }, { db, actor }) {
        if (sourceTagId === targetTagId) throw fail.validation('Source and target must differ');
        const src = db.must('tags', sourceTagId);
        const dst = db.must('tags', targetTagId);
        let n = 0;
        for (const col of Object.values(TAGGABLE))
          db.find(col, (r) => (r.tags ?? []).includes(src.name)).forEach((r) => {
            r.tags = [...new Set(r.tags.map((x) => (x === src.name ? dst.name : x)))];
            n++;
          });
        db.remove('tags', src.id, actor);
        return { ...dst, retagged: n };
      },
    }),
    action({
      code: 'A10',
      name: 'usage_counts',
      title: 'View tag usage counts',
      effect: 'read',
      description: 'How many records of each type carry each tag.',
      input: z.object({ tag: z.string().optional().meta({ description: 'Only this tag' }) }),
      output: out.shape({
        tags: z.array(
          z.object({ name: z.string(), total: z.number(), byType: z.record(z.string(), z.number()) }),
        ),
      }),
      handler({ tag }, { db }) {
        const tags = db.find('tags', (t) => !tag || t.name === tag.toLowerCase());
        return {
          tags: tags.map((t) => {
            const u = usage(db, t.name);
            return { name: t.name, total: Object.values(u).reduce((a, b) => a + b, 0), byType: u };
          }),
        };
      },
    }),
  ],
};
