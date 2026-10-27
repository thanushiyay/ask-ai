import OpenAI from 'openai';
import { config } from './config.js';

let client;
const getClient = () =>
  (client ??= new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
    timeout: config.llmTimeoutMs,
    maxRetries: 0,
  }));

const isReasoningModel = (m) => /^(gpt-5|o\d)/.test(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAbort = (e, signal) => signal?.aborted || e?.name === 'AbortError' || e?.name === 'APIUserAbortError';
const retryable = (e) =>
  e?.status === 429 ||
  e?.status >= 500 ||
  e?.code === 'ETIMEDOUT' ||
  e?.name === 'APIConnectionError' ||
  e?.name === 'APIConnectionTimeoutError';

export class LlmError extends Error {
  constructor(message, cause, { aborted = false } = {}) {
    super(message);
    this.name = 'LlmError';
    this.cause = cause;
    this.status = cause?.status;
    this.aborted = aborted;
  }
}

/** A short, user-safe explanation of a model failure (no stack traces, no keys). */
export function describeLlmError(error) {
  const status = error?.status ?? error?.cause?.status;
  if (error?.aborted) return 'the request was stopped';
  if (status === 401) return 'the OpenAI API key was rejected — check OPENAI_API_KEY in server/.env';
  if (status === 403) return 'this API key does not have access to the configured model';
  if (status === 404) return 'the configured model was not found — check PLANNER_MODEL / SUMMARY_MODEL';
  if (status === 429) return 'the OpenAI rate limit or quota was reached — wait a moment or check billing';
  if (status >= 500) return 'OpenAI is having trouble right now — please try again';
  if (/OPENAI_API_KEY is not set/.test(error?.message)) return 'no OpenAI API key is configured';
  if (/timed? ?out/i.test(error?.message ?? '')) return 'the model took too long to respond';
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|Connection error/i.test(error?.message ?? ''))
    return 'the OpenAI API could not be reached — check your network connection';
  return error?.message ?? 'unknown error';
}

/**
 * chat({ model, messages, json, tools, toolChoice, onDelta, maxTokens, trace, purpose })
 * returns { content, toolCalls, usage, ms }
 */
export async function chat({
  model,
  messages,
  json = false,
  tools,
  toolChoice,
  onDelta,
  maxTokens,
  trace,
  purpose,
  temperature = 0,
  signal,
}) {
  if (!config.openaiApiKey) throw new LlmError('OPENAI_API_KEY is not set');
  if (signal?.aborted) throw new LlmError('Request stopped', null, { aborted: true });
  const options = signal ? { signal } : undefined;
  const body = {
    model,
    messages,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(tools ? { tools, tool_choice: toolChoice ?? 'auto', parallel_tool_calls: true } : {}),
    ...(isReasoningModel(model) ? { reasoning_effort: config.reasoningEffort } : { temperature }),
    ...(maxTokens ? { [isReasoningModel(model) ? 'max_completion_tokens' : 'max_tokens']: maxTokens } : {}),
  };

  let retries = 0;
  for (;;) {
    const started = performance.now();
    // Once text has been streamed to the user a retry would repeat it, so only fresh attempts retry.
    let streamed = false;
    try {
      let content = '';
      let toolCalls = [];
      let usage;
      if (onDelta) {
        const stream = await getClient().chat.completions.create(
          {
            ...body,
            stream: true,
            stream_options: { include_usage: true },
          },
          options,
        );
        const acc = {};
        for await (const chunk of stream) {
          if (chunk.usage) usage = chunk.usage;
          const d = chunk.choices?.[0]?.delta;
          if (!d) continue;
          if (d.content) {
            streamed = true;
            content += d.content;
            onDelta(d.content, content);
          }
          for (const tc of d.tool_calls ?? []) {
            acc[tc.index] ??= { id: tc.id, name: '', arguments: '' };
            if (tc.id) acc[tc.index].id = tc.id;
            if (tc.function?.name) acc[tc.index].name += tc.function.name;
            if (tc.function?.arguments) acc[tc.index].arguments += tc.function.arguments;
          }
        }
        toolCalls = Object.values(acc);
      } else {
        const res = await getClient().chat.completions.create(body, options);
        usage = res.usage;
        const msg = res.choices?.[0]?.message;
        if (!msg) throw Object.assign(new Error('The model returned no choices'), { status: 502 });
        content = msg.content ?? '';
        toolCalls = (msg.tool_calls ?? []).map((t) => ({
          id: t.id,
          name: t.function.name,
          arguments: t.function.arguments,
        }));
      }
      const ms = performance.now() - started;
      const u = {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      };
      trace?.recordLlm({ model, purpose, ...u, ms, retries });
      return { content, toolCalls, usage: u, ms };
    } catch (e) {
      const ms = performance.now() - started;
      const aborted = isAbort(e, signal);
      if (!aborted && !streamed && retries < config.llmMaxRetries && retryable(e)) {
        retries++;
        await sleep(Math.min(500 * 2 ** retries, 8000) + Math.random() * 250);
        continue;
      }
      trace?.recordLlm({
        model,
        purpose,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        ms,
        retries,
        error: aborted ? 'stopped by the user' : e.message,
      });
      throw new LlmError(`${purpose ?? 'LLM'} call failed: ${e.message}`, e, { aborted });
    }
  }
}

export async function embed(
  texts,
  { model = config.embeddingModel, trace, purpose = 'embed_query', signal } = {},
) {
  if (!config.openaiApiKey) throw new LlmError('OPENAI_API_KEY is not set');
  const started = performance.now();
  const res = await getClient().embeddings.create({ model, input: texts }, signal ? { signal } : undefined);
  trace?.recordLlm({
    model,
    purpose,
    inputTokens: res.usage?.prompt_tokens ?? 0,
    cachedTokens: 0,
    outputTokens: 0,
    ms: performance.now() - started,
  });
  return { vectors: res.data.map((d) => d.embedding), tokens: res.usage?.prompt_tokens ?? 0 };
}

/** Parse a JSON object out of model output (tolerates code fences / leading prose). */
export function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      /* fall through */
    }
  }
  return null;
}
