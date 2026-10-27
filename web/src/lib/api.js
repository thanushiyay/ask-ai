const REQUEST_TIMEOUT_MS = 15_000;

/** An error the UI can show as-is. `kind` lets the UI choose the right wording and recovery. */
export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'server' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind; // 'offline' | 'busy' | 'invalid' | 'server' | 'aborted'
  }
}

async function errorFrom(res) {
  const detail = await res.json().catch(() => null);
  const message = detail?.error ?? `The server answered with an error (${res.status}).`;
  const kind = res.status === 409 ? 'busy' : res.status === 400 ? 'invalid' : 'server';
  return new ApiError(message, { status: res.status, kind });
}

function networkError(error) {
  if (error?.name === 'AbortError') return new ApiError('Stopped.', { kind: 'aborted' });
  return new ApiError("Can't reach the Ask AI server. Check that it is running, then try again.", {
    kind: 'offline',
  });
}

/** Parses one SSE block ("event: x\ndata: {...}"). Returns null for comments and malformed blocks. */
export function parseSseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

/** POSTs a chat turn and calls onEvent(type, data) for each server-sent event until the stream ends. */
export async function streamChat(body, onEvent, signal) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw networkError(error);
  }
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new ApiError('The server sent an empty response.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (final) => {
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : blocks.pop();
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (parsed) onEvent(parsed.event, parsed.data);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flush(false);
    }
    buffer += decoder.decode();
    flush(true);
  } catch (error) {
    throw networkError(error);
  } finally {
    reader.releaseLock?.();
  }
}

async function json(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: opts.signal ?? controller.signal });
    if (!res.ok) throw await errorFrom(res);
    return await res.json();
  } catch (error) {
    throw error instanceof ApiError ? error : networkError(error);
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (url, body) =>
  json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

export const api = {
  health: () => json('/api/health'),
  catalog: (q = '') => json(`/api/catalog?q=${encodeURIComponent(q)}`),
  searchTools: (query) => postJson('/api/catalog/search', { query }),
  reset: () => postJson('/api/reset'),
  data: () => json('/api/data'),
  collection: (name, q = '') =>
    json(`/api/data/${encodeURIComponent(name)}?limit=60&q=${encodeURIComponent(q)}`),
  traces: () => json('/api/traces'),
  trace: (id) => json(`/api/traces/${encodeURIComponent(id)}`),
  benchmark: () => json('/api/benchmark'),
};
