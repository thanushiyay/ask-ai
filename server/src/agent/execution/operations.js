import { matchRule } from '../../core/kit.js';
import { traverse, resolveValue, unresolvedReferences, describeUnresolved } from './references.js';

/** Data operations the planner may use. They run in code: exact, free and instant. */
export const OPS = [
  'filter',
  'exclude',
  'intersect',
  'pluck',
  'unique',
  'distribute',
  'join',
  'sort',
  'limit',
  'count',
  'union',
];

const REFERENCE_FIELDS = ['from', 'values', 'pool', 'with'];
const ABSENCE_OPS = new Set(['exists', 'neq', 'nin']);
const DEFAULT_LIMIT = 10;

export const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return value == null ? [] : [value];
};

const keyOf = (item, key) => (key ? traverse(item, key.split('.')) : item);
const isObject = (x) => x !== null && typeof x === 'object';

function opError(message, code = 'VALIDATION') {
  return Object.assign(new Error(message), { code });
}

/** Rejects a key that no item has: filtering or joining on a misspelled field would silently drop everything. */
function requireKey(list, key, op, role = 'items') {
  if (!key || !list.some(isObject) || list.some((x) => keyOf(x, key) !== undefined)) return;
  const fields = Object.keys(list.find(isObject)).slice(0, 12);
  throw opError(
    `${op}: none of the ${list.length} ${role} has "${key}"; available fields: ${fields.join(', ')}`,
  );
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const key = JSON.stringify(keyFn(item));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filter(from, step, scope) {
  const rules = (step.where ?? []).map((w) => ({
    field: w.path ?? w.field,
    op: w.op ?? 'eq',
    value: resolveValue(w.value, scope),
  }));
  for (const rule of rules) if (!ABSENCE_OPS.has(rule.op)) requireKey(from, rule.field, 'filter');
  return from.filter((item) => rules.every((rule) => matchRule(item, rule)));
}

function matchSet(from, step, scope) {
  const valuesKey = step.valuesKey ?? step.key;
  const values = asList(resolveValue(step.values, scope));
  requireKey(from, step.key, step.op);
  requireKey(values, valuesKey, step.op, 'values');
  const keys = new Set(values.map((v) => String(isObject(v) ? keyOf(v, valuesKey) : v)));
  const keep = step.op === 'intersect';
  return from.filter((item) => keys.has(String(keyOf(item, step.key))) === keep);
}

function join(from, step, scope) {
  const other = asList(resolveValue(step.with, scope));
  const foreignKey = step.foreignKey ?? 'id';
  requireKey(from, step.localKey, 'join');
  requireKey(other, foreignKey, 'join', 'records to join');
  const index = new Map();
  for (const record of other) {
    const key = String(keyOf(record, foreignKey));
    if (!index.has(key)) index.set(key, record);
  }
  return from.map((item) => ({
    ...item,
    [step.as ?? 'joined']: index.get(String(keyOf(item, step.localKey))) ?? null,
  }));
}

/** Assigns each item a pool member, round robin or to whoever has the least load. */
function distribute(from, step, scope) {
  if (!from.length) return [];
  const pool = asList(resolveValue(step.pool, scope));
  if (!pool.length) throw opError('distribute: the pool is empty (no one to assign to)', 'INVALID_STATE');

  const objects = isObject(pool[0]);
  let poolKey = step.poolKey ?? (objects ? ('userId' in pool[0] ? 'userId' : 'id') : null);
  if (
    objects &&
    poolKey &&
    !pool.some((p) => p[poolKey] !== undefined) &&
    pool.some((p) => p.id !== undefined)
  ) {
    poolKey = 'id';
  }
  if (objects && poolKey) requireKey(pool, poolKey, 'distribute', 'pool members');

  const members = pool.map((p) => ({
    id: poolKey ? p[poolKey] : p,
    load: step.strategy === 'least_loaded' && step.loadKey ? Number(p[step.loadKey] ?? 0) : 0,
  }));
  const as = step.as ?? 'assigneeId';
  return from.map((item, i) => {
    let member = members[i % members.length];
    if (step.strategy === 'least_loaded') {
      member = members.reduce((least, m) => (m.load < least.load ? m : least));
      member.load += 1;
    }
    return { ...item, [as]: member.id };
  });
}

function sort(from, step) {
  requireKey(from, step.by, 'sort');
  const direction = step.desc ? -1 : 1;
  return [...from].sort((a, b) => {
    const x = keyOf(a, step.by);
    const y = keyOf(b, step.by);
    return (x > y ? 1 : x < y ? -1 : 0) * direction;
  });
}

export function runOp(step, scope) {
  const unresolved = REFERENCE_FIELDS.flatMap((field) => unresolvedReferences(step[field], scope));
  if (unresolved.length) throw opError(describeUnresolved(unresolved, scope));
  const from = asList(resolveValue(step.from, scope));

  switch (step.op) {
    case 'filter':
      return filter(from, step, scope);
    case 'exclude':
    case 'intersect':
      return matchSet(from, step, scope);
    case 'pluck': {
      const path = step.path ?? step.key;
      requireKey(from, path, 'pluck');
      return from.flatMap((item) => keyOf(item, path)).filter((x) => x !== undefined);
    }
    case 'unique':
      requireKey(from, step.key, 'unique');
      return uniqueBy(from, (item) => keyOf(item, step.key));
    case 'union': {
      const lists = [].concat(step.from).flatMap((source) => asList(resolveValue(source, scope)));
      return uniqueBy(lists, (item) => (step.key ? keyOf(item, step.key) : (item?.id ?? item)));
    }
    case 'sort':
      return sort(from, step);
    case 'limit':
      return from.slice(0, step.n ?? DEFAULT_LIMIT);
    case 'count':
      return from.length;
    case 'join':
      return join(from, step, scope);
    case 'distribute':
      return distribute(from, step, scope);
    default:
      throw opError(`Unknown op "${step.op}"`);
  }
}
