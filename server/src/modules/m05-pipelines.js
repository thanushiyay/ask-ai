import { z, ref, crud, action, fail, child } from '../core/kit.js';

const activeGuard = (p) => {
  if (p.status !== 'active') throw fail.state(`Pipeline ${p.name} is archived`);
};
const slug = (n) => `stg_${n.toLowerCase().replace(/\W+/g, '')}`;

export default {
  id: 'pipelines',
  code: 'M05',
  title: 'Pipelines',
  description: 'Configure the stages and rules for sales pipelines.',
  keywords: ['pipeline', 'stage', 'sales process', 'funnel stages', 'deal stages', 'win probability'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create pipeline',
      effect: 'write',
      description: 'Create a sales pipeline, optionally with an ordered list of stage names.',
      input: z.object({
        name: z.string().min(1),
        stageNames: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .meta({ description: 'Ordered stage names (default: New, Qualified, Proposal, Negotiation)' }),
      }),
      handler({ name, stageNames }, { db, actor }) {
        if (db.findOne('pipelines', (p) => p.name.toLowerCase() === name.toLowerCase()))
          throw fail.conflict(`Pipeline "${name}" already exists`);
        const names = stageNames ?? ['New', 'Qualified', 'Proposal', 'Negotiation'];
        const p = db.insert('pipelines', { name, stages: [], status: 'active' }, actor);
        p.stages = names.map((n, i) => ({
          id: `${slug(n)}_${p.id.split('_')[1]}`,
          name: n,
          order: i + 1,
          winProbability: Math.round(((i + 1) / (names.length + 1)) * 100),
        }));
        return p;
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get pipeline configuration',
      collection: 'pipelines',
      idField: 'pipelineId',
      description: 'Get a pipeline with its stages, win probabilities and number of open deals per stage.',
      enrich: (p, { db }) => ({
        stages: [...p.stages]
          .sort((a, b) => a.order - b.order)
          .map((st) => ({
            ...st,
            openDeals: db.find(
              'opportunities',
              (o) => o.stageId === st.id && o.pipelineId === p.id && o.status === 'open',
            ).length,
          })),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List pipelines',
      collection: 'pipelines',
      description: 'List pipelines (optionally including archived ones).',
      text: ['name'],
      hide: (p) => p.status === 'archived',
    }),
    crud.setField({
      code: 'A04',
      name: 'rename',
      title: 'Rename pipeline',
      collection: 'pipelines',
      idField: 'pipelineId',
      field: 'name',
      schema: z.string().min(1),
      description: 'Rename a pipeline.',
      guard: activeGuard,
    }),
    action({
      code: 'A05',
      name: 'archive',
      title: 'Archive pipeline',
      effect: 'destructive',
      description: 'Archive a pipeline. Fails if it still has open deals.',
      input: z.object({ pipelineId: ref('pipelines') }),
      handler({ pipelineId }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        activeGuard(p);
        const open = db.find('opportunities', (o) => o.pipelineId === p.id && o.status === 'open').length;
        if (open)
          throw fail.state(`Pipeline ${p.name} still has ${open} open deals; move or close them first`);
        return db.update('pipelines', p.id, { status: 'archived' }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'add_stage',
      title: 'Add pipeline stage',
      effect: 'write',
      description: 'Add a stage to a pipeline at an optional position (1-based; default: end).',
      input: z.object({
        pipelineId: ref('pipelines'),
        name: z.string().min(1),
        position: z.number().int().min(1).optional(),
        winProbability: z.number().min(0).max(100).optional(),
      }),
      handler({ pipelineId, name, position, winProbability }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        activeGuard(p);
        if (p.stages.some((st) => st.name.toLowerCase() === name.toLowerCase()))
          throw fail.conflict(`Stage "${name}" already exists`);
        const stages = [...p.stages].sort((a, b) => a.order - b.order);
        const at = Math.min(position ?? stages.length + 1, stages.length + 1) - 1;
        stages.splice(at, 0, {
          id: `${slug(name)}_${p.id.split('_')[1]}`,
          name,
          order: 0,
          winProbability: winProbability ?? 50,
        });
        stages.forEach((st, i) => (st.order = i + 1));
        return db.update('pipelines', p.id, { stages }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'rename_stage',
      title: 'Rename pipeline stage',
      effect: 'write',
      description: 'Rename one stage of a pipeline.',
      input: z.object({ pipelineId: ref('pipelines'), stageId: z.string().min(1), name: z.string().min(1) }),
      handler({ pipelineId, stageId, name }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        activeGuard(p);
        const st = child(p.stages, stageId, 'stage');
        st.name = name;
        return db.update('pipelines', p.id, { stages: p.stages }, actor);
      },
    }),
    action({
      code: 'A08',
      name: 'reorder_stages',
      title: 'Reorder pipeline stages',
      effect: 'write',
      description: 'Reorder stages by giving the full list of stage IDs in the new order.',
      input: z.object({ pipelineId: ref('pipelines'), stageIds: z.array(z.string()).min(1) }),
      handler({ pipelineId, stageIds }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        activeGuard(p);
        const have = p.stages
          .map((x) => x.id)
          .sort()
          .join();
        if ([...stageIds].sort().join() !== have)
          throw fail.validation('stageIds must contain every stage exactly once', {
            stages: p.stages.map((x) => ({ id: x.id, name: x.name })),
          });
        const stages = stageIds.map((id, i) => ({ ...p.stages.find((x) => x.id === id), order: i + 1 }));
        return db.update('pipelines', p.id, { stages }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'remove_empty_stage',
      title: 'Remove empty pipeline stage',
      effect: 'destructive',
      description: 'Remove a stage that has no open deals in it.',
      input: z.object({ pipelineId: ref('pipelines'), stageId: z.string().min(1) }),
      handler({ pipelineId, stageId }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        activeGuard(p);
        const st = child(p.stages, stageId, 'stage');
        const n = db.find(
          'opportunities',
          (o) => o.stageId === st.id && o.pipelineId === p.id && o.status === 'open',
        ).length;
        if (n) throw fail.state(`Stage "${st.name}" has ${n} open deals and cannot be removed`);
        if (p.stages.length === 1) throw fail.state('A pipeline needs at least one stage');
        const stages = p.stages
          .filter((x) => x.id !== st.id)
          .sort((a, b) => a.order - b.order)
          .map((x, i) => ({ ...x, order: i + 1 }));
        return db.update('pipelines', p.id, { stages }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'set_stage_probability',
      title: 'Set stage win probability',
      effect: 'write',
      description: 'Set the win probability (0-100%) of a pipeline stage.',
      input: z.object({
        pipelineId: ref('pipelines'),
        stageId: z.string().min(1),
        winProbability: z.number().min(0).max(100),
      }),
      handler({ pipelineId, stageId, winProbability }, { db, actor }) {
        const p = db.must('pipelines', pipelineId);
        child(p.stages, stageId, 'stage').winProbability = winProbability;
        return db.update('pipelines', p.id, { stages: p.stages }, actor);
      },
    }),
  ],
};
