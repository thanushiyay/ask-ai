import { Router } from 'express';

const RECENT_CHANGES = 50;

export function dataRoutes({ state }) {
  const router = Router();

  router.post('/reset', (req, res) => {
    state.reset();
    res.json({ ok: true, counts: state.world.db.counts(), now: state.world.clock.nowIso() });
  });

  router.get('/data', (req, res) => {
    const { db } = state.world;
    res.json({ counts: db.counts(), recentChanges: db.log.slice(-RECENT_CHANGES).reverse() });
  });

  router.get('/data/:collection', (req, res) => {
    const { db } = state.world;
    const { collection } = req.params;
    // Only real collections; never create one as a side effect or touch Object.prototype keys.
    if (!Object.hasOwn(db.data, collection)) {
      return res.status(404).json({ error: `Unknown collection "${collection}"` });
    }
    const q = String(req.query.q ?? '')
      .trim()
      .toLowerCase()
      .slice(0, 200);
    const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), 500);
    const changed = new Set(
      db.log.filter((entry) => entry.collection === collection).map((entry) => entry.id),
    );
    const rows = db.col(collection).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
    const byRelevance = (a, b) =>
      changed.has(b.id) - changed.has(a.id) || String(b.updatedAt).localeCompare(String(a.updatedAt));

    res.json({
      total: rows.length,
      changedIds: [...changed],
      items: [...rows].sort(byRelevance).slice(0, limit),
    });
  });

  return router;
}
