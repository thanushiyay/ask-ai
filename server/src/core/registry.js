import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { ActionError } from './errors.js';
import { parseWithRepairs, prepareArgs } from './coerce.js';

const EFFECTS = ['read', 'write', 'destructive', 'external'];

export class Registry {
  constructor() {
    this.modules = new Map();
    this.actions = new Map();
  }

  register(mod) {
    for (const k of ['id', 'code', 'title', 'description', 'actions']) {
      if (!mod[k]) throw new Error(`Module ${mod.id ?? '?'} missing "${k}"`);
    }
    if (this.modules.has(mod.id)) throw new Error(`Duplicate module ${mod.id}`);
    const actionIds = [];
    for (const a of mod.actions) {
      const id = `${mod.id}.${a.name}`;
      if (this.actions.has(id)) throw new Error(`Duplicate action ${id}`);
      if (!EFFECTS.includes(a.effect)) throw new Error(`${id}: invalid effect ${a.effect}`);
      const entry = {
        ...a,
        id,
        module: mod.id,
        moduleTitle: mod.title,
        ref: `${mod.code}.${a.code}`,
        inputJsonSchema: toJsonSchema(a.input),
        outputJsonSchema: toJsonSchema(a.output),
      };
      this.actions.set(id, entry);
      actionIds.push(id);
    }
    this.modules.set(mod.id, { ...mod, actions: actionIds });
    return this;
  }

  async loadDirectory(dir) {
    const files = readdirSync(dir)
      .filter((f) => /^m\d+.*\.js$/.test(f))
      .sort();
    for (const f of files) {
      const mod = (await import(pathToFileURL(path.join(dir, f)).href)).default;
      this.register(mod);
    }
    return this;
  }

  get(id) {
    return this.actions.get(id);
  }
  list() {
    return [...this.actions.values()];
  }
  listModules() {
    return [...this.modules.values()];
  }

  /**
   * Validate input, run the handler, validate output. Always returns a uniform
   * envelope; never throws for business failures.
   */
  async invoke(id, rawArgs, ctx) {
    const action = this.actions.get(id);
    const started = performance.now();
    if (!action) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_ACTION', message: `No action named "${id}" exists` },
        ms: 0,
      };
    }
    const prepared = prepareArgs(action.inputJsonSchema, rawArgs);
    if (prepared.unknown.length) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: `Unknown parameter${prepared.unknown.length > 1 ? 's' : ''} ${prepared.unknown.join(', ')} for ${id}; valid parameters: ${prepared.parameters.join(', ')}`,
        },
        ms: performance.now() - started,
      };
    }
    const { result: parsed, repairs: fixes } = parseWithRepairs(action.input, prepared.args);
    const repairs = [...prepared.renames, ...fixes];
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: `Invalid parameters for ${id}: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.') || 'input'} ${i.message}`)
            .join('; ')}`,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        ms: performance.now() - started,
      };
    }
    try {
      const result = await action.handler(parsed.data, ctx);
      if (ctx.validateOutput !== false) {
        const check = action.output.safeParse(result);
        if (!check.success)
          throw new Error(`Output of ${id} violates its schema: ${check.error.issues[0]?.message}`);
      }
      return {
        ok: true,
        result: structuredClone(result),
        ms: performance.now() - started,
        ...(repairs.length ? { repairs } : {}),
      };
    } catch (err) {
      const error = err instanceof ActionError ? err.toJSON() : { code: 'INTERNAL', message: err.message };
      return { ok: false, error, ms: performance.now() - started };
    }
  }
}

function toJsonSchema(schema) {
  try {
    const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    delete js.$schema;
    return js;
  } catch {
    return { type: 'object' };
  }
}

/** Compact, token-cheap signature used in LLM prompts, e.g.
 *  tasks.create(title*: string, contactId: id<contacts>, dueDate: date-time, priority: low|medium|high|urgent) */
export function signature(action) {
  const props = action.inputJsonSchema.properties ?? {};
  const req = new Set(action.inputJsonSchema.required ?? []);
  const fmt = (p) => {
    if (!p) return 'any';
    if (p.enum) return p.enum.join('|');
    if (p.ref) return `id<${p.ref}>`;
    if (p.type === 'array') return `${fmt(p.items)}[]`;
    if (p.format) return p.format;
    if (p.type === 'object') return p.properties ? `{${Object.keys(p.properties).join(',')}}` : 'object';
    return p.type ?? (p.anyOf ? p.anyOf.map(fmt).join('|') : 'any');
  };
  const parts = Object.entries(props).map(([k, p]) => `${k}${req.has(k) ? '*' : ''}: ${fmt(p)}`);
  return `${action.id}(${parts.join(', ')})`;
}

let shared;
/** Process-wide registry with all modules loaded (cached). */
export async function loadRegistry() {
  if (!shared) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');
    shared = await new Registry().loadDirectory(dir);
  }
  return shared;
}
