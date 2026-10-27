import { z } from 'zod';
import { fail } from './errors.js';

export { z, fail };

/** ID that references a record in `collection`. The metadata lets the smoke test
 *  and the agent's entity resolver know which collection an ID points to. */
export const ref = (collection, description) =>
  z
    .string()
    .min(1)
    .meta({ ref: collection, description: description ?? `ID of a record in ${collection}` });

export const s = {
  text: (d) => z.string().min(1).meta({ description: d }),
  optText: (d) => z.string().optional().meta({ description: d }),
  email: (d = 'Email address') => z.string().email().meta({ description: d }),
  phone: (d = 'Phone number in E.164 format, e.g. +14155550123') =>
    z
      .string()
      .regex(/^\+?[0-9 ()-]{7,20}$/)
      .meta({ description: d }),
  datetime: (d) =>
    z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date or date-time')
      .meta({ description: d, format: 'date-time' }),
  date: (d) =>
    z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date')
      .meta({ description: d, format: 'date' }),
  money: (d = 'Amount in major currency units, e.g. 49.99') =>
    z.number().nonnegative().meta({ description: d }),
  int: (d, min = 0) => z.number().int().min(min).meta({ description: d }),
  bool: (d) => z.boolean().meta({ description: d }),
  enum: (values, d) => z.enum(values).meta({ description: d }),
  tags: (d = 'Tag names') => z.array(z.string().min(1)).meta({ description: d }),
  limit: () =>
    z.number().int().min(1).max(500).optional().meta({ description: 'Max records to return (default 50)' }),
};

export const out = {
  record: z.looseObject({ id: z.string() }),
  list: z.object({
    items: z.array(z.looseObject({ id: z.string() })),
    total: z.number(),
    returned: z.number(),
  }),
  shape: (shape) => z.looseObject(shape),
};

export const between = (value, from, to) => {
  if (!value) return !from && !to;
  const t = new Date(value).getTime();
  return (!from || t >= new Date(from).getTime()) && (!to || t < new Date(to).getTime());
};
export const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
export const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
export const listResult = (items, limit = 50) => ({
  items: items.slice(0, limit),
  total: items.length,
  returned: Math.min(items.length, limit),
});
export const fullName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ');
export const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .trim();

/** Generic rule matcher shared by smart lists, reports and triggers. */
const RULE_OPS = [
  'eq',
  'neq',
  'in',
  'nin',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'before',
  'after',
];
export const ruleSchema = z.object({
  field: z.string().min(1).meta({ description: 'Record field, e.g. "source", "tags", "createdAt"' }),
  op: z.enum(RULE_OPS),
  value: z.any().optional(),
});
export function matchRule(rec, { field, op, value }) {
  const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), rec);
  const cmp = (a, b) =>
    typeof a === 'string' && !Number.isNaN(Date.parse(a)) && typeof b === 'string'
      ? Date.parse(a) - Date.parse(b)
      : a - b;
  switch (op) {
    case 'eq':
      return Array.isArray(v) ? v.includes(value) : norm(v) === norm(value);
    case 'neq':
      return Array.isArray(v) ? !v.includes(value) : norm(v) !== norm(value);
    case 'in':
      return [].concat(value).some((x) => (Array.isArray(v) ? v.includes(x) : norm(v) === norm(x)));
    case 'nin':
      return ![].concat(value).some((x) => (Array.isArray(v) ? v.includes(x) : norm(v) === norm(x)));
    case 'contains':
      return Array.isArray(v) ? v.map(norm).includes(norm(value)) : norm(v).includes(norm(value));
    case 'gt':
      return v != null && cmp(v, value) > 0;
    case 'gte':
      return v != null && cmp(v, value) >= 0;
    case 'lt':
    case 'before':
      return v != null && cmp(v, value) < 0;
    case 'lte':
      return v != null && cmp(v, value) <= 0;
    case 'after':
      return v != null && cmp(v, value) > 0;
    case 'exists':
      return value === false ? v == null || v === '' : v != null && v !== '';
    default:
      return false;
  }
}

/** Hand-written action. effect: read | write | destructive | external */
export function action(spec) {
  for (const k of ['code', 'name', 'title', 'description', 'effect', 'input', 'handler']) {
    if (!spec[k]) throw new Error(`action ${spec.name ?? '?'} missing "${k}"`);
  }
  return { output: out.record, ...spec };
}

const idInput = (idField, collection, extra = {}) => z.object({ [idField]: ref(collection), ...extra });

export const crud = {
  create: ({ collection, fields, defaults = () => ({}), validate, ...spec }) =>
    action({
      effect: 'write',
      input: z.object(fields),
      output: out.record,
      ...spec,
      handler(args, ctx) {
        validate?.(args, ctx);
        return ctx.db.insert(collection, { ...defaults(args, ctx), ...defined(args) }, ctx.actor);
      },
    }),

  get: ({ collection, idField, enrich, ...spec }) =>
    action({
      effect: 'read',
      input: idInput(idField, collection),
      ...spec,
      handler(args, ctx) {
        const rec = ctx.db.must(collection, args[idField], collection);
        return enrich ? { ...rec, ...enrich(rec, ctx) } : rec;
      },
    }),

  /**
   * text: fields matched by free-text `query`
   * filters: { field: zodSchema } exact/array-contains filters
   * dates: { prefix: field } -> `${prefix}From` / `${prefix}To` range filters
   * where: extra predicate (rec, args, ctx)
   * extraInput: extra input fields consumed by `where`
   * hide: default predicate to hide (e.g. archived) unless includeArchived
   */
  search: ({
    collection,
    text = ['name'],
    filters = {},
    dates = { created: 'createdAt' },
    where,
    extraInput = {},
    hide,
    sort,
    ...spec
  }) => {
    const dateFields = {};
    for (const [prefix, field] of Object.entries(dates)) {
      dateFields[`${prefix}From`] = s
        .datetime(`Only records whose ${field} is on/after this time (inclusive)`)
        .optional();
      dateFields[`${prefix}To`] = s
        .datetime(`Only records whose ${field} is before this time (exclusive)`)
        .optional();
    }
    const filterFields = Object.fromEntries(Object.entries(filters).map(([k, sch]) => [k, sch.optional()]));
    // Every single-ID filter also accepts a list (contactId → contactIds) so one search covers many records.
    const listFilters = Object.keys(filters)
      .filter((k) => k.endsWith('Id') && !(`${k}s` in filters) && !(`${k}s` in extraInput))
      .map((k) => [`${k}s`, k]);
    const listFields = Object.fromEntries(
      listFilters.map(([plural, single]) => [
        plural,
        z
          .array(z.string())
          .optional()
          .meta({ description: `Records whose ${single} is any of these` }),
      ]),
    );
    return action({
      effect: 'read',
      input: z.object({
        query: z
          .string()
          .optional()
          .meta({ description: `Free text matched against ${text.join(', ')}` }),
        ids: z.array(z.string()).optional().meta({ description: 'Restrict to these record IDs' }),
        ...filterFields,
        ...listFields,
        ...dateFields,
        ...extraInput,
        ...(hide
          ? {
              includeArchived: z
                .boolean()
                .optional()
                .meta({ description: 'Include archived/closed records' }),
            }
          : {}),
        limit: s.limit(),
      }),
      output: out.list,
      ...spec,
      handler(args, ctx) {
        const q = norm(args.query);
        let rows = ctx.db.find(collection, (r) => {
          if (hide && !args.includeArchived && hide(r)) return false;
          if (args.ids && !args.ids.includes(r.id)) return false;
          if (
            q &&
            !text.some((f) => norm(f === 'name' && r.firstName ? fullName(r) : r[f]).includes(q)) &&
            !(text.includes('name') && norm(r.email).includes(q))
          )
            return false;
          for (const k of Object.keys(filters)) {
            if (args[k] === undefined) continue;
            const want = args[k];
            const have = r[k];
            if (
              Array.isArray(want)
                ? !want.some((w) => (Array.isArray(have) ? have.includes(w) : have === w))
                : Array.isArray(have)
                  ? !have.map(norm).includes(norm(want))
                  : typeof want === 'string'
                    ? norm(have) !== norm(want)
                    : have !== want
            )
              return false;
          }
          for (const [plural, single] of listFilters) {
            if (args[plural] && !args[plural].includes(r[single])) return false;
          }
          for (const [prefix, field] of Object.entries(dates)) {
            if (
              (args[`${prefix}From`] || args[`${prefix}To`]) &&
              !between(r[field], args[`${prefix}From`], args[`${prefix}To`])
            )
              return false;
          }
          return where ? where(r, args, ctx) : true;
        });
        if (sort) rows = [...rows].sort(sort);
        return listResult(rows, args.limit ?? 50);
      },
    });
  },

  update: ({ collection, idField, fields, guard, ...spec }) =>
    action({
      effect: 'write',
      input: idInput(
        idField,
        collection,
        Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
      ),
      ...spec,
      handler(args, ctx) {
        const rec = ctx.db.must(collection, args[idField], collection);
        const patch = defined(pick(args, Object.keys(fields)));
        if (!Object.keys(patch).length)
          throw fail.validation('Provide at least one field to update', { allowed: Object.keys(fields) });
        const extra = guard?.(rec, args, ctx) ?? {};
        return ctx.db.update(collection, rec.id, { ...patch, ...extra }, ctx.actor);
      },
    }),

  /** Set one field (with optional transform + guard). Many catalog actions are this shape. */
  setField: ({ collection, idField, field, schema, guard, transform, effect = 'write', ...spec }) =>
    action({
      effect,
      input: idInput(idField, collection, { [field]: schema }),
      ...spec,
      handler(args, ctx) {
        const rec = ctx.db.must(collection, args[idField], collection);
        guard?.(rec, args, ctx);
        const patch = transform ? transform(args, rec, ctx) : { [field]: args[field] };
        return ctx.db.update(collection, rec.id, patch, ctx.actor);
      },
    }),

  /** Status machine transition with an explicit set of allowed source states. */
  transition: ({
    collection,
    idField,
    field = 'status',
    from,
    to,
    extraInput = {},
    patch,
    effect = 'write',
    label,
    ...spec
  }) =>
    action({
      effect,
      input: idInput(idField, collection, extraInput),
      ...spec,
      handler(args, ctx) {
        const rec = ctx.db.must(collection, args[idField], collection);
        if (from && !from.includes(rec[field])) {
          throw fail.state(
            `${label ?? collection.replace(/s$/, '')} ${rec.id} is "${rec[field]}"; this action requires ${field} in [${from.join(', ')}]`,
            { current: rec[field], allowed: from },
          );
        }
        return ctx.db.update(
          collection,
          rec.id,
          { [field]: to, ...(patch ? patch(args, rec, ctx) : {}) },
          ctx.actor,
        );
      },
    }),
};

/** Find or fail helper for arrays embedded in a record (stages, steps, fields...). */
export function child(list, id, label) {
  const item = list.find((x) => x.id === id);
  if (!item) throw fail.notFound(label, id);
  return item;
}
