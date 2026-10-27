import { chat } from './llm.js';
import { config } from './config.js';
import { SUMMARY_SYSTEM } from './prompts.js';
import { digestResult, displayName } from './digest.js';

const SUMMARY_MAX_TOKENS = 400;
const SUMMARY_INPUT_LIMIT = 24_000;
const LIST_LIMIT = 5;
const MONEY_FIELDS = ['balance', 'amount', 'value', 'total'];
const DATE_FIELDS = [
  ['startAt', 'on'],
  ['dueDate', 'due'],
  ['closeDate', 'closes'],
];
const HEADLINES = {
  completed: 'Done.',
  partial: 'Partly done.',
  failed: "I couldn't complete this.",
};

const actionSteps = (plan) => (plan.steps ?? []).filter((s) => s.action);
const isReadOnly = (registry, plan) =>
  actionSteps(plan).every((s) => registry.get(s.action)?.effect === 'read');

/** Compact, model-ready record of what each step did. */
export function stepFacts(registry, plan, state) {
  return (plan.steps ?? []).map((s) => {
    const fact = {
      id: s.id,
      label: s.label ?? s.action ?? s.op,
      ...(s.action ? { action: s.action, effect: registry.get(s.action)?.effect } : { op: s.op }),
      status: state.status[s.id] ?? 'not_run',
    };
    if (state.errors[s.id]) fact.error = state.errors[s.id].message ?? state.errors[s.id];
    if (state.results[s.id] !== undefined) fact.result = digestResult(state.results[s.id], s.op ? 10 : 15);
    return fact;
  });
}

/** One readable line per record: name, status, money and the date that matters. */
function describeRecord(record) {
  if (record == null || typeof record !== 'object') return String(record);
  const parts = [displayName(record)];
  const status = record.stageName ?? record.status;
  if (typeof status === 'string') parts.push(status.replace(/_/g, ' '));
  const money = MONEY_FIELDS.find((k) => typeof record[k] === 'number');
  if (money) parts.push(`${money === 'balance' ? 'balance ' : ''}$${record[money].toLocaleString('en-US')}`);
  if (record.daysOverdue > 0) parts.push(`${record.daysOverdue} days overdue`);
  const date = DATE_FIELDS.find(([key]) => record[key]);
  if (date) parts.push(`${date[1]} ${String(record[date[0]]).slice(0, 10)}`);
  return parts.join(' · ');
}

function describeList(items, total) {
  const shown = items.slice(0, LIST_LIMIT).map(describeRecord).join('; ');
  return total > LIST_LIMIT ? `${shown}; and ${total - LIST_LIMIT} more` : shown;
}

function describeCompleted(step, result, label, readOnly) {
  if (step.foreach) {
    if (result.total === 0) return { bucket: 'empty', text: `${label}: nothing to do, no matching records` };
    const failures = result.failed.length
      ? ` (${result.failed.length} couldn't be done — ${result.failed[0].error.message})`
      : '';
    return { bucket: 'done', text: `${label}: ${result.items.length} done${failures}` };
  }
  if (Array.isArray(result?.items)) {
    const total = result.total ?? result.items.length;
    if (!total) return { bucket: 'done', text: `${label}: none found` };
    if (!readOnly) return { bucket: 'done', text: `${label}: ${total} found` };
    return {
      bucket: 'done',
      text: `${label}: ${describeList(result.item ? [result.item] : result.items, total)}`,
    };
  }
  return { bucket: 'done', text: `${label}: ${readOnly ? describeRecord(result) : displayName(result)}` };
}

/** Deterministic answer from execution facts: free, instant, and the fallback when no model is available. */
export function templateSummary(registry, plan, run) {
  const readOnly = isReadOnly(registry, plan);
  const lines = { done: [], empty: [], problems: [], waiting: [] };

  for (const step of actionSteps(plan)) {
    const action = registry.get(step.action);
    const status = run.state.status[step.id];
    const label = step.label ?? action?.title ?? step.action;
    if (status === 'completed') {
      if (action?.effect === 'read' && !readOnly) continue;
      const { bucket, text } = describeCompleted(step, run.state.results[step.id], label, readOnly);
      lines[bucket].push(text);
    } else if (status === 'failed') {
      const reason = run.state.errors[step.id]?.message ?? 'it failed';
      lines.problems.push(`Couldn't ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${reason}`);
    } else if (status === 'skipped') {
      lines.problems.push(`Skipped "${label}" because an earlier step failed`);
    } else if (status === 'awaiting_confirmation') {
      lines.waiting.push(`${label} — waiting for your OK`);
    }
  }

  let headline = HEADLINES[run.status] ?? '';
  if (run.status === 'completed' && readOnly) headline = "Here's what I found:";
  if (run.status === 'completed' && lines.empty.length && !lines.done.length) {
    headline = 'Nothing needed doing: no records matched all the conditions.';
  }
  const bullets = [...lines.done, ...lines.empty, ...lines.problems, ...lines.waiting].map((l) => `- ${l}`);
  return [headline, ...bullets].filter(Boolean).join('\n');
}

/** Questions, multi-step runs and partial failures read better written by a model; simple runs do not. */
export function wantsLlmSummary(registry, plan, run) {
  if (config.summaryMode === 'template') return false;
  if (config.summaryMode === 'llm') return true;
  const steps = actionSteps(plan);
  const partialFanOut = steps.some((s) => run.state.results[s.id]?.failed?.length);
  const usesOps = (plan.steps ?? []).some((s) => s.op);
  return isReadOnly(registry, plan) || steps.length > 2 || partialFanOut || usesOps;
}

export async function llmSummary({
  registry,
  plan,
  run,
  request,
  trace,
  onDelta,
  model = config.summaryModel,
}) {
  const context = [
    `User request: ${request}`,
    `Plan intent: ${plan.message}`,
    plan.assumptions?.length ? `Assumptions: ${plan.assumptions.join('; ')}` : null,
    `Run status: ${run.status}`,
    `Execution facts:\n${JSON.stringify(stepFacts(registry, plan, run.state))}`,
  ]
    .filter(Boolean)
    .join('\n');
  const res = await chat({
    model,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: context.slice(0, SUMMARY_INPUT_LIMIT) },
    ],
    maxTokens: SUMMARY_MAX_TOKENS,
    trace,
    purpose: 'summarize',
    onDelta,
  });
  return res.content.trim();
}
