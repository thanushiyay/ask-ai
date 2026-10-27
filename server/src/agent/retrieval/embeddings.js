import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasApiKey } from '../config.js';
import { embed } from '../llm.js';

const BATCH_SIZE = 100;
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.cache');

/**
 * Embeddings for the action catalog, computed once (batches in parallel) and cached on disk keyed by
 * a hash of the texts, so any catalog change re-embeds. Requests never wait on the one-time load.
 */
export class EmbeddingStore {
  constructor(texts) {
    this.texts = texts;
    this.vectors = null;
    this.loading = null;
  }

  load(trace) {
    if (this.vectors || !hasApiKey()) return Promise.resolve(this.vectors);
    this.loading ??= this.loadOrCompute(trace).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async loadOrCompute(trace) {
    const key = createHash('sha256').update(this.texts.join('\n')).digest('hex');
    const file = path.join(CACHE_DIR, `embeddings-${config.embeddingModel}.json`);
    if (existsSync(file)) {
      const cached = JSON.parse(readFileSync(file, 'utf8'));
      if (cached.key === key) return (this.vectors = cached.vectors);
    }
    const batches = [];
    for (let i = 0; i < this.texts.length; i += BATCH_SIZE) batches.push(this.texts.slice(i, i + BATCH_SIZE));
    const results = await Promise.all(
      batches.map((batch) => embed(batch, { trace, purpose: 'embed_catalog' })),
    );
    const vectors = results.flatMap((r) => r.vectors);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify({ key, vectors }));
    return (this.vectors = vectors);
  }

  /** Cosine similarity of the query to every action, or null to fall back to keyword search. */
  async similarities(query, trace) {
    if (!this.vectors) {
      this.load().catch(() => {});
      return null;
    }
    const vector = await this.queryVector(query, trace);
    if (!vector) return null;
    return this.vectors.map((v) => v.reduce((sum, x, j) => sum + x * vector[j], 0));
  }

  async queryVector(query, trace) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), config.embedTimeoutMs);
    });
    try {
      const result = await Promise.race([embed([query], { trace }), timeout]);
      return result?.vectors[0] ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
