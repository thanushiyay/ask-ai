import { costOf } from './pricing.js';

/**
 * Latency milestones. Status/spinner events never count.
 *
 * - USEFUL: the first content that tells the user something specific about *their* request — the
 *   plan sentence ("I'll find last week's leads…"), a question, a confirmation, a step result or
 *   answer text. This is the assignment's "time to first useful response".
 * - GROUNDED: the stricter milestone — the first content backed by execution or a decision the user
 *   must act on (a step result, a question, a confirmation, answer text). The plan sentence is
 *   excluded because it is written before any data is read. Reporting both keeps the comparison
 *   with the baseline (which has no plan preview) honest.
 */
const USEFUL = new Set(['plan', 'plan_preview', 'clarify', 'confirm', 'step_done', 'final', 'answer_delta']);
const isEmbedding = (call) => call.purpose?.startsWith('embed');
const GROUNDED = new Set(['clarify', 'confirm', 'step_done', 'step_failed', 'final', 'answer_delta']);

export class Trace {
  constructor({ agent, requestId, message, emit }) {
    this.agent = agent;
    this.requestId = requestId;
    this.message = message;
    this.t0 = performance.now();
    this.startedAt = new Date().toISOString();
    this.events = [];
    this.llmCalls = [];
    this.actionCalls = [];
    this.firstUsefulMs = null;
    this.firstResultMs = null;
    this.endMs = null;
    this._emit = emit ?? (() => {});
  }

  now() {
    return Math.round((performance.now() - this.t0) * 10) / 10;
  }

  emit(type, data = {}) {
    const ev = { type, t: this.now(), ...data };
    this.events.push(ev);
    if (this.firstUsefulMs === null && USEFUL.has(type)) this.firstUsefulMs = ev.t;
    if (this.firstResultMs === null && GROUNDED.has(type)) this.firstResultMs = ev.t;
    this._emit(ev);
    return ev;
  }

  recordLlm({ model, purpose, inputTokens, cachedTokens, outputTokens, ms, retries = 0, error }) {
    const cost = costOf(model, { inputTokens, cachedTokens, outputTokens });
    const rec = {
      model,
      purpose,
      inputTokens,
      cachedTokens,
      outputTokens,
      ms: Math.round(ms),
      retries,
      cost,
      ...(error ? { error } : {}),
    };
    this.llmCalls.push(rec);
    return rec;
  }

  recordAction({ id, args, ok, error, ms, stepId, repairs }) {
    this.actionCalls.push({
      id,
      args,
      ok,
      error: error ?? null,
      ...(repairs?.length ? { repairs } : {}),
      ms: Math.round(ms * 100) / 100,
      stepId: stepId ?? null,
    });
  }

  finish(outcome) {
    this.endMs = this.now();
    this.outcome = outcome;
    return this.summary();
  }

  summary() {
    const sum = (k) => this.llmCalls.reduce((a, c) => a + (c[k] ?? 0), 0);
    return {
      agent: this.agent,
      requestId: this.requestId,
      outcome: this.outcome ?? null,
      firstUsefulMs: this.firstUsefulMs,
      firstResultMs: this.firstResultMs,
      totalMs: this.endMs ?? this.now(),
      // Chat-completion calls; embedding lookups are counted separately (they are ~100× cheaper).
      modelCalls: this.llmCalls.filter((c) => !isEmbedding(c)).length,
      embeddingCalls: this.llmCalls.filter(isEmbedding).length,
      failedModelCalls: this.llmCalls.filter((c) => c.error).length,
      retries: sum('retries'),
      inputTokens: sum('inputTokens'),
      cachedTokens: sum('cachedTokens'),
      outputTokens: sum('outputTokens'),
      costUsd: Math.round(sum('cost') * 1e7) / 1e7,
      actionCalls: this.actionCalls.length,
      actionFailures: this.actionCalls.filter((a) => !a.ok).length,
    };
  }

  toJSON() {
    return {
      ...this.summary(),
      message: this.message,
      startedAt: this.startedAt,
      llmCalls: this.llmCalls,
      actionCalls: this.actionCalls,
      events: this.events,
    };
  }
}
