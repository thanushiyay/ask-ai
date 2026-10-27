import { z } from 'zod';
import { chat, describeLlmError, parseJson, LlmError } from './llm.js';
import { config } from './config.js';
import { Trace } from './trace.js';
import { Executor, validatePlan } from './execution/index.js';
import { mergeRepairSteps } from './execution/repair.js';
import { plannerNotes, plannerSystemPrompt, plannerUserPrompt } from './prompts.js';
import { renderContext, writtenRecords } from './session.js';
import { templateSummary, wantsLlmSummary, llmSummary, stepFacts } from './summarizer.js';
import { digestResult } from './digest.js';

const PlanSchema = z.object({
  message: z.string().default(''),
  kind: z.enum(['execute', 'clarify', 'unsupported', 'answer', 'need_tools']),
  steps: z
    .array(z.looseObject({ id: z.string() }))
    .optional()
    .default([]),
  question: z.string().optional(),
  options: z.array(z.any()).optional(),
  assumptions: z.array(z.string()).optional().default([]),
  queries: z.array(z.string()).optional(),
  final: z.boolean().optional().default(true),
});

const YES =
  /^\s*(y|yes|yep|yeah|confirm(ed)?|go ahead|do it|proceed|ok(ay)?|sure|approved?|send (them|it))\b[\s.!]*$/i;
const NO = /^\s*(n|no|nope|cancel|stop|don'?t|abort|never ?mind)\b/i;
const MESSAGE_FIELD = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const RECOVERABLE_ERRORS = new Set(['VALIDATION', 'UNKNOWN_ACTION', 'NOT_FOUND', 'EXECUTION']);
const FACTS_LIMIT = 8000;
const PLAN_PARSE_ATTEMPTS = 2;
const PLAN_MAX_TOKENS = 2500;
const EXTRA_TOOLS = 8;
const MAX_HISTORY = 40;
const STOPPED_REPLY = 'Stopped — nothing was changed.';

const FALLBACK_PLAN = {
  kind: 'answer',
  message: 'Sorry — I could not form a plan for that. Could you rephrase it?',
  steps: [],
  assumptions: [],
  final: true,
};

const stepView = (s, extra = {}) => ({
  id: s.id,
  label: s.label ?? s.action ?? s.op,
  action: s.action ?? null,
  op: s.op ?? null,
  ...extra,
});

function confirmationLine(p) {
  const count = p.count > 1 ? ` for ${p.count} records` : '';
  const more = p.count > 5 ? `, +${p.count - 5} more` : '';
  const targets = p.targets.length ? ` (${p.targets.slice(0, 5).join(', ')}${more})` : '';
  return `• ${p.label}${count}${targets} — ${p.reason}`;
}

/** Retrieve tools, plan once, execute the plan in code, then summarize from execution facts. */
export class OptimizedAgent {
  constructor({ registry, index }) {
    this.registry = registry;
    this.index = index;
    this.system = plannerSystemPrompt(registry);
    this.name = 'optimized';
  }

  /**
   * `signal` aborts the request while it is still planning. Once a plan starts executing it runs to
   * the end and is reported, so the user never ends up with half-applied changes nobody told them about.
   */
  async handle({ session, world, message, confirm, cancel, requestId, onEvent, signal }) {
    const trace = new Trace({ agent: this.name, requestId, message, emit: onEvent });
    const ctx = { db: world.db, clock: world.clock, actor: 'ask-ai', signal };
    const text = (message ?? '').trim();
    let result;

    try {
      const awaitingConfirmation = session.pending?.kind === 'confirm';
      if (!awaitingConfirmation && !text) {
        result = this.respond(
          trace,
          'answer',
          confirm || cancel
            ? "There's nothing waiting for your approval right now."
            : 'Tell me what you would like to do, for example "Create a follow-up task for Sarah Johnson tomorrow".',
        );
      } else if (awaitingConfirmation && (confirm || (!cancel && YES.test(text)))) {
        result = await this.resume(session, ctx, trace);
      } else if (awaitingConfirmation && (cancel || NO.test(text))) {
        session.pending = null;
        result = this.respond(trace, 'cancelled', 'Cancelled — nothing was changed.');
      } else {
        result = await this.plan(session, ctx, trace, text);
      }
    } catch (error) {
      if (error instanceof LlmError && error.aborted) {
        result = this.respond(trace, 'cancelled', STOPPED_REPLY);
      } else {
        const reply =
          error instanceof LlmError
            ? `I couldn't get an answer from the language model: ${describeLlmError(error)}. Nothing was changed.`
            : `Something went wrong on my side (${error.message}). Nothing was changed.`;
        trace.emit('error', { message: error.message });
        result = this.respond(trace, 'error', reply);
      }
    }

    if (text) session.history.push({ role: 'user', text });
    else if (confirm) session.history.push({ role: 'user', text: '(confirmed)' });
    else if (cancel) session.history.push({ role: 'user', text: '(cancelled)' });
    session.history.push({ role: 'assistant', text: result.reply });
    if (session.history.length > MAX_HISTORY) session.history.splice(0, session.history.length - MAX_HISTORY);
    return { ...result, trace };
  }

  respond(trace, outcome, reply) {
    trace.emit('final', { text: reply, outcome });
    return { outcome, reply };
  }

  async plan(session, ctx, trace, text) {
    trace.emit('status', { text: 'Understanding your request…' });
    const request = this.requestFor(session.pending, text);
    const toolIds = await this.retrieveTools(session, trace, text);
    const { plan, run, failure } = await this.planAndExecute({ session, ctx, trace, text, toolIds });

    if (failure) return failure;
    if (plan.kind === 'clarify') return this.askForClarification(session, trace, plan, request);
    if (plan.kind !== 'execute') {
      session.pending = null;
      return this.respond(trace, plan.kind === 'answer' ? 'answer' : 'unsupported', plan.message);
    }
    return this.settle(session, trace, plan, run, request);
  }

  /**
   * The request this turn works on. A clarification answer completes the original request; a new
   * message while a confirmation is pending changes it; otherwise the message is the request.
   */
  requestFor(pending, text) {
    if (pending?.kind === 'clarify') return pending.request;
    if (pending?.kind === 'confirm') return `${pending.request}\nChange requested: ${text}`;
    return text;
  }

  /** Turns an execution result into the next user-facing outcome: pause, question or final answer. */
  settle(session, trace, plan, run, request) {
    if (run.status === 'awaiting_confirmation')
      return this.requestConfirmation(session, trace, plan, run, request);
    if (run.status === 'needs_clarification') {
      const { question, options } = run.clarification;
      session.pending = { kind: 'clarify', request, question, options };
      return this.respond(trace, 'clarify', question);
    }
    return this.finish(session, plan, run, request, trace);
  }

  async retrieveTools(session, trace, text) {
    const previousSteps = [...(session.last?.plan?.steps ?? []), ...(session.pending?.plan?.steps ?? [])];
    const sticky = [...new Set(previousSteps.map((s) => s.action).filter(Boolean))];
    const query = [text, session.pending?.request, session.last?.request].filter(Boolean).join(' \n ');
    const retrieval = await this.index.search(query, { sticky, trace });
    trace.emit('retrieval', { tools: retrieval.ids, top: retrieval.top, ms: Math.round(retrieval.ms) });
    return retrieval.ids;
  }

  /**
   * Bounded planning loop (at most config.maxPlannerCalls model calls). Handles requests for more
   * tools, invalid plans, `final: false` continuations and one repair pass for recoverable failures.
   */
  async planAndExecute({ session, ctx, trace, text, toolIds: initialTools }) {
    const execState = { results: {}, status: {}, errors: {}, approvedSteps: [] };
    const budget = config.maxPlannerCalls;
    let toolIds = initialTools;
    let notes = '';
    let steps = [];
    let calls = 0;
    let plan;
    let run;

    while (calls < budget) {
      calls++;
      plan = await this.callPlanner({ session, ctx, trace, text, toolIds, notes });

      if (plan.kind === 'need_tools' && calls >= budget) {
        plan = {
          ...FALLBACK_PLAN,
          message: "I couldn't find the right actions for that. Could you rephrase it?",
        };
        break;
      }
      if (plan.kind === 'need_tools') {
        const extra = await this.index.search((plan.queries ?? [text]).join(' '), { k: EXTRA_TOOLS, trace });
        toolIds = [...new Set([...toolIds, ...extra.ids])];
        trace.emit('retrieval', { tools: extra.ids, reason: 'planner requested more tools' });
        notes = plannerNotes.moreTools(extra.ids);
        continue;
      }
      if (plan.kind === 'execute' && !plan.steps.length) plan.kind = 'answer';
      if (plan.kind !== 'execute') break;

      const problems = validatePlan(plan, this.registry);
      if (problems.length) {
        const detail = problems.join('; ');
        if (calls < budget) {
          notes = plannerNotes.rejected(detail);
          trace.emit('status', { text: 'Refining the plan…' });
          continue;
        }
        trace.emit('final', { text: `I couldn't build a valid plan (${detail}).`, outcome: 'failed' });
        return {
          failure: {
            outcome: 'failed',
            reply: `I couldn't build a valid plan for that (${detail}). Nothing was changed.`,
          },
        };
      }

      if (!ctx.committed && ctx.signal?.aborted)
        throw new LlmError('Request stopped', null, { aborted: true });
      const newSteps = plan.steps.map((s) => ({ ...s }));
      steps = [...steps.filter((s) => !newSteps.some((n) => n.id === s.id)), ...newSteps];
      trace.emit('plan', {
        message: plan.message,
        assumptions: plan.assumptions,
        steps: newSteps.map((s) => stepView(s, { foreach: Boolean(s.foreach) })),
      });
      run = await this.execute({ steps }, execState, ctx, trace);
      plan = { ...plan, steps };

      if (run.status === 'awaiting_confirmation' || run.status === 'needs_clarification') break;

      if (plan.final === false && calls < budget) {
        notes = plannerNotes.continuation(this.factsJson(plan, run));
        trace.emit('status', { text: 'Looking at the results to plan the next steps…' });
        continue;
      }

      if (run.status !== 'completed' && calls < budget && this.isRecoverable(run)) {
        calls++;
        const repaired = await this.repair({
          session,
          ctx,
          trace,
          text,
          toolIds,
          plan,
          run,
          steps,
          execState,
        });
        if (repaired) ({ plan, run, steps } = repaired);
      }
      break;
    }

    return { plan, run };
  }

  async repair({ session, ctx, trace, text, toolIds, plan, run, steps, execState }) {
    trace.emit('status', { text: 'Recovering from a failed step…' });
    const notes = plannerNotes.repair(this.factsJson(plan, run));
    const fix = await this.callPlanner({ session, ctx, trace, text, toolIds, notes });
    if (fix.kind !== 'execute') return null;

    const added = mergeRepairSteps(steps, run.state, fix.steps ?? []);
    const candidate = [...steps, ...added];
    if (!added.length || validatePlan({ steps: candidate }, this.registry).length) return null;

    trace.emit('plan', {
      message: fix.message,
      assumptions: fix.assumptions,
      steps: added.map((s) => stepView(s, { foreach: Boolean(s.foreach) })),
      repair: true,
    });
    const repairedRun = await this.execute({ steps: candidate }, execState, ctx, trace);
    return { plan: { ...plan, steps: candidate }, run: repairedRun, steps: candidate };
  }

  execute(plan, state, ctx, trace) {
    ctx.committed = true;
    const executor = new Executor({
      registry: this.registry,
      ctx,
      trace,
      bulkThreshold: config.bulkConfirmThreshold,
    });
    return executor.run(plan, state);
  }

  isRecoverable(run) {
    const recoverable = (error) =>
      RECOVERABLE_ERRORS.has(error?.code) ||
      Boolean(error?.details?.problems?.length) ||
      (error?.code === 'ALL_FAILED' && (error.examples ?? []).some((e) => RECOVERABLE_ERRORS.has(e?.code)));
    return Object.entries(run.state.errors).some(
      ([id, error]) => run.state.status[id] === 'failed' && recoverable(error),
    );
  }

  factsJson(plan, run) {
    return JSON.stringify(stepFacts(this.registry, plan, run.state)).slice(0, FACTS_LIMIT);
  }

  askForClarification(session, trace, plan, request) {
    const question = plan.question ?? plan.message;
    const options = plan.options ?? [];
    session.pending = { kind: 'clarify', request, question, options };
    trace.emit('clarify', { question, options, message: plan.message });
    const reply = plan.message && plan.message !== question ? `${plan.message}\n\n${question}` : question;
    return this.respond(trace, 'clarify', reply);
  }

  requestConfirmation(session, trace, plan, run, request) {
    session.pending = { kind: 'confirm', request, plan, state: run.state, preview: run.pending };
    const reply = `${plan.message}\n\nBefore I continue, please confirm:\n${run.pending.map(confirmationLine).join('\n')}`;
    trace.emit('confirm', { pending: run.pending, message: reply });
    return this.respond(trace, 'confirm', reply);
  }

  /**
   * Continues a confirmed plan without a model call. Approval covers the steps the user saw; steps a
   * repair adds afterwards are new and pause for their own confirmation if they are risky.
   */
  async resume(session, ctx, trace) {
    const { plan, state, request, preview } = session.pending;
    trace.emit('status', { text: 'Confirmed — continuing…' });
    trace.emit('plan', {
      message: 'Continuing the confirmed plan.',
      steps: plan.steps.map((s) =>
        stepView(s, { status: state.status[s.id] === 'completed' ? 'done' : undefined }),
      ),
      resumed: true,
    });
    // Only the steps shown in the confirmation card are approved. A risky step that could not be
    // previewed yet (its targets depend on steps that had not run) pauses for its own confirmation.
    const approvedSteps = [...new Set([...(state.approvedSteps ?? []), ...preview.map((p) => p.stepId)])];
    let current = { plan, run: await this.execute(plan, { ...state, approvedSteps }, ctx, trace) };

    // A run that paused (for the next confirmation or a question) is not a failure to repair.
    const paused = ['awaiting_confirmation', 'needs_clarification'].includes(current.run.status);
    if (!paused && current.run.status !== 'completed' && this.isRecoverable(current.run)) {
      const toolIds = await this.retrieveTools(session, trace, request);
      session.pending = null;
      const repaired = await this.repair({
        session,
        ctx,
        trace,
        text: request,
        toolIds,
        plan,
        run: current.run,
        steps: plan.steps,
        execState: current.run.state,
      });
      if (repaired) current = repaired;
    }

    session.pending = null;
    return this.settle(session, trace, current.plan, current.run, request);
  }

  async finish(session, plan, run, request, trace) {
    const reply = await this.summarize(plan, run, request, trace);
    const outcome = run.status;
    const completedReads = (plan.steps ?? []).filter(
      (s) =>
        s.action && this.registry.get(s.action).effect === 'read' && run.state.status[s.id] === 'completed',
    );

    session.pending = null;
    session.last = {
      request,
      plan,
      outcome,
      written: writtenRecords(this.registry, plan, run.state),
      reads: completedReads.map((s) => ({
        step: s.id,
        action: s.action,
        result: digestResult(run.state.results[s.id], 15),
      })),
    };
    trace.emit('final', {
      text: reply,
      outcome,
      facts: stepFacts(this.registry, plan, run.state).map(({ result: _result, ...fact }) => fact),
    });
    return { outcome, reply };
  }

  /** Writes the answer with the small model, falls back to the planner model, then to the template. */
  async summarize(plan, run, request, trace) {
    if (!wantsLlmSummary(this.registry, plan, run)) return templateSummary(this.registry, plan, run);
    const models = [...new Set([config.summaryModel, config.plannerModel])];
    for (const model of models) {
      try {
        const reply = await llmSummary({
          registry: this.registry,
          plan,
          run,
          request,
          trace,
          model,
          onDelta: (delta) => trace.emit('answer_delta', { delta }),
        });
        if (reply) return reply;
      } catch (error) {
        trace.emit('warning', { message: `Answer model ${model} failed: ${error.message}` });
      }
    }
    return templateSummary(this.registry, plan, run);
  }

  async callPlanner({ session, ctx, trace, text, toolIds, notes }) {
    const messages = [
      { role: 'system', content: this.system },
      {
        role: 'user',
        content: plannerUserPrompt({
          calendar: ctx.clock.calendar(),
          context: renderContext(session),
          tools: this.index.describe(toolIds),
          message: text || '(user confirmed)',
          extra: notes,
        }),
      },
    ];

    // Surface the plan's first sentence as soon as its "message" field has streamed in.
    let previewed = false;
    const onDelta = (_, full) => {
      if (previewed) return;
      const match = MESSAGE_FIELD.exec(full);
      if (!match) return;
      previewed = true;
      try {
        trace.emit('plan_preview', { message: JSON.parse(`"${match[1]}"`) });
      } catch {
        // A partially escaped string cannot be previewed; the full plan event follows shortly.
      }
    };

    for (let attempt = 0; attempt < PLAN_PARSE_ATTEMPTS; attempt++) {
      const res = await chat({
        model: config.plannerModel,
        messages,
        json: true,
        maxTokens: PLAN_MAX_TOKENS,
        trace,
        purpose: attempt ? 'plan_repair' : 'plan',
        onDelta,
        // After the first step has run, finish and report rather than abandon a half-done plan.
        signal: ctx.committed ? undefined : ctx.signal,
      });
      const parsed = PlanSchema.safeParse(parseJson(res.content));
      if (parsed.success) return parsed.data;

      const issues = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      messages.push(
        { role: 'assistant', content: res.content },
        { role: 'user', content: plannerNotes.invalidJson(issues) },
      );
    }
    return { ...FALLBACK_PLAN };
  }
}
