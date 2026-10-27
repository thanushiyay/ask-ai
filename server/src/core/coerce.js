const MAX_PASSES = 3;

const getAt = (obj, path) => path.reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);

function setAt(obj, path, value) {
  const parent = getAt(obj, path.slice(0, -1));
  if (parent && typeof parent === 'object') parent[path.at(-1)] = value;
}

const normalizeOption = (v) =>
  String(v)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Repairs one value for one validation issue, or returns undefined when there is no safe repair. */
function repair(value, issue) {
  if (issue.code === 'invalid_type') {
    const single = Array.isArray(value) && value.length === 1 ? value[0] : value;
    switch (issue.expected) {
      case 'string':
        if (typeof single === 'string') return single;
        if (typeof single === 'number') return String(single);
        return undefined;
      case 'number':
        if (typeof single === 'number') return single;
        if (typeof single === 'string' && single.trim() !== '' && Number.isFinite(Number(single))) {
          return Number(single);
        }
        return undefined;
      case 'boolean':
        if (single === 'true' || single === 'false') return single === 'true';
        return typeof single === 'boolean' ? single : undefined;
      case 'array':
        return value == null ? undefined : [value];
      default:
        return undefined;
    }
  }
  // A page size above the maximum just means "as many as possible".
  if (issue.code === 'too_big' && issue.path.at(-1) === 'limit' && typeof value === 'number') {
    return Number(issue.maximum);
  }
  if (issue.code === 'too_small' && issue.path.at(-1) === 'limit' && typeof value === 'number') {
    return Number(issue.minimum);
  }
  if (issue.code === 'invalid_value' && Array.isArray(issue.values) && typeof value === 'string') {
    return issue.values.find((option) => normalizeOption(option) === normalizeOption(value));
  }
  return undefined;
}

/**
 * Validates input against a zod schema, applying only lossless repairs for common model slips:
 * a one-item array where a value is expected, a list sent to `contactId` when `contactIds` exists,
 * null for an optional field, a value where a list is expected, numbers or booleans sent as strings,
 * enum values with different case or separators, and a `limit` outside its allowed range.
 */
export function parseWithRepairs(schema, input) {
  let candidate = input;
  let result = schema.safeParse(candidate);
  const repairs = [];
  const shape = schema.shape ?? {};

  for (let pass = 0; pass < MAX_PASSES && !result.success; pass++) {
    const next = structuredClone(candidate ?? {});
    let changed = false;
    for (const issue of result.error.issues) {
      if (!issue.path.length) continue;
      const value = getAt(next, issue.path);
      const [key] = issue.path;
      const topLevel = issue.path.length === 1;

      if (topLevel && value === null && shape[key]?.safeParse(undefined).success) {
        delete next[key];
        repairs.push(`${key} (null removed)`);
        changed = true;
        continue;
      }
      const plural = `${key}s`;
      if (
        topLevel &&
        Array.isArray(value) &&
        value.length !== 1 &&
        shape[plural] &&
        next[plural] === undefined
      ) {
        next[plural] = value;
        delete next[key];
        repairs.push(`${key} → ${plural}`);
        changed = true;
        continue;
      }
      const fixed = repair(value, issue);
      if (fixed === undefined) continue;
      setAt(next, issue.path, fixed);
      repairs.push(issue.path.join('.'));
      changed = true;
    }
    if (!changed) break;
    candidate = next;
    result = schema.safeParse(candidate);
  }

  return { result, repairs: result.success ? repairs : [] };
}

const USER_KEYS = new Set([
  'ownerId',
  'assigneeId',
  'assignedTo',
  'assignedToId',
  'userId',
  'hostId',
  'repId',
  'salesRepId',
  'agentId',
  'memberId',
  'authorId',
  'instructorId',
  'managerId',
  'accountManagerId',
]);
const ENTITY_SYNONYMS = {
  customer: 'contact',
  client: 'contact',
  person: 'contact',
  deal: 'opportunity',
  account: 'company',
};
const OPEN_WORDS = new Set(['open', 'active', 'unresolved', 'pending', 'not_closed']);
const TERMINAL_STATUSES = new Set([
  'disqualified',
  'converted',
  'closed',
  'cancelled',
  'canceled',
  'completed',
  'archived',
  'lost',
  'won',
  'void',
  'paid',
  'expired',
  'resolved',
  'refunded',
  'failed',
  'declined',
  'rejected',
  'deactivated',
]);

const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** Finds the declared parameter an undeclared key most plausibly means, or null. */
function matchParameter(key, value, properties, provided) {
  const names = Object.keys(properties);
  const free = (name) => !provided.has(name);
  const direct = names.find((n) => n.toLowerCase() === camel(key).toLowerCase());
  if (direct && free(direct)) return direct;

  const singular = camel(key).replace(/Ids$/, 'Id');
  if (singular !== key && properties[singular] && free(singular)) return singular;

  const base = camel(key).replace(/Ids?$/, '');
  const synonym = ENTITY_SYNONYMS[base];
  if (synonym) {
    const target = Array.isArray(value) ? `${synonym}Ids` : `${synonym}Id`;
    if (properties[target] && free(target)) return target;
  }

  if (USER_KEYS.has(singular)) {
    const userParams = names.filter((n) => properties[n].ref === 'users' && free(n));
    if (userParams.length === 1) return userParams[0];
  }
  return null;
}

/** Expands status "open" to every non-terminal status when the parameter accepts a list. */
function expandOpenStatus(value, schema) {
  if (typeof value !== 'string' || !OPEN_WORDS.has(value.toLowerCase())) return undefined;
  const options = schema?.anyOf ?? [schema];
  const values = options.find((o) => o?.enum)?.enum;
  if (!values || values.includes(value) || !options.some((o) => o?.type === 'array')) return undefined;
  const open = values.filter((v) => !TERMINAL_STATUSES.has(v));
  return open.length && open.length < values.length ? open : undefined;
}

/**
 * Maps argument names to the action's declared parameters before validation. Without this, an
 * undeclared key (ownerId where the action says hostId) would be silently dropped and its filter
 * ignored. Keys that cannot be mapped are reported so the call fails clearly instead.
 */
export function prepareArgs(jsonSchema, input) {
  const properties = jsonSchema?.properties ?? {};
  const args = {};
  const renames = [];
  const unknown = [];
  const provided = new Set(Object.keys(input ?? {}).filter((k) => k in properties));

  for (const [key, value] of Object.entries(input ?? {})) {
    if (key in properties) {
      args[key] = value;
      continue;
    }
    if (value == null) continue;
    const target = matchParameter(key, value, properties, provided);
    if (target) {
      args[target] = value;
      provided.add(target);
      renames.push(`${key} → ${target}`);
    } else {
      unknown.push(key);
    }
  }

  if (properties.status && args.status !== undefined) {
    const expanded = expandOpenStatus(args.status, properties.status);
    if (expanded) {
      args.status = expanded;
      renames.push(`status "${input.status}" → ${expanded.join('|')}`);
    }
  }
  return { args, renames, unknown, parameters: Object.keys(properties) };
}
