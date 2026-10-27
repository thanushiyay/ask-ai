import { z, s, ref, crud, action, fail } from '../core/kit.js';

const isOpen = (o) => o.status === 'open';
const openGuard = (o) => {
  if (!isOpen(o)) throw fail.state(`Opportunity ${o.id} is ${o.status}; reopen it first`);
};

export default {
  id: 'opportunities',
  code: 'M04',
  title: 'Opportunities',
  description: 'Track individual deals through the sales process.',
  keywords: ['opportunity', 'deal', 'sale', 'pipeline value', 'won', 'lost', 'close'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create opportunity',
      effect: 'write',
      description: 'Create a deal for a contact in a pipeline (defaults to the first stage).',
      input: z.object({
        name: z.string().min(1),
        contactId: ref('contacts'),
        pipelineId: ref('pipelines'),
        stageId: z.string().optional().meta({ description: 'Pipeline stage ID; defaults to first stage' }),
        value: s.money('Deal value').optional(),
        ownerId: ref('users').optional(),
        expectedCloseDate: s.date('Expected close date').optional(),
      }),
      handler(a, { db, actor }) {
        const c = db.must('contacts', a.contactId);
        const p = db.must('pipelines', a.pipelineId);
        if (p.status !== 'active') throw fail.state(`Pipeline ${p.name} is archived`);
        const stage = a.stageId
          ? p.stages.find((st) => st.id === a.stageId)
          : [...p.stages].sort((x, y) => x.order - y.order)[0];
        if (!stage) throw fail.notFound('stage', a.stageId);
        if (a.ownerId) db.must('users', a.ownerId);
        return db.insert(
          'opportunities',
          {
            name: a.name,
            contactId: c.id,
            companyId: c.companyId,
            pipelineId: p.id,
            stageId: stage.id,
            value: a.value ?? 0,
            currency: 'USD',
            ownerId: a.ownerId ?? c.ownerId ?? null,
            status: 'open',
            expectedCloseDate: a.expectedCloseDate ?? null,
            lostReason: null,
            closedAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get opportunity details',
      collection: 'opportunities',
      idField: 'opportunityId',
      description: 'Get one opportunity (deal) by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search opportunities',
      collection: 'opportunities',
      description:
        'Search deals by name, status (open/won/lost), pipeline, stage, owner, contact, value range or expected close date range.',
      text: ['name'],
      filters: {
        status: z.enum(['open', 'won', 'lost']),
        pipelineId: ref('pipelines'),
        stageId: z.string(),
        ownerId: ref('users'),
        contactId: ref('contacts'),
        companyId: ref('companies'),
      },
      dates: { created: 'createdAt', closeDate: 'expectedCloseDate' },
      extraInput: { minValue: z.number().optional(), maxValue: z.number().optional() },
      where: (r, a) =>
        (a.minValue == null || r.value >= a.minValue) && (a.maxValue == null || r.value <= a.maxValue),
    }),
    crud.setField({
      code: 'A04',
      name: 'update_value',
      title: 'Update opportunity value',
      collection: 'opportunities',
      idField: 'opportunityId',
      field: 'value',
      schema: s.money('New deal value'),
      description: 'Change the monetary value of an open deal.',
      guard: openGuard,
    }),
    action({
      code: 'A05',
      name: 'move_stage',
      title: 'Move opportunity to stage',
      effect: 'write',
      description: 'Move an open deal to another stage of its pipeline (by stage ID or stage name).',
      input: z.object({
        opportunityId: ref('opportunities'),
        stage: z.string().min(1).meta({ description: 'Stage ID or stage name, e.g. "Proposal"' }),
      }),
      handler({ opportunityId, stage }, { db, actor }) {
        const o = db.must('opportunities', opportunityId);
        openGuard(o);
        const p = db.must('pipelines', o.pipelineId);
        const st = p.stages.find((x) => x.id === stage || x.name.toLowerCase() === stage.toLowerCase());
        if (!st)
          throw fail.notFound(
            'stage',
            `${stage} in pipeline ${p.name} (stages: ${p.stages.map((x) => x.name).join(', ')})`,
          );
        if (st.id === o.stageId) throw fail.conflict(`Deal is already in ${st.name}`);
        return db.update('opportunities', o.id, { stageId: st.id }, actor);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'assign_owner',
      title: 'Assign opportunity owner',
      collection: 'opportunities',
      idField: 'opportunityId',
      field: 'ownerId',
      schema: ref('users'),
      description: 'Assign a user as owner of a deal.',
      guard: (o, a, { db }) => {
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'set_close_date',
      title: 'Set expected close date',
      collection: 'opportunities',
      idField: 'opportunityId',
      field: 'expectedCloseDate',
      schema: s.date('Expected close date (YYYY-MM-DD)'),
      description: 'Set the expected close date of an open deal.',
      guard: openGuard,
      transform: (a) => ({ expectedCloseDate: a.expectedCloseDate.slice(0, 10) }),
    }),
    crud.transition({
      code: 'A08',
      name: 'mark_won',
      title: 'Mark opportunity won',
      collection: 'opportunities',
      idField: 'opportunityId',
      from: ['open'],
      to: 'won',
      description: 'Mark an open deal as won.',
      patch: (a, r, { clock }) => ({ closedAt: clock.nowIso() }),
    }),
    crud.transition({
      code: 'A09',
      name: 'mark_lost',
      title: 'Mark opportunity lost',
      collection: 'opportunities',
      idField: 'opportunityId',
      from: ['open'],
      to: 'lost',
      extraInput: { reason: z.string().optional().meta({ description: 'Why the deal was lost' }) },
      description: 'Mark an open deal as lost with an optional reason.',
      patch: (a, r, { clock }) => ({ closedAt: clock.nowIso(), lostReason: a.reason ?? 'Not specified' }),
    }),
    crud.transition({
      code: 'A10',
      name: 'reopen',
      title: 'Reopen closed opportunity',
      collection: 'opportunities',
      idField: 'opportunityId',
      from: ['won', 'lost'],
      to: 'open',
      description: 'Reopen a won or lost deal.',
      patch: () => ({ closedAt: null, lostReason: null }),
    }),
  ],
};
