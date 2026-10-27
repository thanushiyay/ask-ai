import { z, s, ref, crud, action, fail } from '../core/kit.js';

const STATUSES = ['new', 'contacted', 'qualified', 'disqualified', 'converted'];
const SOURCES = ['facebook', 'google_ads', 'website', 'referral', 'webinar', 'manual', 'other'];
const closed = (l) => l.status === 'disqualified' || l.status === 'converted';

export default {
  id: 'leads',
  code: 'M03',
  title: 'Leads',
  description: 'Capture, qualify, and route prospective customers.',
  keywords: ['lead', 'prospect', 'inquiry', 'sign-up', 'potential customer', 'new lead', 'qualify'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create lead',
      effect: 'write',
      description:
        'Create a new lead. Links to an existing contact by contactId, or creates a contact from name/email.',
      input: z.object({
        contactId: ref('contacts').optional(),
        name: z.string().optional().meta({ description: 'Full name (when no contactId)' }),
        email: s.email().optional(),
        phone: s.phone().optional(),
        source: z.enum(SOURCES).optional(),
        campaignId: ref('campaigns').optional(),
        ownerId: ref('users').optional(),
      }),
      handler(a, { db, actor }) {
        let contact;
        if (a.contactId) contact = db.must('contacts', a.contactId);
        else {
          if (!a.name || (!a.email && !a.phone))
            throw fail.validation('Provide contactId, or a name plus email/phone');
          contact = db.findOne(
            'contacts',
            (c) => a.email && c.email?.toLowerCase() === a.email.toLowerCase(),
          );
          if (!contact) {
            const [firstName, ...rest] = a.name.trim().split(/\s+/);
            contact = db.insert(
              'contacts',
              {
                firstName,
                lastName: rest.join(' '),
                name: a.name.trim(),
                email: a.email ?? null,
                phone: a.phone ?? null,
                companyId: null,
                ownerId: a.ownerId ?? null,
                tags: [],
                status: 'active',
                source: a.source ?? 'manual',
                commPrefs: {
                  email: 'subscribed',
                  sms: 'opted_in',
                  preferredChannel: 'email',
                  doNotContact: false,
                },
                relationships: [],
                customFields: {},
                taxExempt: false,
              },
              actor,
            );
          }
        }
        if (a.ownerId) db.must('users', a.ownerId);
        if (a.campaignId) db.must('campaigns', a.campaignId);
        return db.insert(
          'leads',
          {
            contactId: contact.id,
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            source: a.source ?? 'manual',
            campaignId: a.campaignId ?? null,
            status: 'new',
            ownerId: a.ownerId ?? null,
            score: 0,
            qualification: {},
            disqualifyReason: null,
            opportunityId: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get lead details',
      collection: 'leads',
      idField: 'leadId',
      description: 'Get one lead by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search leads',
      collection: 'leads',
      description:
        'Search leads by name/email text, status, source (e.g. facebook), campaign, owner, score, or created date range. Use unassigned=true for leads with no owner.',
      text: ['name', 'email'],
      filters: {
        status: z.union([z.enum(STATUSES), z.array(z.enum(STATUSES))]),
        source: z.union([z.enum(SOURCES), z.array(z.enum(SOURCES))]),
        campaignId: ref('campaigns'),
        ownerId: ref('users'),
        contactId: ref('contacts'),
      },
      extraInput: {
        unassigned: z.boolean().optional().meta({ description: 'Only leads with no owner' }),
        minScore: z.number().optional(),
      },
      where: (r, a) => (a.unassigned ? !r.ownerId : true) && (a.minScore == null || r.score >= a.minScore),
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update lead details',
      collection: 'leads',
      idField: 'leadId',
      description: "Update a lead's name, email, phone or status.",
      fields: {
        name: z.string().min(1),
        email: s.email(),
        phone: s.phone(),
        status: z.enum(['new', 'contacted', 'qualified']),
      },
      guard: (r) => {
        if (closed(r)) throw fail.state(`Lead ${r.id} is ${r.status}`);
      },
    }),
    crud.setField({
      code: 'A05',
      name: 'assign_owner',
      title: 'Assign lead owner',
      collection: 'leads',
      idField: 'leadId',
      field: 'ownerId',
      schema: ref('users', 'Sales user to own the lead'),
      description: 'Assign a lead to a user (sales rep). Also sets the owner on the linked contact.',
      guard(r, a, { db }) {
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active')
          throw fail.state(`User ${u.name} is ${u.status} and cannot be assigned leads`);
        if (closed(r)) throw fail.state(`Lead ${r.id} is ${r.status}`);
      },
      transform(a, r, { db, actor }) {
        if (r.contactId && db.get('contacts', r.contactId))
          db.update('contacts', r.contactId, { ownerId: a.ownerId }, actor);
        return { ownerId: a.ownerId };
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_source',
      title: 'Set lead source',
      collection: 'leads',
      idField: 'leadId',
      field: 'source',
      schema: z.enum(SOURCES),
      description: 'Set where a lead came from (facebook, google_ads, website, referral, webinar...).',
      transform: (a, r, { db }) => {
        const camp = db.findOne('campaigns', (c) => c.sourceChannel === a.source && c.status === 'active');
        return { source: a.source, campaignId: camp?.id ?? r.campaignId };
      },
    }),
    action({
      code: 'A07',
      name: 'record_qualification',
      title: 'Record qualification answers',
      effect: 'write',
      description:
        'Record BANT-style qualification answers (budget, authority, need, timeline) on a lead; marks it qualified when all four are positive.',
      input: z.object({
        leadId: ref('leads'),
        budget: z.boolean().optional(),
        authority: z.boolean().optional(),
        need: z.boolean().optional(),
        timeline: z.enum(['this_month', 'this_quarter', 'next_year', 'unknown']).optional(),
        notes: z.string().optional(),
      }),
      handler({ leadId, ...ans }, { db, actor }) {
        const l = db.must('leads', leadId);
        if (closed(l)) throw fail.state(`Lead ${l.id} is ${l.status}`);
        const q = {
          ...l.qualification,
          ...Object.fromEntries(Object.entries(ans).filter(([, v]) => v !== undefined)),
        };
        const qualified =
          q.budget && q.authority && q.need && ['this_month', 'this_quarter'].includes(q.timeline);
        return db.update(
          'leads',
          l.id,
          { qualification: q, status: qualified ? 'qualified' : l.status },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'update_score',
      title: 'Update lead score',
      collection: 'leads',
      idField: 'leadId',
      field: 'score',
      schema: z.number().int().min(0).max(100).meta({ description: 'Score 0-100' }),
      description: "Set a lead's score (0-100).",
    }),
    crud.transition({
      code: 'A09',
      name: 'disqualify',
      title: 'Disqualify lead with reason',
      collection: 'leads',
      idField: 'leadId',
      from: ['new', 'contacted', 'qualified'],
      to: 'disqualified',
      effect: 'destructive',
      extraInput: { reason: z.string().min(3).meta({ description: 'Why the lead is disqualified' }) },
      description: 'Disqualify a lead and record the reason.',
      patch: (a) => ({ disqualifyReason: a.reason }),
    }),
    action({
      code: 'A10',
      name: 'convert_to_opportunity',
      title: 'Convert lead to opportunity',
      effect: 'write',
      description: 'Convert a lead into an opportunity (deal) in a pipeline. The lead becomes "converted".',
      input: z.object({
        leadId: ref('leads'),
        pipelineId: ref('pipelines')
          .optional()
          .meta({ description: 'Defaults to the first active pipeline' }),
        value: s.money('Deal value').optional(),
        name: z.string().optional(),
      }),
      handler({ leadId, pipelineId, value, name }, { db, actor, clock }) {
        const l = db.must('leads', leadId);
        if (closed(l)) throw fail.state(`Lead ${l.id} is already ${l.status}`);
        const pipe = pipelineId
          ? db.must('pipelines', pipelineId)
          : db.findOne('pipelines', (p) => p.status === 'active');
        if (!pipe || pipe.status !== 'active') throw fail.state('No active pipeline available');
        const first = [...pipe.stages].sort((a, b) => a.order - b.order)[0];
        const c = db.get('contacts', l.contactId);
        const opp = db.insert(
          'opportunities',
          {
            name: name ?? `${l.name} — new deal`,
            contactId: l.contactId,
            companyId: c?.companyId ?? null,
            pipelineId: pipe.id,
            stageId: first.id,
            value: value ?? 0,
            currency: 'USD',
            ownerId: l.ownerId,
            status: 'open',
            expectedCloseDate: clock.date(clock.daysFromNow(30)),
            lostReason: null,
            closedAt: null,
            leadId: l.id,
          },
          actor,
        );
        db.update('leads', l.id, { status: 'converted', opportunityId: opp.id }, actor);
        return opp;
      },
    }),
  ],
};
