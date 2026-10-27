import { Router } from 'express';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

export function insightsRoutes({ state, resultsDir }) {
  const router = Router();

  router.get('/traces', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json(
      state.traces
        .slice(0, limit)
        .map(({ events: _e, llmCalls: _l, actionCalls: _a, ...summary }) => summary),
    );
  });

  router.get('/traces/:id', (req, res) => {
    const trace = state.traces.find((t) => t.requestId === req.params.id);
    if (!trace) return res.status(404).json({ error: 'Trace not found' });
    res.json(trace);
  });

  router.get('/benchmark', (req, res) => {
    const file = path.join(resultsDir, 'benchmark-report.json');
    if (!existsSync(file)) {
      return res.json({ available: false, files: existsSync(resultsDir) ? readdirSync(resultsDir) : [] });
    }
    res.json({ available: true, ...JSON.parse(readFileSync(file, 'utf8')) });
  });

  return router;
}
