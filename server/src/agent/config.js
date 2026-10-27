import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve server/.env from this file, not the shell's working directory.
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env'),
  quiet: true,
});

/** Problems found while reading the environment; printed once at startup instead of crashing later. */
export const configWarnings = [];

const env = (name) => {
  const value = process.env[name];
  return value === undefined ? undefined : value.trim();
};

/** Integer setting within [min, max]; an invalid value falls back to the default with a warning. */
function int(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env(name);
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    configWarnings.push(
      `${name}="${raw}" is not a whole number between ${min} and ${max}; using ${fallback}.`,
    );
    return fallback;
  }
  return value;
}

/** One of a fixed set of values; anything else falls back to the default with a warning. */
function oneOf(name, allowed, fallback) {
  const raw = env(name);
  if (raw === undefined || raw === '') return fallback;
  const value = raw.toLowerCase();
  if (allowed.includes(value)) return value;
  configWarnings.push(`${name}="${raw}" must be one of ${allowed.join(', ')}; using ${fallback}.`);
  return fallback;
}

const str = (name, fallback) => env(name) || fallback;

function apiKey() {
  const key = env('OPENAI_API_KEY') ?? '';
  // The placeholder from .env.example is not a key; treat it as missing so the UI says so clearly.
  if (!key || key === 'sk-...' || /^sk-?\.{2,}$/.test(key)) return '';
  return key;
}

const plannerModel = str('PLANNER_MODEL', 'gpt-4.1-mini');

export const config = {
  openaiApiKey: apiKey(),
  openaiBaseUrl: str('OPENAI_BASE_URL', undefined),
  plannerModel,
  summaryModel: str('SUMMARY_MODEL', 'gpt-4.1-mini'),
  baselineModel: str('BASELINE_MODEL', plannerModel),
  embeddingModel: str('EMBEDDING_MODEL', 'text-embedding-3-small'),
  // Only used by reasoning models (gpt-5*, o*).
  reasoningEffort: oneOf('REASONING_EFFORT', ['minimal', 'low', 'medium', 'high'], 'minimal'),
  retrieval: oneOf('RETRIEVAL', ['bm25', 'hybrid'], 'hybrid'),
  topK: int('TOP_K', 10, { min: 1, max: 50 }),
  summaryMode: oneOf('SUMMARY_MODE', ['auto', 'llm', 'template'], 'auto'),
  bulkConfirmThreshold: int('BULK_CONFIRM_THRESHOLD', 10, { min: 0 }),
  maxPlannerCalls: int('MAX_PLANNER_CALLS', 3, { min: 1, max: 10 }),
  baselineMaxIterations: int('BASELINE_MAX_ITERATIONS', 14, { min: 1, max: 50 }),
  llmTimeoutMs: int('LLM_TIMEOUT_MS', 60_000, { min: 1000 }),
  embedTimeoutMs: int('EMBED_TIMEOUT_MS', 800, { min: 50 }),
  llmMaxRetries: int('LLM_MAX_RETRIES', 2, { min: 0, max: 6 }),
  port: int('PORT', 8787, { min: 0, max: 65535 }),
};

export const hasApiKey = () => Boolean(config.openaiApiKey);
