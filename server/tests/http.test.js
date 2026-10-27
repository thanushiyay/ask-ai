import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { createAgents } from '../src/agent/index.js';
import { createApp } from '../src/http/app.js';
import { getSession } from '../src/agent/session.js';

let server;
let base;

beforeAll(async () => {
  const registry = await loadRegistry();
  const { app } = createApp({ registry, agents: createAgents(registry), resultsDir: '/nonexistent' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const post = (url, body) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('HTTP API', () => {
  it('reports health with the full catalog', async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, modules: 50, actions: 500 });
  });

  it('filters the catalog by query', async () => {
    const { actions } = await (await fetch(`${base}/catalog?q=invoice`)).json();
    expect(actions.length).toBeGreaterThan(0);
    expect(
      actions.every((a) => `${a.id} ${a.title} ${a.description}`.toLowerCase().includes('invoice')),
    ).toBe(true);
  });

  it('returns retrieval results for a request', async () => {
    const res = await post('/catalog/search', { query: 'send overdue invoice reminders', mode: 'bm25' });
    const { ids } = await res.json();
    expect(ids).toContain('invoices.send_reminder');
  });

  it('rejects invalid request bodies with 400', async () => {
    const res = await post('/chat', { agent: 'unknown' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/optimized|baseline/);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('explains when a message is too long', async () => {
    const res = await post('/chat', { message: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 4000 characters/);
  });

  it('rejects malformed session ids', async () => {
    const res = await post('/chat', { sessionId: '../../etc', message: 'hi' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown or prototype collections instead of crashing or creating them', async () => {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) {
      const res = await fetch(`${base}/data/${name}`);
      expect(res.status).toBe(404);
    }
    const { counts } = await (await fetch(`${base}/data`)).json();
    expect(counts).not.toHaveProperty('nope');
  });

  it('clamps data paging parameters', async () => {
    const res = await fetch(`${base}/data/contacts?limit=-5`);
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });

  it('refuses a second request while the same conversation is still running', async () => {
    getSession('busy-session').busy = true;
    const res = await post('/chat', { sessionId: 'busy-session', message: 'hello' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Still finishing/);
    getSession('busy-session').busy = false;
  });

  it('returns 404 for unknown API routes', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('pages a collection and restores seed data on reset', async () => {
    const { items, total } = await (await fetch(`${base}/data/contacts?limit=5`)).json();
    expect(items).toHaveLength(5);
    expect(total).toBeGreaterThan(100);
    const reset = await (await post('/reset', {})).json();
    expect(reset.ok).toBe(true);
  });
});
