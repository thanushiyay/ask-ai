import { reactive } from 'vue';

export function createAssistantMessage() {
  return reactive({
    role: 'assistant',
    status: 'running',
    statusText: 'Reading your request…',
    preview: '',
    planMessage: '',
    assumptions: [],
    steps: [],
    clarify: null,
    confirm: null,
    streamText: '',
    text: '',
    outcome: null,
    metrics: null,
    error: null,
    createdAt: Date.now(),
  });
}

function findOrCreateStep(message, id, event) {
  let step = message.steps.find((s) => s.id === id);
  if (!step) {
    step = reactive({
      id,
      label: event.label ?? event.action ?? id,
      action: event.action ?? null,
      op: event.op ?? null,
      status: 'pending',
    });
    message.steps.push(step);
  }
  return step;
}

const errorText = (error) => (typeof error === 'string' ? error : (error?.message ?? null));

/** Applies one server-sent event to an assistant message. Mirrors the server's event contract. */
export function applyChatEvent(message, type, event = {}) {
  const step = (id) => findOrCreateStep(message, id, event);

  switch (type) {
    case 'status':
      if (event.text) message.statusText = event.text;
      break;
    case 'plan_preview':
      message.preview = event.message ?? '';
      break;
    case 'plan':
      if (!event.resumed && !event.repair) {
        message.planMessage = event.message ?? '';
        message.assumptions = event.assumptions ?? [];
      }
      for (const s of event.steps ?? []) {
        Object.assign(
          step(s.id),
          { label: s.label ?? s.action ?? s.op ?? s.id, action: s.action, op: s.op },
          s.status ? { status: s.status } : {},
        );
      }
      break;
    case 'step_start':
      if (event.stepId) Object.assign(step(event.stepId), { status: 'running', error: null });
      break;
    case 'step_progress':
      if (event.stepId) step(event.stepId).progress = { done: event.done, total: event.total };
      break;
    case 'step_done':
      if (!event.stepId) break;
      Object.assign(step(event.stepId), {
        status: 'done',
        count: event.count,
        failedCount: event.failedCount,
        total: event.total,
        record: event.record,
        progress: null,
      });
      break;
    case 'step_failed':
      if (!event.stepId) break;
      Object.assign(step(event.stepId), {
        status: 'failed',
        error: errorText(event.error),
        progress: null,
      });
      break;
    case 'step_repaired':
      if (event.stepId) Object.assign(step(event.stepId), { status: 'replaced', error: null });
      break;
    case 'step_skipped':
      if (event.stepId)
        Object.assign(step(event.stepId), {
          status: 'skipped',
          error: 'Skipped because an earlier step did not finish',
        });
      break;
    case 'clarify':
      message.clarify = { question: event.question ?? '', options: event.options ?? [] };
      // A lookup that matched several records (or none) pauses on that step until the user answers.
      if (event.stepId) Object.assign(step(event.stepId), { status: 'question', progress: null });
      break;
    case 'confirm':
      message.confirm = { pending: event.pending ?? [] };
      for (const p of event.pending ?? []) if (p.stepId) step(p.stepId).status = 'awaiting';
      break;
    case 'warning':
      // A streamed answer failed half way; the server will send a complete replacement.
      message.streamText = '';
      break;
    case 'answer_delta':
      message.streamText += event.delta ?? '';
      break;
    case 'final':
      message.text = event.text ?? '';
      message.outcome = event.outcome ?? null;
      break;
    case 'done':
      message.metrics = event;
      message.status = 'done';
      break;
    case 'error':
      message.error = { kind: 'server', text: event.message ?? 'Something went wrong on the server.' };
      break;
  }
}

/**
 * Called when a stream ends for any reason. Leaves the message in a state that always tells the
 * user something: never an empty bubble, never a step stuck spinning.
 */
export function settleMessage(message, { stopped = false } = {}) {
  message.status = 'done';
  // With a final answer the run ended normally, so unstarted steps simply did not run (e.g. the plan
  // paused for a question). Without one, the stream was cut and their outcome is unknown.
  const ended = Boolean(message.outcome);
  for (const s of message.steps) {
    if (s.status === 'running' || s.status === 'pending') {
      s.status = stopped ? 'stopped' : ended ? 'pending' : 'unknown';
      s.progress = null;
    }
  }
  const said = message.text || message.streamText || message.error || message.clarify || message.confirm;
  if (stopped && !message.text) {
    message.outcome = 'cancelled';
    message.text = message.steps.some((s) => s.status === 'done')
      ? 'Stopped watching. Steps marked done were applied, and a plan that had already started finishes on the server — check Data in Details for the result.'
      : 'Stopped. Ask AI was still planning, so nothing was changed.';
  } else if (!said) {
    message.error = {
      kind: 'server',
      text: 'The connection closed before an answer arrived. Open Details to see what ran, or try again.',
    };
  }
}
