import { Router } from 'express';
import { config, hasApiKey } from '../../agent/config.js';
import { pricingTable } from '../../agent/pricing.js';

export function systemRoutes({ registry, state }) {
  const router = Router();

  router.get('/health', (req, res) =>
    res.json({
      ok: true,
      hasApiKey: hasApiKey(),
      modules: registry.listModules().length,
      actions: registry.list().length,
      now: state.world.clock.nowIso(),
      models: {
        planner: config.plannerModel,
        summary: config.summaryModel,
        baseline: config.baselineModel,
        embedding: config.embeddingModel,
      },
      retrieval: config.retrieval,
    }),
  );

  router.get('/pricing', (req, res) => res.json(pricingTable()));

  return router;
}
