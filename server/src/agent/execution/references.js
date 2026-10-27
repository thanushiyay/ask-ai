import { displayName } from '../digest.js';

const REF = /^\$([A-Za-z_][\w]*)((?:\.[\w*]+|\[\*?\d*\])*)$/;
const TEMPLATE = /\{\{\s*\$?([A-Za-z_][\w]*(?:\.[\w*]+|\[\*?\d*\])*)\s*\}\}/g;
const STEP_REF = /\$([A-Za-z_][\w]*)/g;
const TEMPLATE_STEP_REF = /\{\{\s*\$?([A-Za-z_][\w]*)/g;
const WRAPPER_KEYS = new Set(['result', 'data', 'record', 'output']);
const LIST_KEYWORDS = new Set(['*', 'length', 'count', 'total']);

export const isReference = (value) => typeof value === 'string' && REF.test(value);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasKey = (list, key) => list.some((x) => isPlainObject(x) && key in x);

function parsePath(rest) {
  return [...rest.matchAll(/\.([\w*]+)|\[(\*|\d+)\]/g)].map(([, key, index]) => key ?? index);
}

/**
 * `contact.id` written for a flat `contactId` field: models often assume a nested object. Returns the
 * flat key to read instead when the object has it and lacks the nested one.
 */
function flatIdKey(sample, part, next) {
  if (next !== 'id' || !isPlainObject(sample) || part in sample) return null;
  const flat = `${part}Id`;
  return flat in sample ? flat : null;
}

/** Walks a path; over lists it maps each element, so `items.contactId` yields every contactId. */
export function traverse(value, parts) {
  let cur = value;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (cur == null) return undefined;
    if (part === '*') {
      if (!Array.isArray(cur)) return undefined;
      continue;
    }
    if (part === 'length' || part === 'count') {
      cur = Array.isArray(cur) ? cur.length : Array.isArray(cur.items) ? cur.items.length : cur[part];
      continue;
    }
    if (!Array.isArray(cur)) {
      const flat = flatIdKey(cur, part, parts[i + 1]);
      if (flat) i++;
      cur = cur[flat ?? part];
      continue;
    }
    // Op steps return plain lists; accept the search-result shape ($s3.items, $s3.total) for them too.
    if (part === 'items' && !hasKey(cur, 'items')) continue;
    if (part === 'total' && !hasKey(cur, 'total')) {
      cur = cur.length;
      continue;
    }
    if (/^\d+$/.test(part)) {
      cur = cur[Number(part)];
      continue;
    }
    const flat = flatIdKey(cur.find(isPlainObject), part, parts[i + 1]);
    if (flat) i++;
    const key = flat ?? part;
    cur = cur.flatMap((x) => x?.[key]).filter((x) => x !== undefined);
  }
  return cur;
}

/** The single record a search or lookup returned, when there is exactly one. */
function onlyRecord(result) {
  if (isPlainObject(result.item)) return result.item;
  return Array.isArray(result.items) && result.items.length === 1 ? result.items[0] : undefined;
}

/**
 * Resolves `$step.path` against earlier results. Tolerates the shape slips models make most often:
 * `.item` on a single record, wrapper keys such as `.result`, and a field of the only match of a search.
 */
export function resolveRef(expr, scope) {
  const match = REF.exec(expr.startsWith('$') ? expr : `$${expr}`);
  if (!match) return undefined;
  const [, root, rest] = match;
  let base = root === 'item' ? scope.item : root === 'index' ? scope.index : scope.results[root];
  const parts = parsePath(rest);

  if (isPlainObject(base)) {
    if (WRAPPER_KEYS.has(parts[0]) && !(parts[0] in base)) parts.shift();
    if (parts[0] === 'item' && !('item' in base)) {
      if (!Array.isArray(base.items)) parts.shift();
      else if (base.items.length === 1) {
        base = base.items[0];
        parts.shift();
      }
    }
    const [field] = parts;
    if (field && !(field in base) && !/^\d+$/.test(field) && !LIST_KEYWORDS.has(field)) {
      base = onlyRecord(base) ?? base;
    }
  }
  return traverse(base, parts);
}

export function resolveValue(value, scope) {
  if (typeof value === 'string') {
    if (REF.test(value)) return resolveRef(value, scope);
    if (!value.includes('{{')) return value;
    return value.replace(TEMPLATE, (_, expr) => {
      const resolved = resolveRef(expr, scope);
      if (resolved == null) return '';
      return typeof resolved === 'object' ? displayName(resolved) : String(resolved);
    });
  }
  if (Array.isArray(value)) {
    const resolved = value.map((x) => resolveValue(x, scope));
    // ["$s1.items[*].id"] means the list itself, not a list containing it.
    return value.length === 1 && isReference(value[0]) && Array.isArray(resolved[0]) ? resolved[0] : resolved;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, x]) => [key, resolveValue(x, scope)])
        .filter(([, x]) => x !== undefined),
    );
  }
  return value;
}

/** References that resolve to nothing, e.g. a field the earlier step never returned. */
export function unresolvedReferences(value, scope, found = []) {
  if (isReference(value)) {
    if (resolveRef(value, scope) === undefined) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => unresolvedReferences(v, scope, found));
  } else if (isPlainObject(value)) {
    Object.values(value).forEach((v) => unresolvedReferences(v, scope, found));
  }
  return found;
}

/** Explains unresolved references in terms the planner can act on during a repair. */
export function describeUnresolved(refs, scope) {
  return refs
    .map((ref) => {
      const root = REF.exec(ref)?.[1];
      const result = scope.results[root];
      if (result === undefined) return `${ref}: step ${root} has no result`;
      const shape = Array.isArray(result?.items)
        ? 'a list ({items, total}); use .items[*].field, or expect "one" and .item.field'
        : `fields ${Object.keys(result ?? {})
            .slice(0, 12)
            .join(', ')}`;
      return `${ref} did not resolve; step ${root} returned ${shape}`;
    })
    .join('; ');
}

/** IDs of the plan steps a step depends on, through references or an explicit `after`. */
export function stepDeps(step, ids) {
  const deps = new Set();
  const scan = (value) => {
    if (typeof value === 'string') {
      for (const [, id] of value.matchAll(STEP_REF)) if (ids.has(id)) deps.add(id);
      for (const [, id] of value.matchAll(TEMPLATE_STEP_REF)) if (ids.has(id)) deps.add(id);
    } else if (Array.isArray(value)) value.forEach(scan);
    else if (isPlainObject(value)) Object.values(value).forEach(scan);
  };
  const { id, label: _label, after = [], repairs: _repairs, ...rest } = step;
  scan(rest);
  for (const dep of [].concat(after)) if (ids.has(dep)) deps.add(dep);
  deps.delete(id);
  return [...deps];
}
