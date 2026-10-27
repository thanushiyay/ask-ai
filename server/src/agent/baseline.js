import { chat, describeLlmError, LlmError } from './llm.js';
import { config } from './config.js';
import { Trace } from './trace.js';
import { signature } from '../core/registry.js';
import { digestResult } from './digest.js';

const TOOL = [
  {
    type: 'function',
    function: {
      name: 'call_action',
      description:
        'Execute one platform action by id with arguments. Call several in parallel when they are independent.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action id, e.g. "contacts.search"' },
          args: { type: 'object', description: 'Arguments object matching the action signature' },
        },
        required: ['action', 'args'],
      },
    },
  },
];
const YES = /^\s*(y|yes|yep|yeah|confirm(ed)?|go ahead|do it|proceed|ok(ay)?|sure|approved?)\b/i;
// The baseline replays its transcript on every call. Without a cap a long conversation eventually
// exceeds the model's context window and every later message fails, so only recent turns are kept.
const MAX_TRANSCRIPT_MESSAGES = 40;

/** Keeps the most recent messages, starting at a user turn so no tool result is left without its call. */
export function trimTranscript(messages, max = MAX_TRANSCRIPT_MESSAGES) {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== 'user') start++;
  return start < messages.length ? messages.slice(start) : messages.slice(-1);
}

export class BaselineAgent {
  constructor({ registry }) {
    this.registry = registry;
    this.name = 'baseline';
    const catalog = registry
      .list()
      .map((a) => `${signature(a)} [${a.effect}] — ${a.description}`)
      .join('\n');
    this.system = `You are Ask AI, an assistant inside a CRM / business platform. Complete the user's request by calling platform actions with the call_action tool, then reply with a concise summary grounded in the tool results.
Rules: never invent IDs or results; resolve names to IDs with search actions; if essential information is missing, ask one focused question instead of acting; if the platform cannot do something, say so honestly. Destructive or externally visible actions (send, publish, launch, archive, cancel, delete, void...) require the user's explicit confirmation: if a call returns CONFIRMATION_REQUIRED, stop and ask the user to confirm, listing exactly what you will do. "Draft" means do not send.
Times are UTC. Arguments marked * are required.

# Actions
${catalog}`;
  }

  async handle({ session, world, message, confirm, cancel, requestId, onEvent, signal }) {
    const trace = new Trace({ agent: this.name, requestId, message, emit: onEvent });
    const ctx = { db: world.db, clock: world.clock, actor: 'ask-ai' };
    const st = session.baseline;
    const typed = (message ?? '').trim();
    if (cancel && !typed) {
      const reply = 'Cancelled — nothing was changed.';
      st.approved = false;
      st.messages.push(
        { role: 'user', content: 'Cancel. Do not do the pending actions.' },
        { role: 'assistant', content: reply },
      );
      trace.emit('final', { text: reply, outcome: 'cancelled' });
      return { reply, outcome: 'cancelled', trace };
    }
    const text = confirm && !typed ? 'Yes, I confirm — go ahead.' : typed;
    if (!text) {
      const reply = 'Tell me what you would like to do.';
      trace.emit('final', { text: reply, outcome: 'answer' });
      return { reply, outcome: 'answer', trace };
    }
    st.approved = Boolean(confirm) || YES.test(text ?? '');
    st.messages.push({
      role: 'user',
      content: `${text}\n\n(Current time: ${JSON.stringify(ctx.clock.calendar())})`,
    });
    trace.emit('status', { text: 'Thinking…' });
    let reply = '';
    let outcome = 'completed';
    let wroteSomething = false;
    let asked = false;
    try {
      for (let i = 0; i < config.baselineMaxIterations; i++) {
        st.messages = trimTranscript(st.messages);
        const res = await chat({
          model: config.baselineModel,
          messages: [{ role: 'system', content: this.system }, ...st.messages],
          signal,
          tools: TOOL,
          trace,
          purpose: 'react_step',
          maxTokens: 1500,
        });
        if (!res.toolCalls.length) {
          reply = res.content.trim() || 'I could not produce an answer for that. Could you rephrase it?';
          st.messages.push({ role: 'assistant', content: reply });
          break;
        }
        st.messages.push({
          role: 'assistant',
          content: res.content || null,
          tool_calls: res.toolCalls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.name, arguments: t.arguments },
          })),
        });
        const outs = await Promise.all(
          res.toolCalls.map(async (tc) => {
            let parsed;
            try {
              parsed = JSON.parse(tc.arguments || '{}');
            } catch {
              parsed = {};
            }
            const { action: id, args = {} } = parsed;
            const def = this.registry.get(id);
            trace.emit('step_start', { stepId: tc.id, label: def?.title ?? id, action: id });
            let out;
            if (def && ['destructive', 'external'].includes(def.effect) && !st.approved) {
              out = {
                ok: false,
                error: {
                  code: 'CONFIRMATION_REQUIRED',
                  message: `${def.title} is ${def.effect}; ask the user to confirm first`,
                },
              };
              asked = true;
              trace.recordAction({ id, args, ok: false, error: out.error, ms: 0, stepId: tc.id });
            } else {
              out = await this.registry.invoke(id, args, ctx);
              trace.recordAction({ id, args, ok: out.ok, error: out.error, ms: out.ms, stepId: tc.id });
              if (out.ok && def && def.effect !== 'read') wroteSomething = true;
            }
            trace.emit(out.ok ? 'step_done' : 'step_failed', {
              stepId: tc.id,
              label: def?.title ?? id,
              action: id,
              error: out.error,
            });
            const content = JSON.stringify(
              out.ok ? digestResult(out.result, 25) : { error: out.error },
            ).slice(0, 6000);
            return { role: 'tool', tool_call_id: tc.id, content };
          }),
        );
        st.messages.push(...outs);
        if (i === config.baselineMaxIterations - 1) {
          reply = 'I stopped after reaching the step limit; the request may be partly done.';
          outcome = 'partial';
        }
      }
    } catch (e) {
      const stopped = e instanceof LlmError && e.aborted;
      outcome = stopped ? 'cancelled' : 'error';
      const changed = wroteSomething
        ? 'Some actions may already have run — check Details.'
        : 'Nothing was changed.';
      reply = stopped
        ? `Stopped. ${changed}`
        : e instanceof LlmError
          ? `I couldn't get an answer from the language model: ${describeLlmError(e)}. ${changed}`
          : `Something went wrong on my side: ${e.message}. ${changed}`;
      if (!stopped) trace.emit('error', { message: e.message });
    }
    st.approved = false;
    if (outcome === 'completed') {
      if (asked && !wroteSomething) outcome = 'confirm';
      else if (!trace.actionCalls.length && /\?\s*$/.test(reply)) outcome = 'clarify';
      else if (!trace.actionCalls.length) outcome = 'answer';
      else if (trace.actionCalls.some((a) => !a.ok && a.error?.code !== 'CONFIRMATION_REQUIRED'))
        outcome = 'partial';
    }
    trace.emit('final', { text: reply, outcome });
    session.history.push({ role: 'user', text: text ?? '' }, { role: 'assistant', text: reply });
    return { reply, outcome, trace };
  }
}
