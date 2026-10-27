const IGNORED_KEYS = new Set(['id', 'label', 'repairs', 'after']);

const renameRefs = (value, renames) => {
  if (typeof value === 'string') {
    return value.replace(/\$([A-Za-z_]\w*)/g, (ref, id) => (renames.has(id) ? `$${renames.get(id)}` : ref));
  }
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, renames));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameRefs(v, renames)]));
  }
  return value;
};

const signature = (step) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(step)
        .filter(([key]) => !IGNORED_KEYS.has(key))
        .sort(),
    ),
  );

/**
 * Merges the steps a repair call proposed into the running plan. Models often re-emit steps that already
 * succeeded under new ids; those are dropped and references to them point at the original step instead,
 * so no completed work is repeated. Kept steps are tagged with the failed steps they repair.
 */
export function mergeRepairSteps(steps, state, proposed) {
  const completed = new Map(
    steps.filter((s) => state.status[s.id] === 'completed').map((s) => [signature(s), s.id]),
  );
  const unresolved = steps.filter((s) => ['failed', 'skipped'].includes(state.status[s.id])).map((s) => s.id);
  const renames = new Map();
  const added = [];
  const taken = new Set(steps.map((s) => s.id));
  const freshId = () => {
    let n = 1;
    while (taken.has(`r${n}`)) n++;
    taken.add(`r${n}`);
    return `r${n}`;
  };

  for (const original of proposed) {
    // A corrected step often reuses the failed step's id; give it a new one and point references at it.
    const step =
      taken.has(original.id) && !completed.has(signature(renameRefs(original, renames)))
        ? { ...original, id: freshId() }
        : original;
    if (step.id !== original.id) renames.set(original.id, step.id);
    else taken.add(step.id);
    const rewritten = renameRefs(step, renames);
    const after = rewritten.after && [].concat(rewritten.after).map((id) => renames.get(id) ?? id);
    const existing = completed.get(signature(rewritten));
    if (existing) {
      renames.set(original.id, existing);
      continue;
    }
    added.push({ ...rewritten, ...(after ? { after } : {}), repairs: unresolved });
  }
  return added;
}
