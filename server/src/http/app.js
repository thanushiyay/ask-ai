import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { createAppState } from './state.js';
import { systemRoutes } from './routes/system.js';
import { catalogRoutes } from './routes/catalog.js';
import { chatRoutes } from './routes/chat.js';
import { dataRoutes } from './routes/data.js';
import { insightsRoutes } from './routes/insights.js';

export function createApp({ registry, agents, resultsDir, staticDir }) {
  const state = createAppState();
  const deps = { registry, agents, state, resultsDir };
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(systemRoutes(deps));
  api.use('/catalog', catalogRoutes(deps));
  api.use('/chat', chatRoutes(deps));
  api.use(dataRoutes(deps));
  api.use(insightsRoutes(deps));
  api.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));
  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((error, req, res, _next) => {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid request', issues: error.issues });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, state };
}
