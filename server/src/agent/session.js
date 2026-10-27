import { randomUUID } from 'node:crypto';
import { digestRecord } from './digest.js';

const sessions = new Map();
// Sessions live in memory; the least recently used ones are dropped so a long-running server
// does not grow without bound.
const MAX_SESSIONS = 500;
const MAX_WRITTEN = 25;
const WRITTEN_FIELDS = 10;

export function createSession(id = randomUUID()) {
  const s = {
    id,
    createdAt: new Date().toISOString(),
    history: [],
    last: null,
    pending: null,
    baseline: { messages: [], approved: false },
  };
  sessions.set(id, s);
  evictIdleSessions();
  return s;
}

function evictIdleSessions() {
  for (const [id, session] of sessions) {
    if (sessions.size <= MAX_SESSIONS) break;
    if (!session.busy) sessions.delete(id);
  }
}

/** Returns the session, creating it if needed, and marks it as most recently used. */
export function getSession(id) {
  const existing = sessions.get(id);
  if (!existing) return createSession(id);
  sessions.delete(id);
  sessions.set(id, existing);
  return existing;
}
export const resetSessions = () => sessions.clear();

/** Records written by the run, grouped per step, with key fields + IDs. */
export function writtenRecords(registry, plan, state) {
  const out = [];
  for (const step of plan.steps ?? []) {
    if (!step.action || state.status[step.id] !== 'completed') continue;
    const a = registry.get(step.action);
    if (a.effect === 'read') continue;
    const res = state.results[step.id];
    const recs = res?.items && step.foreach ? res.items : res?.items ? [] : [res];
    out.push({
      step: step.id,
      action: step.action,
      count: recs.length,
      records: recs.slice(0, MAX_WRITTEN).map((r) => digestRecord(r, WRITTEN_FIELDS)),
    });
  }
  return out;
}

const compactPlan = (plan) =>
  (plan?.steps ?? []).map((s) => {
    const { id, action, op, foreach, args, expect, label, ...rest } = s;
    return {
      id,
      ...(action ? { action } : { op }),
      ...(foreach ? { foreach } : {}),
      ...(expect ? { expect } : {}),
      ...(args ? { args } : {}),
      ...(op ? rest : {}),
    };
  });

export function renderContext(session) {
  const parts = [];
  const turns = session.history.slice(-8);
  if (turns.length)
    parts.push(
      `Recent conversation:\n${turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text.slice(0, 400)}`).join('\n')}`,
    );
  if (session.pending?.kind === 'confirm') {
    parts.push(
      `PENDING CONFIRMATION for request "${session.pending.request}". The plan has NOT run its risky steps yet:\n${JSON.stringify(compactPlan(session.pending.plan))}\nAwaiting: ${JSON.stringify(session.pending.preview.map((p) => ({ step: p.stepId, action: p.action, count: p.count, targets: p.targets })))}\nIf the user changes the request, produce a complete new plan for the changed request.`,
    );
  }
  if (session.pending?.kind === 'clarify') {
    parts.push(
      `PENDING CLARIFICATION for request "${session.pending.request}". You (or the system) asked: "${session.pending.question}"${session.pending.options?.length ? `\nCandidates: ${JSON.stringify(session.pending.options.map((o) => (typeof o === 'string' ? o : { id: o.id, label: o.label })))}` : ''}\nThe user's new message is most likely the answer: plan the ORIGINAL request using it.`,
    );
  }
  if (session.last) {
    const l = session.last;
    parts.push(
      `Previous request: "${l.request}" -> outcome: ${l.outcome}\nPrevious plan: ${JSON.stringify(compactPlan(l.plan))}`,
    );
    if (l.written?.length)
      parts.push(
        `Records the previous plan created/changed (IDs usable directly):\n${JSON.stringify(l.written)}`,
      );
    if (l.reads?.length)
      parts.push(`Data the previous plan read (truncated):\n${JSON.stringify(l.reads).slice(0, 2500)}`);
  }
  return parts.join('\n\n');
}
