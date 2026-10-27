import { createClock } from './clock.js';
import { Store } from './store.js';
import { buildSeed } from '../seed/seed.js';

const MAX_CACHED_SEEDS = 4;
const cache = new Map();

const envSeed = () => {
  const n = Number(process.env.SEED);
  return process.env.SEED && Number.isInteger(n) ? n : 42;
};

export function createWorld({ now, seed = envSeed() } = {}) {
  const clock = createClock(now);
  const key = `${clock.nowIso()}#${seed}`;
  if (!cache.has(key)) {
    if (cache.size >= MAX_CACHED_SEEDS) cache.delete(cache.keys().next().value);
    cache.set(key, buildSeed(clock, seed));
  }
  const db = new Store(clock).load(cache.get(key));
  return { clock, db };
}

/** Context passed to every handler. */
export const handlerContext = (world, extra = {}) => ({
  db: world.db,
  clock: world.clock,
  actor: 'ask-ai',
  ...extra,
});
