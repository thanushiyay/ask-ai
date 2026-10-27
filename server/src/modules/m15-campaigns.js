import { z, s, ref, crud, action, fail, out } from '../core/kit.js';

const editable = (c) => {
  if (['completed'].includes(c.status)) throw fail.state(`Campaign ${c.name} is completed`);
};

function audienceSize(db, aud) {
  if (!aud) return 0;
  if (aud.type === 'tag')
    return db.find('contacts', (c) => c.status === 'active' && c.tags.includes(aud.value)).length;
  if (aud.type === 'smart_list') {
    const sl = db.get('smart_lists', aud.value);
    return sl ? db.find(sl.module === 'leads' ? 'leads' : 'contacts', () => true).length : 0;
  }
  if (aud.type === 'contacts') return aud.value.length;
  return 0;
}

export default {
  id: 'campaigns',
  code: 'M15',
  title: 'Campaigns',
  description: 'Coordinate audience-based outreach campaigns.',
  keywords: [
    'campaign',
    'outreach',
    'blast',
    'drip',
    'promotion',
    'marketing campaign',
    'facebook campaign',
    'ads',
  ],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create campaign',
      collection: 'campaigns',
      description: 'Create a draft outreach campaign (email or sms).',
      fields: {
        name: z.string().min(1),
        channel: z.enum(['email', 'sms']),
        sourceChannel: z
          .string()
          .optional()
          .meta({ description: 'Ad/source channel this campaign represents, e.g. facebook' }),
      },
      validate: (a, { db }) => {
        if (db.findOne('campaigns', (c) => c.name.toLowerCase() === a.name.toLowerCase()))
          throw fail.conflict(`Campaign "${a.name}" exists`);
      },
      defaults: () => ({
        sourceChannel: null,
        audience: null,
        steps: [],
        schedule: null,
        status: 'draft',
        stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, conversions: 0 },
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get campaign details',
      collection: 'campaigns',
      idField: 'campaignId',
      description: 'Get a campaign with audience, steps, schedule and status.',
      enrich: (c, { db }) => ({
        audienceSize: audienceSize(db, c.audience),
        leadCount: db.find('leads', (l) => l.campaignId === c.id).length,
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List campaigns',
      collection: 'campaigns',
      description: 'List campaigns by name text, status or channel (e.g. find the "Facebook" campaign).',
      text: ['name', 'sourceChannel'],
      filters: {
        status: z.enum(['draft', 'scheduled', 'active', 'paused', 'completed']),
        channel: z.enum(['email', 'sms']),
        sourceChannel: z.string(),
      },
    }),
    action({
      code: 'A04',
      name: 'set_audience',
      title: 'Set campaign audience',
      effect: 'write',
      description: 'Set who receives a campaign: contacts with a tag, a smart list, or explicit contact IDs.',
      input: z.object({
        campaignId: ref('campaigns'),
        type: z.enum(['tag', 'smart_list', 'contacts']),
        value: z
          .union([z.string(), z.array(z.string())])
          .meta({ description: 'Tag name, smart list ID, or array of contact IDs' }),
      }),
      handler({ campaignId, type, value }, { db, actor }) {
        const c = db.must('campaigns', campaignId);
        editable(c);
        if (type === 'smart_list') db.must('smart_lists', value);
        if (type === 'contacts') [].concat(value).forEach((id) => db.must('contacts', id));
        const audience = { type, value: type === 'contacts' ? [].concat(value) : value };
        const size = audienceSize(db, audience);
        if (!size) throw fail.validation('That audience currently matches 0 contacts');
        return { ...db.update('campaigns', c.id, { audience }, actor), audienceSize: size };
      },
    }),
    action({
      code: 'A05',
      name: 'add_step',
      title: 'Add campaign message step',
      effect: 'write',
      description:
        'Add a message step to a campaign (template or subject, with a delay in days after the previous step).',
      input: z.object({
        campaignId: ref('campaigns'),
        templateId: ref('templates').optional(),
        subject: z.string().optional(),
        delayDays: z.number().int().min(0).optional(),
      }),
      handler({ campaignId, templateId, subject, delayDays }, { db, actor }) {
        const c = db.must('campaigns', campaignId);
        editable(c);
        if (templateId) {
          const t = db.must('templates', templateId);
          if (t.channel !== c.channel)
            throw fail.validation(
              `Template channel ${t.channel} does not match campaign channel ${c.channel}`,
            );
        }
        if (!templateId && !subject) throw fail.validation('Provide templateId or subject');
        return db.update(
          'campaigns',
          c.id,
          {
            steps: [
              ...c.steps,
              {
                id: `cstep_${db.nextId('_child').split('_').pop()}`,
                channel: c.channel,
                templateId: templateId ?? null,
                subject: subject ?? null,
                delayDays: delayDays ?? 0,
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'set_schedule',
      title: 'Set campaign schedule',
      effect: 'write',
      description: 'Set when a campaign starts (and optional timezone).',
      input: z.object({
        campaignId: ref('campaigns'),
        startAt: s.datetime('Start date-time'),
        timezone: z.string().optional(),
      }),
      handler({ campaignId, startAt, timezone }, { db, actor, clock }) {
        const c = db.must('campaigns', campaignId);
        editable(c);
        if (new Date(startAt) < clock.startOfDay(clock.now()))
          throw fail.validation('Start time is in the past');
        return db.update(
          'campaigns',
          c.id,
          {
            schedule: { startAt, timezone: timezone ?? 'UTC' },
            status: c.status === 'draft' ? 'scheduled' : c.status,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'launch',
      title: 'Launch campaign',
      effect: 'external',
      description: 'Launch a campaign to its audience. Requires an audience and at least one step.',
      input: z.object({ campaignId: ref('campaigns') }),
      handler({ campaignId }, { db, actor }) {
        const c = db.must('campaigns', campaignId);
        if (!['draft', 'scheduled'].includes(c.status)) throw fail.state(`Campaign ${c.name} is ${c.status}`);
        const problems = [!c.audience && 'no audience', !c.steps.length && 'no message steps'].filter(
          Boolean,
        );
        if (problems.length) throw fail.state(`Campaign cannot launch: ${problems.join(', ')}`, { problems });
        const size = audienceSize(db, c.audience);
        return db.update(
          'campaigns',
          c.id,
          {
            status: 'active',
            launchedAt: db.clock.nowIso(),
            stats: { ...c.stats, sent: c.stats.sent + size, delivered: c.stats.delivered + size },
          },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A08',
      name: 'pause',
      title: 'Pause campaign',
      collection: 'campaigns',
      idField: 'campaignId',
      from: ['active', 'scheduled'],
      to: 'paused',
      description: 'Pause an active campaign.',
    }),
    crud.transition({
      code: 'A09',
      name: 'resume',
      title: 'Resume campaign',
      collection: 'campaigns',
      idField: 'campaignId',
      from: ['paused'],
      to: 'active',
      effect: 'external',
      description: 'Resume a paused campaign (messages will start sending again).',
    }),
    action({
      code: 'A10',
      name: 'performance',
      title: 'Get campaign performance',
      effect: 'read',
      description:
        'Delivery, open, click, reply and conversion stats with rates, plus leads attributed to the campaign.',
      input: z.object({ campaignId: ref('campaigns') }),
      output: out.shape({
        campaignId: z.string(),
        stats: z.record(z.string(), z.number()),
        rates: z.record(z.string(), z.number()),
      }),
      handler({ campaignId }, { db }) {
        const c = db.must('campaigns', campaignId);
        const st = c.stats;
        const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
        return {
          campaignId: c.id,
          name: c.name,
          status: c.status,
          stats: st,
          rates: {
            deliveryRate: pct(st.delivered, st.sent),
            openRate: pct(st.opened, st.delivered),
            clickRate: pct(st.clicked, st.delivered),
            replyRate: pct(st.replied, st.delivered),
            conversionRate: pct(st.conversions, st.delivered),
          },
          attributedLeads: db.find('leads', (l) => l.campaignId === c.id).length,
        };
      },
    }),
  ],
};
