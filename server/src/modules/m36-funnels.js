import { z, ref, crud, action, fail, child, out } from '../core/kit.js';

export default {
  id: 'funnels',
  code: 'M36',
  title: 'Funnels',
  description: 'Configure ordered journeys toward conversion.',
  keywords: ['funnel', 'sales funnel', 'conversion', 'journey', 'opt-in', 'steps', 'conversion rate'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create funnel',
      collection: 'funnels',
      description: 'Create an unpublished funnel.',
      fields: { name: z.string().min(1) },
      validate: (a, { db }) => {
        if (db.findOne('funnels', (f) => f.name.toLowerCase() === a.name.toLowerCase()))
          throw fail.conflict(`Funnel "${a.name}" exists`);
      },
      defaults: () => ({ steps: [], goal: null, published: false }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get funnel definition',
      collection: 'funnels',
      idField: 'funnelId',
      description: 'Get a funnel with its ordered steps and goal.',
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List funnels',
      collection: 'funnels',
      description: 'List funnels.',
      text: ['name'],
      filters: { published: z.boolean() },
    }),
    action({
      code: 'A04',
      name: 'add_step',
      title: 'Add funnel step',
      effect: 'write',
      description: 'Append a step to a funnel.',
      input: z.object({
        funnelId: ref('funnels'),
        name: z.string().min(1),
        landingPageId: ref('landing_pages').optional(),
      }),
      handler({ funnelId, name, landingPageId }, { db, actor }) {
        const f = db.must('funnels', funnelId);
        if (landingPageId) db.must('landing_pages', landingPageId);
        return db.update(
          'funnels',
          f.id,
          {
            steps: [
              ...f.steps,
              {
                id: `fstep_${db.nextId('_child').split('_').pop()}`,
                name,
                order: f.steps.length + 1,
                landingPageId: landingPageId ?? null,
                visitors: 0,
                conversions: 0,
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A05',
      name: 'reorder_steps',
      title: 'Reorder funnel steps',
      effect: 'write',
      description: 'Reorder funnel steps by listing every step ID in the new order.',
      input: z.object({ funnelId: ref('funnels'), stepIds: z.array(z.string()).min(1) }),
      handler({ funnelId, stepIds }, { db, actor }) {
        const f = db.must('funnels', funnelId);
        if (
          [...stepIds].sort().join() !==
          f.steps
            .map((x) => x.id)
            .sort()
            .join()
        )
          throw fail.validation('stepIds must include every step exactly once', {
            steps: f.steps.map((x) => ({ id: x.id, name: x.name })),
          });
        return db.update(
          'funnels',
          f.id,
          { steps: stepIds.map((id, i) => ({ ...f.steps.find((x) => x.id === id), order: i + 1 })) },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'remove_step',
      title: 'Remove funnel step',
      effect: 'destructive',
      description: 'Remove a step from a funnel.',
      input: z.object({ funnelId: ref('funnels'), stepId: z.string().min(1) }),
      handler({ funnelId, stepId }, { db, actor }) {
        const f = db.must('funnels', funnelId);
        child(f.steps, stepId, 'funnel step');
        if (f.published && f.steps.length === 1)
          throw fail.state('A published funnel needs at least one step; unpublish it first');
        return db.update(
          'funnels',
          f.id,
          { steps: f.steps.filter((x) => x.id !== stepId).map((x, i) => ({ ...x, order: i + 1 })) },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'link_landing_page',
      title: 'Link landing page to step',
      effect: 'write',
      description: 'Attach a landing page to a funnel step.',
      input: z.object({
        funnelId: ref('funnels'),
        stepId: z.string().min(1),
        landingPageId: ref('landing_pages'),
      }),
      handler({ funnelId, stepId, landingPageId }, { db, actor }) {
        const f = db.must('funnels', funnelId);
        db.must('landing_pages', landingPageId);
        child(f.steps, stepId, 'funnel step').landingPageId = landingPageId;
        return db.update('funnels', f.id, { steps: f.steps }, actor);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_goal',
      title: 'Set funnel conversion goal',
      collection: 'funnels',
      idField: 'funnelId',
      field: 'goal',
      schema: z.object({
        type: z.enum(['form_submission', 'purchase', 'booking']),
        target: z.number().int().min(1).optional(),
      }),
      description: 'Set what counts as a conversion and an optional target.',
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish funnel',
      effect: 'external',
      description: 'Publish a funnel. Every step needs a landing page and the funnel needs a goal.',
      input: z.object({ funnelId: ref('funnels') }),
      handler({ funnelId }, { db, actor }) {
        const f = db.must('funnels', funnelId);
        if (f.published) throw fail.conflict('Funnel is already published');
        const problems = [
          !f.steps.length && 'no steps',
          !f.goal && 'no conversion goal',
          ...f.steps.filter((x) => !x.landingPageId).map((x) => `step "${x.name}" has no landing page`),
        ].filter(Boolean);
        if (problems.length)
          throw fail.state(`Funnel ${f.name} cannot be published: ${problems.join(', ')}`, { problems });
        return db.update('funnels', f.id, { published: true }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'conversion_metrics',
      title: 'Get funnel conversion metrics',
      effect: 'read',
      description: 'Visitors, conversions and step-to-step drop-off for a funnel.',
      input: z.object({ funnelId: ref('funnels') }),
      output: out.shape({ funnelId: z.string(), steps: z.array(z.any()), overallConversionRate: z.number() }),
      handler({ funnelId }, { db }) {
        const f = db.must('funnels', funnelId);
        const steps = [...f.steps]
          .sort((a, b) => a.order - b.order)
          .map((x, i, arr) => ({
            id: x.id,
            name: x.name,
            visitors: x.visitors,
            conversions: x.conversions,
            conversionRate: x.visitors ? Math.round((x.conversions / x.visitors) * 1000) / 10 : 0,
            dropOffFromPrevious: i ? Math.max(arr[i - 1].visitors - x.visitors, 0) : 0,
          }));
        const first = steps[0]?.visitors ?? 0;
        const last = steps.at(-1)?.conversions ?? 0;
        return {
          funnelId: f.id,
          name: f.name,
          steps,
          overallConversionRate: first ? Math.round((last / first) * 1000) / 10 : 0,
          goal: f.goal,
          goalProgress: f.goal?.target ? `${last}/${f.goal.target}` : null,
        };
      },
    }),
  ],
};
