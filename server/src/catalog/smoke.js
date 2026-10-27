import { loadRegistry } from '../core/registry.js';
import { createWorld, handlerContext } from '../core/world.js';
import { generateArgs, EXAMPLES } from './samples.js';

export async function runSmoke({ only } = {}) {
  const registry = await loadRegistry();
  const results = [];
  for (const action of registry.list()) {
    if (only && !action.id.startsWith(only)) continue;
    const candidates = [];
    if (EXAMPLES[action.id]) candidates.push({ source: 'example', make: EXAMPLES[action.id] });
    for (const mode of ['required', 'full'])
      for (let v = 0; v < 4; v++)
        candidates.push({
          source: `generated:${mode}:${v}`,
          make: (db) => generateArgs(action, db, v, mode),
        });

    let passed = null;
    const attempts = [];
    for (const c of candidates) {
      const world = createWorld();
      let args;
      try {
        args = c.make(world.db);
      } catch (e) {
        attempts.push({ source: c.source, error: `example builder failed: ${e.message}` });
        if (c.source === 'example') break;
        continue;
      }
      world.db.log = [];
      const res = await registry.invoke(action.id, args, handlerContext(world));
      const mutated = world.db.log.length > 0;
      const okState = action.effect === 'read' ? !mutated : mutated;
      if (res.ok && okState) {
        passed = { args, source: c.source, mutations: world.db.log.length, result: res.result };
        break;
      }
      attempts.push({
        source: c.source,
        args,
        error: res.ok
          ? action.effect === 'read'
            ? 'read action mutated state'
            : 'no state change'
          : res.error,
      });
      if (c.source === 'example') break; // an explicit example must work as written
    }
    const neg = await registry.invoke(
      action.id,
      { __bogus: true, ...(action.input.shape ? {} : {}) },
      handlerContext(createWorld()),
    );
    const crashed = !neg.ok && neg.error.code === 'INTERNAL';
    results.push({
      id: action.id,
      ref: action.ref,
      effect: action.effect,
      ok: Boolean(passed) && !crashed,
      passed,
      crashed: crashed ? neg.error : null,
      attempts: passed ? undefined : attempts.slice(0, 3),
    });
  }
  return { total: results.length, passed: results.filter((r) => r.ok).length, results };
}

if (process.argv[1]?.endsWith('smoke.js')) {
  const { total, passed, results } = await runSmoke({ only: process.argv[2] });
  for (const r of results.filter((x) => !x.ok))
    console.log(
      'FAIL',
      r.id,
      JSON.stringify(r.crashed ?? r.attempts?.[0]?.error),
      JSON.stringify(r.attempts?.[0]?.args),
    );
  console.log(`${passed}/${total} handlers passed`);
}
