import { Router } from 'express';
import { z } from 'zod';
import { signature } from '../../core/registry.js';

const SearchBody = z.object({
  query: z.string().max(2000).default(''),
  mode: z.enum(['bm25', 'hybrid']).optional(),
});

export function catalogRoutes({ registry, agents }) {
  const router = Router();

  router.get('/', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase();
    const matches = (a) => !q || `${a.id} ${a.title} ${a.description}`.toLowerCase().includes(q);
    res.json({
      modules: registry.listModules().map(({ id, code, title, description, keywords, actions }) => ({
        id,
        code,
        title,
        description,
        keywords,
        actions,
      })),
      actions: registry
        .list()
        .filter(matches)
        .map((a) => ({
          id: a.id,
          ref: a.ref,
          module: a.module,
          title: a.title,
          description: a.description,
          effect: a.effect,
          signature: signature(a),
          input: a.inputJsonSchema,
          output: a.outputJsonSchema,
        })),
    });
  });

  router.post('/search', async (req, res) => {
    const { query, mode } = SearchBody.parse(req.body ?? {});
    res.json(await agents.index.search(query, { mode }));
  });

  return router;
}
