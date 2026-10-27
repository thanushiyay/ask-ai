import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadRegistry } from './core/registry.js';
import { createAgents } from './agent/index.js';
import { config, configWarnings, hasApiKey } from './agent/config.js';
import { priceFor } from './agent/pricing.js';
import { createApp } from './http/app.js';

const SHUTDOWN_GRACE_MS = 5000;
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(here, '..', '..', 'web', 'dist');

for (const warning of configWarnings) console.warn(`Config: ${warning}`);
for (const model of new Set([config.plannerModel, config.summaryModel, config.baselineModel])) {
  if (priceFor(model).unknown)
    console.warn(`Config: no price known for "${model}"; its cost is reported as $0. Set PRICING_JSON.`);
}

const registry = await loadRegistry();
const agents = createAgents(registry);
const { app, state } = createApp({
  registry,
  agents,
  resultsDir: path.join(here, '..', 'results'),
  staticDir,
});

if (config.retrieval === 'hybrid' && hasApiKey()) {
  agents.index
    .loadEmbeddings()
    .catch((e) => console.warn(`Embedding warm-up failed; using BM25 until it succeeds: ${e.message}`));
}

const server = app.listen(config.port, () => {
  const modules = registry.listModules().length;
  const actions = registry.list().length;
  console.log(`Ask AI listening on http://localhost:${config.port} (${modules} modules, ${actions} actions)`);
  console.log(`Simulated time: ${state.world.clock.nowIso()}`);
  if (!existsSync(staticDir))
    console.log('UI not built: run "npm run dev" (UI on :5173) or "npm start" to build and serve it here.');
  if (!hasApiKey()) console.warn('OPENAI_API_KEY is not set. Add it to server/.env to enable chat.');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. Stop the other process or set PORT in server/.env.`,
    );
  } else {
    console.error(`Server failed to start: ${error.message}`);
  }
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(() => process.exit(0));
  // Streams of in-flight chats keep connections open; do not wait for them forever.
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, SHUTDOWN_GRACE_MS).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
