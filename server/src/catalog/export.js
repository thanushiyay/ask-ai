import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, signature } from '../core/registry.js';

const registry = await loadRegistry();
const out = [
  '# Module and action catalog',
  '',
  `${registry.listModules().length} modules, ${registry.list().length} actions. Generated from the registry (\`npm run catalog\`). Effects: **read** (no changes), **write** (changes data), **destructive** (archives, cancels or deletes — confirmed first), **external** (visible to customers or the public — confirmed first).`,
  '',
];
for (const m of registry.listModules()) {
  out.push(
    `## ${m.code} ${m.title} (\`${m.id}\`)`,
    '',
    m.description,
    '',
    '| Ref | Action | Effect | Signature |',
    '|---|---|---|---|',
  );
  for (const id of m.actions) {
    const a = registry.get(id);
    out.push(`| ${a.ref} | ${a.title} | ${a.effect} | \`${signature(a).replace(/\|/g, '\\|')}\` |`);
  }
  out.push('');
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'CATALOG.md'), out.join('\n'));
console.log(`wrote ${path.join(dir, 'CATALOG.md')}`);
