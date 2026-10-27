import { truth } from '../helpers.js';

const followUpTasks = (h) => h.created('tasks', (t) => t.status === 'open');
const leadOfTask = (h, t) =>
  t.relatedTo?.type === 'lead'
    ? t.relatedTo.id
    : h.seedFind('leads', (l) => l.contactId === t.contactId)[0]?.id;

export const multiStep = [
  {
    id: 'M01-catalog-complex-followup',
    category: 'multi_step',
    modules: ['leads', 'conversations', 'appointments', 'teams', 'users', 'tasks'],
    turns: [
      'Find leads created last week who have not replied, exclude anyone with a booked appointment, assign the remaining leads to available sales reps, and create follow-up tasks.',
    ],
    expect: {
      actions: [
        'leads.search',
        ['conversations.search', 'conversations.list_unanswered'],
        'appointments.search',
        'tasks.create',
        ['leads.assign_owner', 'contacts.assign_owner'],
      ],
      state: [
        [
          'one task per eligible lead',
          (h) =>
            h.sameSet(
              followUpTasks(h).map((t) => leadOfTask(h, t)),
              truth.lastWeekLeadsToFollowUp(h).map((l) => l.id),
            ),
        ],
        [
          'eligible leads have an owner',
          (h) => truth.lastWeekLeadsToFollowUp(h).every((l) => h.get('leads', l.id).ownerId),
        ],
        [
          'owners are available sales reps',
          (h) => {
            const bad = truth.unavailableUserIds(h);
            return truth.lastWeekLeadsToFollowUp(h).every((l) => {
              const o = h.get('leads', l.id).ownerId;
              return o && !bad.includes(o) && h.get('users', o).roles.includes('sales_rep');
            });
          },
        ],
        [
          'tasks are owned by the assigned rep',
          (h) =>
            followUpTasks(h).every(
              (t) => t.ownerId && t.ownerId === h.get('leads', leadOfTask(h, t))?.ownerId,
            ),
        ],
      ],
    },
  },
  {
    id: 'M02-new-leads-no-appointment',
    category: 'multi_step',
    modules: ['leads', 'appointments', 'tasks'],
    turns: ["Find new leads who haven't booked an appointment and create follow-up tasks for them."],
    expect: {
      actions: ['leads.search', 'appointments.search', 'tasks.create'],
      state: [
        [
          'tasks only for new leads without a booking, covering all of them that lack a follow-up',
          (h) => {
            const booked = new Set(
              h.seedFind('appointments', (a) => a.status === 'booked').map((a) => a.contactId),
            );
            const eligible = h.seedFind('leads', (l) => l.status === 'new' && !booked.has(l.contactId));
            const hasTask = new Set(
              h
                .seedFind('tasks', (t) => t.status === 'open' && t.type === 'follow_up')
                .map((t) => t.contactId),
            );
            const got = new Set(followUpTasks(h).map((t) => leadOfTask(h, t)));
            return (
              [...got].every((id) => eligible.some((l) => l.id === id)) &&
              eligible.filter((l) => !hasTask.has(l.contactId)).every((l) => got.has(l.id))
            );
          },
        ],
      ],
    },
  },
  {
    id: 'M03-convert-and-task',
    category: 'multi_step',
    modules: ['leads', 'opportunities', 'tasks', 'users'],
    turns: [
      "Convert Clara Moreau's lead into an opportunity worth $12,000, then create a task for Priya to send her a proposal by Friday.",
    ],
    expect: {
      actions: ['leads.convert_to_opportunity', 'tasks.create'],
      state: [
        ['lead converted', (h) => h.get('leads', 'lead_0026').status === 'converted'],
        [
          'opportunity 12000',
          (h) =>
            h.created('opportunities', (o) => o.leadId === 'lead_0026' && o.value === 12000).length === 1,
        ],
        [
          'task for Priya due Friday',
          (h) =>
            h.created(
              'tasks',
              (t) =>
                t.ownerId === 'usr_0002' && /proposal/i.test(t.title) && h.dateOf(t.dueDate) === '2026-10-16',
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'M04-assign-unassigned-tickets',
    category: 'multi_step',
    modules: ['tickets', 'teams', 'users'],
    turns: [
      'Assign every unassigned open support ticket to whoever on the Support team has the lightest workload.',
    ],
    expect: {
      actions: ['tickets.search', ['teams.workload', 'users.list', 'teams.get'], 'tickets.assign_owner'],
      state: [
        [
          'all unassigned open tickets now owned by support staff',
          (h) =>
            h
              .seedFind('tickets', (t) => t.status === 'open' && !t.ownerId)
              .every((t) => ['usr_0008', 'usr_0009'].includes(h.get('tickets', t.id).ownerId)),
        ],
        [
          'already-assigned tickets unchanged',
          (h) =>
            h
              .seedFind('tickets', (t) => t.ownerId)
              .every((t) => h.get('tickets', t.id).ownerId === t.ownerId),
        ],
      ],
    },
  },
  {
    id: 'M05-churn-risk-calls',
    category: 'multi_step',
    modules: ['contacts', 'tasks'],
    turns: [
      'For every contact tagged churn-risk, create a high-priority task for their owner to call them this week.',
    ],
    expect: {
      actions: ['contacts.search', 'tasks.create'],
      params: [['tasks.create', (a) => a.priority === 'high']],
      state: [
        [
          'one high-priority task per churn-risk contact',
          (h) =>
            h.sameSet(
              h.created('tasks', (t) => t.priority === 'high').map((t) => t.contactId),
              h.seedFind('contacts', (x) => x.tags.includes('churn-risk')).map((x) => x.id),
            ),
        ],
        [
          'owned by the contact owner when there is one',
          (h) =>
            h.created('tasks').every((t) => {
              const o = h.seedGet('contacts', t.contactId)?.ownerId;
              return !o || t.ownerId === o;
            }),
        ],
        ['due this week', (h) => h.created('tasks').every((t) => t.dueDate && t.dueDate < h.cal.thisWeek.to)],
      ],
    },
  },
  {
    id: 'M06-invoice-and-send',
    category: 'multi_step',
    modules: ['invoices', 'products', 'contacts'],
    turns: ['Create an invoice for Emma Patel for the Strategy Workshop and send it to her.'],
    expect: {
      actions: [['invoices.create', 'invoices.add_line_item'], 'invoices.issue'],
      state: [
        [
          'issued invoice with the workshop',
          (h) =>
            h.created(
              'invoices',
              (i) =>
                i.contactId === 'con_0008' &&
                i.status === 'issued' &&
                i.lineItems.some((l) => l.productId === 'prod_0005' || /workshop/i.test(l.description)),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'M07-book-and-email',
    category: 'multi_step',
    modules: ['appointments', 'calendars', 'email', 'contacts'],
    turns: ['Book Sarah Miller a Discovery Call next Tuesday at 2pm UTC and email her a confirmation.'],
    expect: {
      actions: ['appointments.create', 'email.send'],
      state: [
        [
          'appointment booked',
          (h) =>
            h.created(
              'appointments',
              (a) =>
                a.contactId === 'con_0062' &&
                a.calendarId === 'cal_0001' &&
                a.startAt.startsWith('2026-10-20T14:00') &&
                a.status === 'booked',
            ).length === 1,
        ],
        [
          'confirmation email sent',
          (h) => h.created('emails', (e) => e.contactId === 'con_0062' && e.status === 'sent').length === 1,
        ],
      ],
    },
  },
  {
    id: 'M08-push-overdue-tasks',
    category: 'multi_step',
    modules: ['tasks'],
    turns: ['Push the due date of every overdue task to next Monday.'],
    expect: {
      actions: ['tasks.search', 'tasks.set_due_date'],
      state: [
        [
          'every overdue open task now due next Monday',
          (h) => {
            const od = h.seedFind('tasks', (t) => t.status === 'open' && t.dueDate && t.dueDate < h.now);
            return od.length > 0 && od.every((t) => h.dateOf(h.get('tasks', t.id).dueDate) === '2026-10-19');
          },
        ],
        [
          'non-overdue tasks untouched',
          (h) =>
            h
              .seedFind('tasks', (t) => !(t.status === 'open' && t.dueDate && t.dueDate < h.now))
              .every((t) => h.unchanged('tasks', t.id)),
        ],
      ],
    },
  },
  {
    id: 'M09-tag-big-debtors',
    category: 'multi_step',
    modules: ['invoices', 'tags', 'contacts'],
    turns: ["Tag everyone with an unpaid invoice over $1,000 as 'collections'."],
    expect: {
      actions: [['invoices.search', 'invoices.list_overdue'], 'tags.apply'],
      state: [
        [
          'exactly those contacts tagged',
          (h) =>
            h.sameSet(
              h.find('contacts', (x) => x.tags.includes('collections')).map((x) => x.id),
              [
                ...new Set(
                  h
                    .seedFind('invoices', (i) => i.status === 'issued' && i.balance > 1000)
                    .map((i) => i.contactId),
                ),
              ],
            ),
        ],
      ],
    },
  },
  {
    id: 'M10-review-requests-after-meetings',
    category: 'multi_step',
    modules: ['appointments', 'reviews'],
    turns: ['Ask everyone whose appointment was completed in the last two weeks for a review by email.'],
    expect: {
      actions: ['appointments.search', 'reviews.create_request', 'reviews.send_request'],
      state: [
        [
          'review requests sent to exactly those contacts',
          (h) =>
            h.sameSet(
              h
                .created('review_requests', (r) => r.status === 'sent' && r.channel === 'email')
                .map((r) => r.contactId),
              h
                .seedFind(
                  'appointments',
                  (a) => a.status === 'completed' && a.startAt >= h.clock.daysAgo(14).toISOString(),
                )
                .map((a) => a.contactId),
            ),
        ],
      ],
    },
  },
  {
    id: 'M11-campaign-setup',
    category: 'multi_step',
    modules: ['campaigns'],
    turns: [
      "Set up an email campaign called 'Black Friday 2026' for contacts tagged vip, with a first message 'Early access for VIPs', starting November 27 at 9am UTC. Don't launch it yet.",
    ],
    expect: {
      actions: ['campaigns.create', 'campaigns.set_audience', 'campaigns.add_step', 'campaigns.set_schedule'],
      forbid: ['campaigns.launch'],
      state: [
        [
          'campaign configured',
          (h) => {
            const c = h.created('campaigns', (x) => /black friday 2026/i.test(x.name))[0];
            return Boolean(
              c &&
              c.audience?.type === 'tag' &&
              c.audience.value === 'vip' &&
              c.steps.some((s) => /early access/i.test(s.subject ?? '')) &&
              c.schedule?.startAt?.startsWith('2026-11-27T09:00') &&
              c.status !== 'active',
            );
          },
        ],
      ],
    },
  },
  {
    id: 'M12-coupon-on-order',
    category: 'multi_step',
    modules: ['coupons', 'orders'],
    turns: [
      "Create a coupon WELCOME10 for 10% off, apply it to Kenji Foster's draft order, and tell me the new total.",
    ],
    expect: {
      actions: ['coupons.create', 'orders.apply_coupon'],
      state: [
        ['coupon applied', (h) => h.get('orders', 'ord_0001').couponCode === 'WELCOME10'],
        [
          'reply has new total',
          (h) =>
            h.mentionsNumber(h.get('orders', 'ord_0001').total) ||
            h.reply.includes(h.get('orders', 'ord_0001').total.toFixed(2)),
        ],
      ],
    },
  },
  {
    id: 'M13-automation-new-leads',
    category: 'multi_step',
    modules: ['workflows', 'triggers'],
    turns: [
      'Set up an automation: whenever a new lead is created, create a follow-up task due the next day. Turn it on.',
    ],
    expect: {
      actions: [
        'workflows.create',
        'workflows.publish',
        ['triggers.create', 'triggers.bind_workflow'],
        'triggers.enable',
      ],
      state: [
        [
          'published workflow with a create_task step bound to an enabled lead.created trigger',
          (h) => {
            const wf = h.created(
              'workflows',
              (w) => w.status === 'published' && w.steps.some((s) => s.type === 'create_task'),
            );
            return wf.some(
              (w) =>
                h.find(
                  'triggers',
                  (t) => t.workflowId === w.id && t.eventType === 'lead.created' && t.enabled,
                ).length > 0,
            );
          },
        ],
      ],
    },
  },
  {
    id: 'M14-account-brief',
    category: 'multi_step',
    modules: ['contacts', 'opportunities', 'invoices', 'appointments'],
    turns: [
      'Give me a quick brief on Sarah Johnson: her open deals, unpaid invoices and upcoming appointments.',
    ],
    expect: {
      actions: [
        'contacts.search',
        'opportunities.search',
        ['invoices.search', 'invoices.list_overdue'],
        'appointments.search',
      ],
      noWrites: true,
      state: [
        ['mentions deal value', (h) => h.mentionsNumber(18000)],
        ['mentions invoice', (h) => /INV-1073/.test(h.reply)],
        ['mentions demo', (h) => /demo/i.test(h.reply)],
      ],
    },
  },
];

export const conditional = [
  {
    id: 'C01-catalog-overdue-reminders',
    category: 'conditional',
    modules: ['invoices', 'email', 'templates'],
    turns: [
      'For unpaid invoices overdue by more than 15 days, draft reminders, but skip customers who already received one this week.',
    ],
    expect: {
      actions: [['invoices.list_overdue', 'invoices.search'], 'email.search', 'email.draft'],
      forbid: ['email.send', 'invoices.send_reminder'],
      state: [
        [
          'a draft for exactly the right invoices',
          (h) => {
            const d = h.created('emails', (e) => e.status === 'draft');
            const exp = truth.overdueToRemind(h);
            return (
              d.length > 0 &&
              (d.every((e) => e.invoiceId)
                ? h.sameSet(
                    d.map((e) => e.invoiceId),
                    exp.map((i) => i.id),
                  )
                : h.sameSet(
                    d.map((e) => e.contactId),
                    exp.map((i) => i.contactId),
                  ))
            );
          },
        ],
        ['nothing was sent', (h) => h.created('emails', (e) => e.status === 'sent').length === 0],
      ],
    },
  },
  {
    id: 'C02-remind-big-overdue',
    category: 'conditional',
    modules: ['invoices', 'email'],
    turns: [
      'Send payment reminders for invoices more than 30 days overdue, but only where the balance is over $1,000.',
    ],
    expect: {
      actions: [
        ['invoices.list_overdue', 'invoices.search'],
        ['invoices.send_reminder', 'email.send'],
      ],
      state: [
        [
          'reminders sent for exactly those invoices',
          (h) =>
            h.sameSet(
              h.created('emails', (e) => e.status === 'sent').map((e) => e.invoiceId),
              h.seedFind('invoices', (i) => h.daysOverdue(i) > 30 && i.balance > 1000).map((i) => i.id),
            ),
        ],
      ],
    },
  },
  {
    id: 'C03-urgent-unassigned',
    category: 'conditional',
    modules: ['tickets', 'users'],
    turns: [
      'If any urgent ticket is still unassigned, give it to Tom Becker. Otherwise leave everything as is.',
    ],
    expect: {
      actions: ['tickets.search', 'tickets.assign_owner'],
      state: [
        [
          'unassigned urgent -> Tom',
          (h) =>
            h
              .seedFind('tickets', (t) => t.priority === 'urgent' && !t.ownerId)
              .every((t) => h.get('tickets', t.id).ownerId === 'usr_0009'),
        ],
        [
          'others untouched',
          (h) =>
            h
              .seedFind('tickets', (t) => !(t.priority === 'urgent' && !t.ownerId))
              .every((t) => h.unchanged('tickets', t.id)),
        ],
      ],
    },
  },
  {
    id: 'C04-stale-negotiations',
    category: 'conditional',
    modules: ['opportunities', 'pipelines'],
    turns: [
      'For deals in the Negotiation stage whose expected close date has already passed, push the close date out by two weeks.',
    ],
    expect: {
      actions: ['opportunities.search', 'opportunities.set_close_date'],
      state: [
        [
          'only stale negotiation deals moved by 2 weeks',
          (h) => {
            const add = (d, n) => new Date(new Date(d).getTime() + n * 864e5).toISOString().slice(0, 10);
            const stale = h.seedFind(
              'opportunities',
              (o) =>
                o.status === 'open' && o.stageId === 'stg_negotiation' && o.expectedCloseDate < h.cal.today,
            );
            return (
              stale.length > 0 &&
              stale.every((o) =>
                [add(o.expectedCloseDate, 14), add(h.cal.today, 14)].includes(
                  h.get('opportunities', o.id).expectedCloseDate,
                ),
              ) &&
              h.changed('opportunities').length === stale.length
            );
          },
        ],
      ],
    },
  },
  {
    id: 'C05-cancel-optout-sms',
    category: 'conditional',
    modules: ['sms', 'contacts'],
    turns: ['Cancel any scheduled text messages going to contacts who have opted out of SMS.'],
    expect: {
      actions: ['sms.search'],
      forbid: ['sms.cancel_scheduled'],
      state: [
        [
          'scheduled sms to opted-in contact untouched',
          (h) => h.get('sms', 'sms_0011').status === 'scheduled',
        ],
        ['reply says none', (h) => /no |none|nothing|0 /i.test(h.reply)],
      ],
    },
  },
  {
    id: 'C06-disqualify-stale-leads',
    category: 'conditional',
    modules: ['leads'],
    turns: [
      "Disqualify leads older than 60 days that are still 'new', with the reason 'No response in 60 days'.",
    ],
    expect: {
      actions: ['leads.search', 'leads.disqualify'],
      params: [['leads.disqualify', (a) => /no response/i.test(a.reason)]],
      state: [
        [
          'exactly the stale new leads disqualified',
          (h) =>
            h.sameSet(
              h.find('leads', (l) => l.status === 'disqualified' && l.updatedAt === h.now).map((l) => l.id),
              h
                .seedFind(
                  'leads',
                  (l) => l.status === 'new' && l.createdAt < h.clock.daysAgo(60).toISOString(),
                )
                .map((l) => l.id),
            ),
        ],
      ],
    },
  },
  {
    id: 'C07-optout-preferred-channel',
    category: 'conditional',
    modules: ['contacts'],
    turns: ['For contacts who have opted out of SMS, make sure their preferred channel is set to email.'],
    expect: {
      actions: [['contacts.search', 'smart_lists.create'], 'contacts.set_communication_preferences'],
      state: [
        [
          'opted-out contacts prefer email',
          (h) =>
            h
              .find('contacts', (x) => x.commPrefs.sms === 'opted_out')
              .every((x) => x.commPrefs.preferredChannel === 'email'),
        ],
        ['nobody else changed', (h) => h.changed('contacts').every((x) => x.commPrefs.sms === 'opted_out')],
      ],
    },
  },
  {
    id: 'C08-refund-threshold',
    category: 'conditional',
    modules: ['refunds'],
    turns: ['Approve refund requests under $50 and reject the rest.'],
    expect: {
      actions: ['refunds.search', 'refunds.approve', 'refunds.reject'],
      state: [
        ['small one approved', (h) => h.get('refunds', 'ref_0001').status === 'approved'],
        ['large one rejected', (h) => h.get('refunds', 'ref_0002').status === 'rejected'],
      ],
    },
  },
];
