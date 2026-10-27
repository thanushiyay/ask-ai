import { displayName, digestRecord } from '../digest.js';
import { asList, runOp } from './operations.js';
import { describeUnresolved, resolveValue, stepDeps, unresolvedReferences } from './references.js';

const CONCURRENCY = 8;
const MAX_FETCH = 500;
const PREVIEW_SAMPLES = 5;
const PREVIEW_TARGETS = 8;
const CLARIFY_OPTIONS = 6;
const UNSETTLED = new Set(['failed', 'skipped']);

const labelOf = (step) => step.label ?? step.action ?? step.op;
const isOpen = (status) => !status || status === 'awaiting_confirmation';

function overallStatus(steps, st) {
  const unsettled = steps.some((s) => UNSETTLED.has(st.status[s.id]));
  const anyCompleted = steps.some((s) => st.status[s.id] === 'completed');
  const partialFanOut = steps.some((s) => st.results[s.id]?.failed?.length);
  if (unsettled) return anyCompleted ? 'partial' : 'failed';
  return partialFanOut ? 'partial' : 'completed';
}

function clarificationFor(step, args, result, entity) {
  if (!result.items.length) {
    return {
      kind: 'not_found',
      stepId: step.id,
      question: `I couldn't find a ${entity} matching ${JSON.stringify(args.query ?? args)}. Can you give me another detail (full name, email, or ID)?`,
      options: [],
    };
  }
  return {
    kind: 'ambiguous',
    stepId: step.id,
    question: `I found ${result.total} ${entity}s matching "${args.query ?? ''}". Which one did you mean?`,
    options: result.items.slice(0, CLARIFY_OPTIONS).map((r) => ({
      id: r.id,
      label: [displayName(r), r.email, r.company, r.status].filter(Boolean).join(' · '),
      record: digestRecord(r, 6),
    })),
  };
}

/**
 * Runs a validated plan with no model calls: dependency waves in parallel, fan-outs with bounded
 * concurrency, data ops in code, a confirmation gate before risky steps and clarification on
 * ambiguous lookups. State is resumable: { results, status, errors, approvedSteps }.
 */
export class Executor {
  constructor({ registry, ctx, trace, bulkThreshold = 10 }) {
    this.registry = registry;
    this.ctx = ctx;
    this.trace = trace;
    this.bulkThreshold = bulkThreshold;
  }

  async run(plan, state = {}) {
    const st = { results: {}, status: {}, errors: {}, approvedSteps: [], ...state };
    const steps = plan.steps ?? [];
    const ids = new Set(steps.map((s) => s.id));
    const deps = Object.fromEntries(steps.map((s) => [s.id, stepDeps(s, ids)]));
    const scope = { results: st.results };

    for (;;) {
      const open = steps.filter((s) => isOpen(st.status[s.id]));
      if (!open.length) break;
      this.skipBlocked(open, deps, st);

      const ready = steps.filter(
        (s, i) =>
          isOpen(st.status[s.id]) &&
          deps[s.id].every((d) => st.status[d] === 'completed') &&
          !this.waitsForEarlierWrite(steps, i, st),
      );
      if (!ready.length) break;

      const gated = ready.filter((s) => !this.isApproved(s, st) && this.needsConfirmation(s, scope));
      const runnable = ready.filter((s) => !gated.includes(s));
      if (!runnable.length) {
        // Risky writes whose inputs are ready but that only wait for an earlier write's turn are
        // confirmed in the same card, so one approval covers everything the user was shown.
        const queued = steps.filter(
          (s, i) =>
            !ready.includes(s) &&
            isOpen(st.status[s.id]) &&
            deps[s.id].every((d) => st.status[d] === 'completed') &&
            this.waitsForEarlierWrite(steps, i, st) &&
            !this.isApproved(s, st) &&
            this.needsConfirmation(s, scope),
        );
        gated.push(...queued);
        for (const s of gated) st.status[s.id] = 'awaiting_confirmation';
        const pending = gated.map((s) => ({
          ...this.preview(s, scope),
          ...this.needsConfirmation(s, scope),
        }));
        return { status: 'awaiting_confirmation', state: st, pending };
      }

      const outcomes = await Promise.all(runnable.map((s) => this.runStep(s, scope, st)));
      const clarification = outcomes.find((o) => o?.clarification)?.clarification;
      if (clarification) return { status: 'needs_clarification', state: st, clarification };
    }

    this.markRepaired(steps, st);
    return { status: overallStatus(steps, st), state: st };
  }

  skipBlocked(open, deps, st) {
    for (const step of open) {
      const blocker = deps[step.id].find((d) => UNSETTLED.has(st.status[d]));
      if (!blocker) continue;
      st.status[step.id] = 'skipped';
      this.trace.emit('step_skipped', {
        stepId: step.id,
        label: labelOf(step),
        reason: `depends on ${blocker}`,
      });
    }
  }

  /** A failed or skipped step counts as repaired once every step added to repair it has completed. */
  markRepaired(steps, st) {
    const repairers = steps.filter((s) => s.repairs?.length);
    for (const id of new Set(repairers.flatMap((s) => s.repairs))) {
      if (!UNSETTLED.has(st.status[id])) continue;
      const fixes = repairers.filter((s) => s.repairs.includes(id));
      if (fixes.every((s) => st.status[s.id] === 'completed')) {
        st.status[id] = 'repaired';
        this.trace.emit('step_repaired', { stepId: id });
      }
    }
  }

  /**
   * Steps that change data run in plan order ("create, then send"; "publish, then enable"), even
   * when the planner did not link them with a reference. Reads and data ops still run in parallel,
   * and an earlier write that failed does not block later ones — it only has to have finished.
   */
  waitsForEarlierWrite(steps, index, st) {
    if (!this.changesData(steps[index])) return false;
    return steps.slice(0, index).some((s) => this.changesData(s) && isOpen(st.status[s.id]));
  }

  changesData(step) {
    return Boolean(step.action) && this.registry.get(step.action)?.effect !== 'read';
  }

  isApproved(step, state) {
    return state.approved === true || state.approvedSteps.includes(step.id);
  }

  needsConfirmation(step, scope) {
    if (!step.action) return null;
    const { effect } = this.registry.get(step.action);
    const count = step.foreach ? asList(resolveValue(step.foreach, scope)).length : 1;
    if (count === 0) return null;
    if (effect === 'external') return { reason: 'externally visible', count };
    if (effect === 'destructive') return { reason: 'destructive', count };
    if (effect === 'write' && count > this.bulkThreshold)
      return { reason: `bulk change (${count} records)`, count };
    return null;
  }

  preview(step, scope) {
    const action = this.registry.get(step.action);
    const list = step.foreach ? asList(resolveValue(step.foreach, scope)) : [null];
    return {
      stepId: step.id,
      action: action.id,
      title: action.title,
      label: step.label ?? action.title,
      effect: action.effect,
      count: list.length,
      sample: list
        .slice(0, PREVIEW_SAMPLES)
        .map((item, index) => resolveValue(step.args ?? {}, { ...scope, item, index })),
      targets: step.foreach ? list.slice(0, PREVIEW_TARGETS).map(displayName) : [],
    };
  }

  async runStep(step, scope, st) {
    const label = labelOf(step);
    st.status[step.id] = 'running';
    this.trace.emit('step_start', {
      stepId: step.id,
      label,
      action: step.action ?? null,
      op: step.op ?? null,
    });
    try {
      if (step.op) return this.completeOp(step, scope, st, label);
      if (step.foreach) return await this.runForeach(step, scope, st, label);

      const args = resolveValue(step.args ?? {}, scope);
      const res = await this.fetchAll(step, args, await this.invoke(step, args, scope), scope);
      if (!res.ok) return this.fail(step, st, label, res.error);

      let result = res.result;
      if (step.expect === 'one' && Array.isArray(result?.items)) {
        if (result.items.length !== 1) {
          const entity = step.entity ?? this.registry.get(step.action).module.replace(/s$/, '');
          const clarification = clarificationFor(step, args, result, entity);
          st.status[step.id] = 'failed';
          st.errors[step.id] = { code: clarification.kind.toUpperCase(), message: clarification.question };
          this.trace.emit('clarify', clarification);
          return { clarification };
        }
        result = { ...result, item: result.items[0] };
      }

      st.results[step.id] = result;
      st.status[step.id] = 'completed';
      const isList = Array.isArray(result?.items);
      this.trace.emit('step_done', {
        stepId: step.id,
        label,
        action: step.action,
        count: isList ? (result.total ?? result.items.length) : undefined,
        record: isList ? undefined : digestRecord(result, 6),
      });
      return null;
    } catch (error) {
      return this.fail(step, st, label, { code: error.code ?? 'EXECUTION', message: error.message });
    }
  }

  completeOp(step, scope, st, label) {
    const out = runOp(step, scope);
    st.results[step.id] = out;
    st.status[step.id] = 'completed';
    this.trace.emit('step_done', {
      stepId: step.id,
      label,
      op: step.op,
      count: Array.isArray(out) ? out.length : out,
    });
    return null;
  }

  fail(step, st, label, error) {
    st.status[step.id] = 'failed';
    st.errors[step.id] = error;
    this.trace.emit('step_failed', { stepId: step.id, label, action: step.action ?? null, error });
    return null;
  }

  /** Runs an action once per item with a small worker pool; each item succeeds or fails on its own. */
  async runForeach(step, scope, st, label) {
    const list = asList(resolveValue(step.foreach, scope));
    const results = [];
    const failed = [];
    let next = 0;
    let finished = 0;
    const worker = async () => {
      while (next < list.length) {
        const index = next++;
        const itemScope = { ...scope, item: list[index], index };
        const args = resolveValue(step.args ?? {}, itemScope);
        const res = await this.invoke(step, args, itemScope);
        if (res.ok) results[index] = res.result;
        else failed.push({ index, item: digestRecord(list[index], 5), args, error: res.error });
        // Items finish out of order under concurrency, so report how many are done, not the index.
        finished++;
        this.trace.emit('step_progress', { stepId: step.id, done: finished, total: list.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

    const items = results.filter(Boolean);
    st.results[step.id] = { items, failed, total: list.length };
    if (list.length && !items.length) {
      const reasons = [...new Set(failed.map((f) => f.error?.message))].slice(0, 2).join('; ');
      st.status[step.id] = 'failed';
      st.errors[step.id] = {
        code: 'ALL_FAILED',
        message: `All ${list.length} failed: ${reasons}`,
        examples: failed.slice(0, 3).map((f) => ({ ...f.error, args: f.args })),
      };
    } else {
      st.status[step.id] = 'completed';
    }
    this.trace.emit(st.status[step.id] === 'failed' ? 'step_failed' : 'step_done', {
      stepId: step.id,
      label,
      action: step.action,
      count: items.length,
      failedCount: failed.length,
      total: list.length,
      error: st.errors[step.id],
    });
    return null;
  }

  /** Searches default to 50 rows; when later steps use the result, fetch every match (up to 500). */
  async fetchAll(step, args, res, scope) {
    const items = res.result?.items;
    const acceptsLimit = this.registry.get(step.action)?.inputJsonSchema?.properties?.limit;
    if (!res.ok || !Array.isArray(items) || args.limit != null || !acceptsLimit) return res;
    if (!(res.result.total > items.length)) return res;
    return this.invoke(step, { ...args, limit: Math.min(res.result.total, MAX_FETCH) }, scope);
  }

  async invoke(step, args, scope) {
    const missing = unresolvedReferences(step.args ?? {}, scope);
    const res = missing.length
      ? { ok: false, error: { code: 'VALIDATION', message: describeUnresolved(missing, scope) }, ms: 0 }
      : await this.registry.invoke(step.action, args, this.ctx);
    this.trace.recordAction({
      id: step.action,
      args,
      ok: res.ok,
      error: res.error,
      ms: res.ms,
      stepId: step.id,
      repairs: res.repairs,
    });
    return res;
  }
}
