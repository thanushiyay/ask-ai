import { editDistance } from '../../core/strings.js';
import { OPS } from './operations.js';
import { stepDeps } from './references.js';

const MAX_SUGGESTION_DISTANCE = 4;

function closestActions(registry, id) {
  return registry
    .list()
    .map((action) => [action.id, editDistance(id.toLowerCase(), action.id, MAX_SUGGESTION_DISTANCE)])
    .filter(([, distance]) => distance <= MAX_SUGGESTION_DISTANCE)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([candidate]) => candidate);
}

function findCycles(steps, ids) {
  const deps = Object.fromEntries(steps.map((s) => [s.id, stepDeps(s, ids)]));
  const problems = [];
  const visiting = new Set();
  const done = new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      problems.push(`cycle involving ${id}`);
      return;
    }
    visiting.add(id);
    (deps[id] ?? []).forEach(visit);
    visiting.delete(id);
    done.add(id);
  };
  steps.forEach((s) => visit(s.id));
  return problems;
}

/** Static checks before anything runs: IDs, known actions and ops, valid ordering, no cycles. */
export function validatePlan(plan, registry) {
  const steps = plan.steps ?? [];
  const problems = [];
  const ids = new Set();

  for (const step of steps) {
    if (!step.id) problems.push('every step needs an id');
    if (ids.has(step.id)) problems.push(`duplicate step id ${step.id}`);
    ids.add(step.id);
    if (!step.action && !step.op) problems.push(`step ${step.id} needs "action" or "op"`);
    if (step.action && !registry.get(step.action)) {
      const hint = closestActions(registry, step.action);
      const suggestion = hint.length ? ` (did you mean ${hint.join(' or ')}?)` : '';
      problems.push(`step ${step.id}: unknown action "${step.action}"${suggestion}`);
    }
    if (step.op && !OPS.includes(step.op)) problems.push(`step ${step.id}: unknown op "${step.op}"`);
  }
  for (const step of steps) {
    for (const dep of [].concat(step.after ?? [])) {
      if (!ids.has(dep)) problems.push(`step ${step.id}: "after" names unknown step ${dep}`);
    }
  }
  return [...problems, ...findCycles(steps, ids)];
}
