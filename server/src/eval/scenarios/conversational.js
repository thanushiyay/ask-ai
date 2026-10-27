import { truth } from '../helpers.js';

const noSuch =
  /can'?t|cannot|not able|unable|isn'?t (possible|supported|available)|not (supported|available|possible)|no (way|action|integration|capability)|don'?t (have|support)|doesn'?t support|outside/i;

export const indirect = [
  {
    id: 'I01-catalog-forget-followups',
    category: 'indirect',
    modules: ['leads', 'tasks', 'workflows', 'triggers'],
    turns: ['I keep forgetting to follow up with new leads. Help me stay on top of them.'],
    expect: {
      state: [
        [
          'created follow-up tasks for new leads OR set up an automation',
          (h) => {
            const tasks = h.created(
              'tasks',
              (t) =>
                t.status === 'open' &&
                (t.relatedTo?.type === 'lead' ||
                  h.seedFind('leads', (l) => l.contactId === t.contactId && l.status === 'new').length),
            );
            const auto =
              h.created('workflows', (w) => w.steps.some((s) => s.type === 'create_task')).length ||
              h.created('triggers', (t) => t.eventType === 'lead.created').length;
            return tasks.length > 0 || auto > 0;
          },
        ],
        [
          'tasks (if any) only target new leads',
          (h) =>
            h.created('tasks').every((t) => {
              const l =
                t.relatedTo?.type === 'lead'
                  ? h.seedGet('leads', t.relatedTo.id)
                  : h.seedFind('leads', (x) => x.contactId === t.contactId)[0];
              return l && l.status === 'new';
            }),
        ],
      ],
    },
  },
  {
    id: 'I02-support-inbox',
    category: 'indirect',
    modules: ['conversations'],
    turns: ['Our support inbox is getting out of hand, customers are waiting on us.'],
    expect: {
      actions: [['conversations.list_unanswered', 'conversations.search']],
      state: [
        [
          'reports how many are waiting',
          (h) =>
            h.mentionsNumber(
              h.seedFind('conversations', (x) => x.status === 'open' && x.awaitingReply).length,
            ),
        ],
      ],
    },
  },
  {
    id: 'I03-late-payers',
    category: 'indirect',
    modules: ['invoices'],
    autoConfirm: false,
    turns: ["We're losing money on people who don't pay on time."],
    expect: {
      actions: [['invoices.list_overdue', 'invoices.search']],
      state: [
        [
          'nothing sent without confirmation',
          (h) => h.created('emails', (e) => e.status === 'sent').length === 0,
        ],
      ],
    },
  },
  {
    id: 'I04-prep-demo',
    category: 'indirect',
    modules: ['contacts', 'opportunities', 'notes', 'appointments'],
    turns: ["Sarah Johnson's demo is tomorrow and I want to be prepared."],
    expect: {
      actions: ['contacts.search'],
      state: [
        [
          'pulled context from 2+ modules',
          (h) =>
            new Set(h.ok.filter((c) => !c.id.startsWith('contacts.')).map((c) => c.id.split('.')[0])).size >=
            2,
        ],
        ['mentions something relevant', (h) => /SSO|18,?000|enterprise|proposal|discount/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'I05-cover-out-of-office',
    category: 'indirect',
    modules: ['users', 'tasks', 'leads', 'teams'],
    turns: ["Hannah is out this week — make sure her work doesn't fall through the cracks."],
    expect: {
      actions: [['tasks.search', 'leads.search']],
      state: [
        [
          'Hannah has no open tasks left',
          (h) => h.find('tasks', (t) => t.ownerId === 'usr_0006' && t.status === 'open').length === 0,
        ],
        [
          'reassigned to available reps',
          (h) =>
            h
              .changed('tasks')
              .every((t) => !truth.unavailableUserIds(h).includes(t.ownerId) && t.ownerId !== 'usr_0006'),
        ],
      ],
    },
  },
  {
    id: 'I06-no-shows',
    category: 'indirect',
    modules: ['appointments'],
    turns: ['Too many people are no-showing to their appointments lately.'],
    expect: {
      actions: ['appointments.search'],
      state: [
        [
          'names at least one no-show',
          (h) =>
            h
              .seedFind('appointments', (a) => a.status === 'no_show')
              .some((a) => h.allText.includes(h.seedGet('contacts', a.contactId).name)),
        ],
      ],
    },
  },
  {
    id: 'I07-best-channel',
    category: 'indirect',
    modules: ['reports', 'leads'],
    turns: ["I'd like to know which marketing channel brings us the most leads."],
    expect: {
      actions: [['reports.run', 'leads.search']],
      noWrites: true,
      state: [
        [
          'names the top source',
          (h) => {
            const count = (pred) => {
              const m = {};
              h.seedFind('leads', pred).forEach((l) => (m[l.source] = (m[l.source] ?? 0) + 1));
              return Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
            };
            const tops = [count(() => true), count((l) => l.createdAt >= h.cal.last30Days.from)];
            return tops.some((t) => new RegExp(t.replace('_', '.?'), 'i').test(h.reply));
          },
        ],
      ],
    },
  },
  {
    id: 'I08-hoodie-stock',
    category: 'indirect',
    modules: ['products'],
    turns: ['The hoodie keeps selling out.'],
    expect: {
      actions: [['products.inventory_availability', 'products.get', 'products.search']],
      noWrites: true,
      state: [
        [
          'mentions the out-of-stock size',
          (h) => /large|out of stock|0 (in stock|units|left)/i.test(h.reply),
        ],
      ],
    },
  },
  {
    id: 'I09-bad-review',
    category: 'indirect',
    modules: ['reviews'],
    turns: ["Nobody has responded to Ryan Foster's bad review yet."],
    expect: {
      actions: ['reviews.draft_response'],
      state: [['response prepared on that review', (h) => Boolean(h.get('reviews', 'rev_0004').response)]],
    },
  },
  {
    id: 'I10-listing-mismatch',
    category: 'indirect',
    modules: ['listings'],
    turns: ['Our Yelp profile looks different from our Google one.'],
    expect: {
      actions: [['listings.sync_status', 'listings.get', 'listings.search']],
      state: [
        ['identifies the difference', (h) => /name|address|inc|500 market/i.test(h.allText)],
        [
          'if changed, Yelp now matches Google',
          (h) =>
            h.unchanged('listings', 'lst_0002') ||
            ['name', 'address'].every(
              (k) =>
                h.get('listings', 'lst_0002')[k] === h.get('listings', 'lst_0001')[k] ||
                h.get('listings', 'lst_0002')[k] === h.seedGet('listings', 'lst_0002')[k],
            ),
        ],
      ],
    },
  },
];

export const followUp = [
  {
    id: 'F01-catalog-refine-followups',
    category: 'follow_up',
    modules: ['leads', 'conversations', 'appointments', 'tasks', 'campaigns'],
    turns: [
      'Find leads created last week who have not replied, exclude anyone with a booked appointment, assign the remaining leads to available sales reps, and create follow-up tasks.',
      'Only include leads from the Facebook campaign, and make those tasks due tomorrow.',
    ],
    expect: {
      state: [
        [
          'open follow-up tasks only for the Facebook subset',
          (h) => {
            const fb = truth
              .lastWeekLeadsToFollowUp(h)
              .filter((l) => l.source === 'facebook')
              .map((l) => l.id);
            const open = h
              .created('tasks', (t) => t.status === 'open')
              .map((t) =>
                t.relatedTo?.type === 'lead'
                  ? t.relatedTo.id
                  : h.seedFind('leads', (l) => l.contactId === t.contactId)[0]?.id,
              );
            return fb.length > 0 && h.sameSet(open, fb);
          },
        ],
        [
          'all due tomorrow',
          (h) =>
            h
              .created('tasks', (t) => t.status === 'open')
              .every((t) => h.dateOf(t.dueDate) === h.cal.tomorrow),
        ],
      ],
    },
  },
  {
    id: 'F02-overdue-then-remind-except',
    category: 'follow_up',
    modules: ['invoices', 'email'],
    turns: [
      'Show me invoices more than 20 days overdue.',
      'Send reminders for all of them except Aaron Ortiz.',
    ],
    expect: {
      actions: [
        ['invoices.list_overdue', 'invoices.search'],
        ['invoices.send_reminder', 'email.send'],
      ],
      state: [
        [
          'reminders for exactly the right invoices (unsubscribed ones fail)',
          (h) =>
            h.sameSet(
              h.created('emails', (e) => e.status === 'sent').map((e) => e.invoiceId),
              h
                .seedFind(
                  'invoices',
                  (i) =>
                    h.daysOverdue(i) > 20 &&
                    i.contactId !== 'con_0049' &&
                    h.seedGet('contacts', i.contactId).commPrefs.email === 'subscribed',
                )
                .map((i) => i.id),
            ),
        ],
        [
          'first turn sent nothing',
          (h) => h.calls.filter((c) => c.ok && /send/.test(c.id)).every((c) => c.turn > 0),
        ],
      ],
    },
  },
  {
    id: 'F03-change-task',
    category: 'follow_up',
    modules: ['tasks', 'contacts'],
    turns: [
      'Create a task to call Wyatt Smith tomorrow.',
      'Actually make it Thursday next week, and high priority.',
    ],
    expect: {
      state: [
        [
          'one open task for Wyatt, Thursday next week, high',
          (h) => {
            const t = h.created('tasks', (x) => x.contactId === 'con_0001' && x.status === 'open');
            return t.length === 1 && h.dateOf(t[0].dueDate) === '2026-10-22' && t[0].priority === 'high';
          },
        ],
      ],
    },
  },
  {
    id: 'F04-tag-the-vips',
    category: 'follow_up',
    modules: ['contacts', 'tags'],
    turns: ['Find contacts tagged vip.', "Add the tag 'priority-support' to all of them."],
    expect: {
      actions: ['contacts.search', 'tags.apply'],
      state: [
        [
          'all vips tagged',
          (h) => {
            const v = h.seedFind('contacts', (x) => x.status === 'active' && x.tags.includes('vip'));
            return (
              v.every((x) => h.get('contacts', x.id).tags.includes('priority-support')) &&
              h.find('contacts', (x) => x.tags.includes('priority-support')).length === v.length
            );
          },
        ],
      ],
    },
  },
  {
    id: 'F05-draft-then-send',
    category: 'follow_up',
    modules: ['email'],
    turns: ['Draft an email to Sarah Johnson thanking her for her time today.', 'Looks good — send it.'],
    expect: {
      actions: ['email.draft', 'email.send'],
      state: [
        [
          'exactly one email, now sent',
          (h) => {
            const e = h.created('emails', (x) => x.contactId === 'con_0061');
            return e.length === 1 && e[0].status === 'sent';
          },
        ],
      ],
    },
  },
  {
    id: 'F06-biggest-deal',
    category: 'follow_up',
    modules: ['opportunities', 'pipelines', 'users'],
    turns: ['How many open deals does Priya own?', 'Move the biggest one to the Negotiation stage.'],
    expect: {
      state: [
        [
          'biggest deal handled correctly',
          (h) => {
            const deals = h
              .seedFind('opportunities', (o) => o.ownerId === 'usr_0002' && o.status === 'open')
              .sort((a, b) => b.value - a.value);
            const big = deals[0];
            const pipe = h.seedGet('pipelines', big.pipelineId);
            const neg = pipe.stages.find((s) => /negotiation/i.test(s.name));
            if (neg) return h.get('opportunities', big.id).stageId === neg.id;
            return h.unchanged('opportunities', big.id) && /negotiation|stage|pipeline/i.test(h.reply);
          },
        ],
        [
          'first answer has the count',
          (h) =>
            new RegExp(
              `\\b${h.seedFind('opportunities', (o) => o.ownerId === 'usr_0002' && o.status === 'open').length}\\b`,
            ).test(h.replies[0]),
        ],
      ],
    },
  },
  {
    id: 'F07-extend-trial',
    category: 'follow_up',
    modules: ['subscriptions'],
    turns: ['List the subscriptions that are still in trial.', 'Extend that trial by two weeks.'],
    expect: {
      actions: ['subscriptions.search', 'subscriptions.set_trial_end'],
      state: [
        [
          'trial +14 days',
          (h) =>
            h.dateOf(h.get('subscriptions', 'sub_0004').trialEndsAt) ===
            new Date(new Date(h.seedGet('subscriptions', 'sub_0004').trialEndsAt).getTime() + 14 * 864e5)
              .toISOString()
              .slice(0, 10),
        ],
      ],
    },
  },
  {
    id: 'F08-lead-then-assign',
    category: 'follow_up',
    modules: ['leads', 'users'],
    turns: [
      'Create a lead for Maria Gomez, maria.gomez@example.com, she came from our website.',
      'Assign her to Elena and set her score to 80.',
    ],
    expect: {
      actions: ['leads.create', 'leads.assign_owner', 'leads.update_score'],
      state: [
        [
          'lead updated',
          (h) =>
            h.created(
              'leads',
              (l) =>
                l.email === 'maria.gomez@example.com' &&
                l.ownerId === 'usr_0004' &&
                l.score === 80 &&
                l.source === 'website',
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'F09-event-registrations',
    category: 'follow_up',
    modules: ['events', 'contacts'],
    turns: ['Who is registered for the Customer Meetup NYC?', 'Also register Sarah Miller and Laura Chen.'],
    expect: {
      actions: ['events.register'],
      state: [
        [
          'both registered',
          (h) =>
            ['con_0062', 'con_0065'].every((id) =>
              h
                .get('events', 'evt_0002')
                .registrations.some((r) => r.contactId === id && r.status === 'registered'),
            ),
        ],
        ['first reply names Sarah Johnson', (h) => /sarah johnson/i.test(h.replies[0])],
      ],
    },
  },
  {
    id: 'F10-webinar-tasks-then-assign',
    category: 'follow_up',
    modules: ['leads', 'tasks', 'users'],
    turns: [
      'Create a follow-up task for each webinar lead that is still new.',
      'Assign all of those tasks to Omar.',
    ],
    expect: {
      state: [
        [
          'tasks for the new webinar leads, owned by Omar',
          (h) => {
            const exp = h
              .seedFind('leads', (l) => l.source === 'webinar' && l.status === 'new')
              .map((l) => l.contactId);
            const t = h.created('tasks', (x) => x.status === 'open');
            return (
              h.sameSet(
                t.map((x) => x.contactId),
                exp,
              ) && t.every((x) => x.ownerId === 'usr_0007')
            );
          },
        ],
      ],
    },
  },
];

export const ambiguous = [
  {
    id: 'A01-which-sarah',
    category: 'ambiguous',
    modules: ['sms', 'contacts'],
    autoConfirm: false,
    turns: ['Send Sarah a text saying her demo was moved.'],
    expect: {
      noWrites: true,
      state: [['asks which Sarah', (h) => /johnson/i.test(h.reply) && /miller/i.test(h.reply)]],
    },
  },
  {
    id: 'A02-invoice-missing-details',
    category: 'ambiguous',
    modules: ['invoices'],
    autoConfirm: false,
    turns: ['Create an invoice.'],
    expect: { noWrites: true, reply: /\?/ },
  },
  {
    id: 'A03-which-lead',
    category: 'ambiguous',
    modules: ['leads'],
    autoConfirm: false,
    turns: ['Assign the lead to Marcus.'],
    expect: { noWrites: true, reply: /\?/ },
  },
  {
    id: 'A04-meeting-no-time',
    category: 'ambiguous',
    modules: ['appointments'],
    autoConfirm: false,
    turns: ['Book a meeting with Mike next week.'],
    expect: { noWrites: true, reply: /\?/ },
  },
  {
    id: 'A05-which-price',
    category: 'ambiguous',
    modules: ['prices'],
    autoConfirm: false,
    turns: ['Change the price to $59.'],
    expect: { noWrites: true, reply: /\?/ },
  },
  {
    id: 'A06-schedule-newsletter',
    category: 'ambiguous',
    modules: ['campaigns'],
    autoConfirm: false,
    turns: ['Schedule the newsletter.'],
    expect: { forbid: ['campaigns.launch', 'campaigns.set_schedule'], reply: /\?/ },
  },
  {
    id: 'A07-which-sarah-resolved',
    category: 'ambiguous',
    modules: ['sms', 'contacts'],
    turns: ['Send Sarah a text saying her demo was moved.', 'Sarah Johnson'],
    expect: {
      actions: ['sms.send'],
      state: [
        [
          'texted Sarah Johnson only',
          (h) =>
            h
              .created('sms', (m) => m.status === 'sent')
              .map((m) => m.contactId)
              .join() === 'con_0061',
        ],
      ],
    },
  },
  {
    id: 'A08-which-deal',
    category: 'ambiguous',
    modules: ['opportunities'],
    autoConfirm: false,
    turns: ['Give the deal to Elena.'],
    expect: { noWrites: true, reply: /\?/ },
  },
];

export const unsupported = [
  {
    id: 'U01-instagram',
    category: 'unsupported',
    modules: ['campaigns'],
    turns: ['Post our fall promo on Instagram.'],
    expect: { noWrites: true, reply: noSuch },
  },
  {
    id: 'U02-phone-call',
    category: 'unsupported',
    modules: ['contacts'],
    turns: ['Call Sarah Johnson on the phone right now.'],
    expect: { noWrites: true, reply: noSuch },
  },
  {
    id: 'U03-google-sheets',
    category: 'unsupported',
    modules: ['smart_lists'],
    turns: ['Export all our contacts into a Google Sheet.'],
    expect: {
      forbidEffects: ['external', 'destructive'],
      reply: /google sheet|csv|can'?t|cannot|not able|unable/i,
    },
  },
  {
    id: 'U04-weather',
    category: 'unsupported',
    modules: [],
    turns: ["What's the weather in Paris today?"],
    expect: { noWrites: true, reply: noSuch },
  },
  {
    id: 'U05-delete-everything',
    category: 'unsupported',
    modules: [],
    autoConfirm: false,
    turns: ['Delete our entire database.'],
    expect: { noWrites: true },
  },
  {
    id: 'U06-salesforce',
    category: 'unsupported',
    modules: ['contacts'],
    turns: ['Sync our contacts with Salesforce.'],
    expect: { noWrites: true, reply: noSuch },
  },
];

export const failure = [
  {
    id: 'X01-event-full',
    category: 'failure',
    modules: ['events'],
    turns: ['Register Sarah Johnson for the Growth Masterclass.'],
    expect: {
      state: [
        [
          'not registered (event is full)',
          (h) =>
            !h
              .get('events', 'evt_0001')
              .registrations.some((r) => r.contactId === 'con_0061' && r.status === 'registered'),
        ],
        ['explains it is full', (h) => /full|capacity|waitlist/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X02-expired-quote',
    category: 'failure',
    modules: ['quotes'],
    turns: ['Record that Grace Jensen accepted quote Q-1999.'],
    expect: {
      state: [
        ['not accepted', (h) => h.get('quotes', 'quo_0004').status !== 'accepted'],
        ['explains expiry', (h) => /expir/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X03-void-paid',
    category: 'failure',
    modules: ['invoices'],
    turns: ['Void invoice INV-1060.'],
    expect: {
      state: [
        ['still paid', (h) => h.get('invoices', 'inv_0020').status === 'paid'],
        ['explains it is paid', (h) => /paid|refund/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X04-sms-opted-out',
    category: 'failure',
    modules: ['sms'],
    turns: ['Text Laura Chen that her order is ready for pickup.'],
    expect: {
      state: [
        [
          'no sms sent',
          (h) => h.created('sms', (m) => m.contactId === 'con_0065' && m.status === 'sent').length === 0,
        ],
        ['explains opt-out', (h) => /opt(ed)?[- ]?out|unsubscrib|stop/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X05-archive-busy-pipeline',
    category: 'failure',
    modules: ['pipelines'],
    turns: ['Archive the Sales Pipeline.'],
    expect: {
      state: [
        ['still active', (h) => h.get('pipelines', 'pipe_0001').status === 'active'],
        ['explains open deals', (h) => /open deal|deals/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X06-remove-busy-stage',
    category: 'failure',
    modules: ['pipelines'],
    turns: ['Remove the Proposal stage from the Sales Pipeline.'],
    expect: {
      state: [
        ['stage kept', (h) => h.get('pipelines', 'pipe_0001').stages.some((s) => s.name === 'Proposal')],
        ['explains open deals', (h) => /open deal|deals/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X07-email-unsubscribed',
    category: 'failure',
    modules: ['email', 'invoices'],
    turns: ['Email Peter Novak a reminder about invoice INV-1053.'],
    expect: {
      state: [
        [
          'nothing sent',
          (h) => h.created('emails', (e) => e.contactId === 'con_0066' && e.status === 'sent').length === 0,
        ],
        ['explains unsubscribe', (h) => /unsubscrib|opted out/i.test(h.allText)],
      ],
    },
  },
  {
    id: 'X08-publish-empty-course',
    category: 'failure',
    modules: ['courses'],
    turns: ['Publish the Sales Playbook course.'],
    expect: {
      state: [
        ['still draft', (h) => h.get('courses', 'crs_0003').status === 'draft'],
        ['explains why', (h) => /instructor|lesson/i.test(h.allText)],
      ],
    },
  },
];
