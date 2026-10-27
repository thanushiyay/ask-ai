export default [
  {
    id: 'D01-contacts-create',
    category: 'direct',
    modules: ['contacts'],
    turns: ['Create a contact named Sarah Lee with the email sarah.lee@acme.io'],
    expect: {
      actions: ['contacts.create'],
      params: [['contacts.create', (a) => a.email === 'sarah.lee@acme.io' && /sarah/i.test(a.firstName)]],
      state: [
        [
          'contact exists',
          (h) =>
            h.created('contacts', (x) => x.email === 'sarah.lee@acme.io' && x.firstName === 'Sarah')
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D02-companies-create',
    category: 'direct',
    modules: ['companies'],
    turns: ['Add a new company called Brightline Robotics (brightline.io), they are in manufacturing.'],
    expect: {
      actions: ['companies.create'],
      state: [
        [
          'company exists',
          (h) =>
            h.created('companies', (x) => /brightline robotics/i.test(x.name) && x.domain === 'brightline.io')
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D03-leads-create',
    category: 'direct',
    modules: ['leads'],
    turns: ['New lead: Daniel Kim, daniel.kim@example.org — he was referred by a customer.'],
    expect: {
      actions: ['leads.create'],
      params: [['leads.create', (a) => a.source === 'referral']],
      state: [
        [
          'lead exists with referral source',
          (h) =>
            h.created('leads', (l) => l.email === 'daniel.kim@example.org' && l.source === 'referral')
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D04-opportunities-won',
    category: 'direct',
    modules: ['opportunities'],
    turns: ['Mark the Globex reseller pilot deal as won.'],
    expect: {
      actions: ['opportunities.mark_won'],
      state: [['deal won', (h) => h.get('opportunities', 'opp_0025').status === 'won']],
    },
  },
  {
    id: 'D05-pipelines-add-stage',
    category: 'direct',
    modules: ['pipelines'],
    turns: ["Add a stage called 'Contract Sent' to the Sales Pipeline."],
    expect: {
      actions: ['pipelines.add_stage'],
      state: [
        [
          'stage added',
          (h) => h.get('pipelines', 'pipe_0001').stages.some((s) => s.name === 'Contract Sent'),
        ],
      ],
    },
  },
  {
    id: 'D06-tasks-create',
    category: 'direct',
    modules: ['tasks', 'contacts'],
    turns: ['Remind me to call Wyatt Smith tomorrow at 3pm.'],
    expect: {
      actions: ['tasks.create'],
      params: [
        [
          'tasks.create',
          (a, h) => a.contactId === 'con_0001' && String(a.dueDate).startsWith(`${h.cal.tomorrow}T15:00`),
        ],
      ],
      state: [
        [
          'task for Wyatt due tomorrow 15:00',
          (h) =>
            h.created(
              'tasks',
              (t) => t.contactId === 'con_0001' && String(t.dueDate).startsWith(`${h.cal.tomorrow}T15:00`),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D07-notes-create',
    category: 'direct',
    modules: ['notes', 'contacts'],
    turns: ['Add a note to Sarah Johnson: she wants a discount on annual billing.'],
    expect: {
      actions: ['notes.create'],
      state: [
        [
          'note attached',
          (h) =>
            h.created(
              'notes',
              (n) => n.recordRefs.some((r) => r.id === 'con_0061') && /discount/i.test(n.body),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D08-tags-apply',
    category: 'direct',
    modules: ['tags', 'contacts'],
    turns: ['Tag Laura Chen as hot-lead.'],
    expect: {
      actions: ['tags.apply'],
      state: [['tag applied', (h) => h.get('contacts', 'con_0065').tags.includes('hot-lead')]],
    },
  },
  {
    id: 'D09-smart-lists-count',
    category: 'direct',
    modules: ['smart_lists'],
    turns: ['How many contacts are in the VIP customers smart list?'],
    expect: {
      actions: [['smart_lists.count', 'smart_lists.preview']],
      noWrites: true,
      state: [
        [
          'reply has the count',
          (h) =>
            h.mentionsNumber(
              h.seedFind('contacts', (x) => x.status === 'active' && x.tags.includes('vip')).length,
            ),
        ],
      ],
    },
  },
  {
    id: 'D10-custom-fields-option',
    category: 'direct',
    modules: ['custom_fields'],
    turns: ["Add 'education' as an option to the contact Industry dropdown field."],
    expect: {
      actions: ['custom_fields.add_option'],
      state: [
        [
          'option added',
          (h) => h.get('custom_fields', 'cf_0001').options.some((o) => o.value === 'education'),
        ],
      ],
    },
  },
  {
    id: 'D11-conversations-unanswered',
    category: 'direct',
    modules: ['conversations'],
    turns: ['Which conversations are still waiting on a reply from us?'],
    expect: {
      actions: [['conversations.list_unanswered', 'conversations.search']],
      noWrites: true,
      state: [
        [
          'reply has the count',
          (h) =>
            h.mentionsNumber(
              h.seedFind('conversations', (x) => x.status === 'open' && x.awaitingReply).length,
            ),
        ],
      ],
    },
  },
  {
    id: 'D12-sms-send',
    category: 'direct',
    modules: ['sms', 'contacts'],
    turns: ["Text Ryan Patel: 'Your order has shipped!'"],
    expect: {
      actions: ['sms.send'],
      state: [
        [
          'sms sent to Ryan',
          (h) =>
            h.created(
              'sms',
              (m) => m.contactId === 'con_0014' && m.status === 'sent' && /shipped/i.test(m.body),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D13-email-send',
    category: 'direct',
    modules: ['email', 'contacts'],
    turns: [
      "Email Freya Walsh with the subject 'Workshop recording' and let her know the recording link is coming tomorrow.",
    ],
    expect: {
      actions: ['email.send'],
      state: [
        [
          'email sent to Freya',
          (h) =>
            h.created(
              'emails',
              (e) =>
                e.contactId === 'con_0027' && e.status === 'sent' && /workshop recording/i.test(e.subject),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D14-templates-create',
    category: 'direct',
    modules: ['templates'],
    turns: [
      "Create an SMS template called 'Appointment confirmed' that says: Hi {{first_name}}, your appointment is confirmed.",
    ],
    expect: {
      actions: ['templates.create'],
      state: [
        [
          'sms template exists',
          (h) =>
            h.created(
              'templates',
              (t) =>
                t.channel === 'sms' &&
                /appointment confirmed/i.test(t.name) &&
                t.body.includes('{{first_name}}'),
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D15-campaigns-pause',
    category: 'direct',
    modules: ['campaigns'],
    turns: ['Pause the Google Search Q4 campaign.'],
    expect: {
      actions: ['campaigns.pause'],
      state: [['paused', (h) => h.get('campaigns', 'camp_0002').status === 'paused']],
    },
  },
  {
    id: 'D16-workflows-history',
    category: 'direct',
    modules: ['workflows'],
    turns: ['Did any runs of the New lead welcome workflow fail?'],
    expect: {
      actions: ['workflows.execution_history'],
      noWrites: true,
      reply: /fail|error|template/i,
      state: [['mentions 1 failure', (h) => /\b(1|one)\b/i.test(h.reply)]],
    },
  },
  {
    id: 'D17-triggers-disable',
    category: 'direct',
    modules: ['triggers'],
    turns: ["Turn off the 'Lead created' trigger."],
    expect: {
      actions: ['triggers.disable'],
      state: [['disabled', (h) => h.get('triggers', 'trg_0001').enabled === false]],
    },
  },
  {
    id: 'D18-forms-publish',
    category: 'direct',
    modules: ['forms'],
    turns: ['Publish the Webinar registration form.'],
    expect: {
      actions: ['forms.publish'],
      state: [['published', (h) => h.get('forms', 'form_0002').status === 'published']],
    },
  },
  {
    id: 'D19-surveys-nps',
    category: 'direct',
    modules: ['surveys'],
    turns: ["What's our NPS from the Customer NPS Q3 survey?"],
    expect: {
      actions: ['surveys.response_summary'],
      noWrites: true,
      state: [['reply has NPS 25', (h) => h.mentionsNumber(25)]],
    },
  },
  {
    id: 'D20-calendars-buffer',
    category: 'direct',
    modules: ['calendars'],
    turns: ['Set a 15 minute buffer between meetings on the Discovery Call calendar.'],
    expect: {
      actions: ['calendars.set_buffer'],
      state: [['buffer 15', (h) => h.get('calendars', 'cal_0001').bufferMinutes === 15]],
    },
  },
  {
    id: 'D21-appointments-cancel',
    category: 'direct',
    modules: ['appointments', 'contacts'],
    turns: ["Cancel Sarah Johnson's demo tomorrow."],
    expect: {
      actions: ['appointments.cancel'],
      state: [
        ['cancelled', (h) => h.get('appointments', 'appt_0021').status === 'cancelled'],
        ['no other appointment touched', (h) => h.changed('appointments').length === 1],
      ],
    },
  },
  {
    id: 'D22-availability-block',
    category: 'direct',
    modules: ['availability', 'users'],
    turns: ["Block Priya Shah's calendar next Monday from 9am to 12pm UTC for a dentist appointment."],
    expect: {
      actions: ['availability.block_time'],
      state: [
        [
          'block added',
          (h) =>
            h
              .get('availability', 'avl_usr_0002')
              .blocks.some(
                (b) => b.start.startsWith('2026-10-19T09:00') && b.end.startsWith('2026-10-19T12:00'),
              ),
        ],
      ],
    },
  },
  {
    id: 'D23-booking-pages-message',
    category: 'direct',
    modules: ['booking_pages'],
    turns: ["Change the confirmation message on the discovery call booking page to 'Thanks — see you soon!'"],
    expect: {
      actions: ['booking_pages.set_confirmation_message'],
      state: [
        [
          'message set',
          (h) => /thanks\s*[—-]+\s*see you soon/i.test(h.get('booking_pages', 'bp_0001').confirmationMessage),
        ],
      ],
    },
  },
  {
    id: 'D24-events-seats',
    category: 'direct',
    modules: ['events'],
    turns: ['How many seats are left for the Customer Meetup NYC?'],
    expect: {
      actions: [['events.get', 'events.search']],
      noWrites: true,
      state: [['reply has 49', (h) => h.mentionsNumber(49)]],
    },
  },
  {
    id: 'D25-products-inventory',
    category: 'direct',
    modules: ['products'],
    turns: ['Set the Water Bottle inventory to 120 units.'],
    expect: {
      actions: ['products.set_inventory'],
      state: [['inventory 120', (h) => h.get('products', 'prod_0007').inventory === 120]],
    },
  },
  {
    id: 'D26-prices-trial',
    category: 'direct',
    modules: ['prices', 'products'],
    turns: ['Give the Growth Plan monthly price a 30-day free trial.'],
    expect: {
      actions: ['prices.set_trial'],
      state: [
        ['trial 30 on growth monthly', (h) => h.get('prices', 'price_0003').trialDays === 30],
        ['annual untouched', (h) => h.unchanged('prices', 'price_0004')],
      ],
    },
  },
  {
    id: 'D27-quotes-discount',
    category: 'direct',
    modules: ['quotes'],
    turns: ['Apply a 15% discount to quote Q-2003.'],
    expect: {
      actions: ['quotes.apply_discount'],
      state: [
        [
          'discount set',
          (h) => {
            const q = h.get('quotes', 'quo_0003');
            return q.discount?.type === 'percent' && q.discount?.value === 15;
          },
        ],
      ],
    },
  },
  {
    id: 'D28-invoices-line-item',
    category: 'direct',
    modules: ['invoices'],
    turns: ['Add 2 hours of consulting at $150/hour to draft invoice INV-1069.'],
    expect: {
      actions: ['invoices.add_line_item'],
      state: [
        [
          'line added',
          (h) =>
            h
              .get('invoices', 'inv_0029')
              .lineItems.some(
                (l) => /consult/i.test(l.description) && l.quantity === 2 && l.unitPrice === 150,
              ),
        ],
        [
          'total updated',
          (h) => h.get('invoices', 'inv_0029').total === h.seedGet('invoices', 'inv_0029').total + 300,
        ],
      ],
    },
  },
  {
    id: 'D29-payments-record',
    category: 'direct',
    modules: ['payments', 'invoices'],
    turns: ['Record a $298 card payment from Leo Price for invoice INV-1041.'],
    expect: {
      actions: ['payments.record'],
      params: [['payments.record', (a) => a.amount === 298 && a.invoiceId === 'inv_0001']],
      state: [
        ['invoice paid', (h) => h.get('invoices', 'inv_0001').status === 'paid'],
        [
          'payment exists',
          (h) => h.created('payments', (p) => p.contactId === 'con_0004' && p.amount === 298).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D30-subscriptions-pause',
    category: 'direct',
    modules: ['subscriptions'],
    turns: ["Pause Lily Ito's subscription."],
    expect: {
      actions: ['subscriptions.pause'],
      state: [['paused', (h) => h.get('subscriptions', 'sub_0003').status === 'paused']],
    },
  },
  {
    id: 'D31-coupons-create',
    category: 'direct',
    modules: ['coupons'],
    turns: ['Create a coupon code BLACKFRIDAY30 for 30% off.'],
    expect: {
      actions: ['coupons.create'],
      state: [
        [
          'coupon exists',
          (h) =>
            h.created('coupons', (x) => x.code === 'BLACKFRIDAY30' && x.type === 'percent' && x.value === 30)
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D32-orders-fulfill',
    category: 'direct',
    modules: ['orders'],
    turns: ["Mark Ryan Patel's order as fulfilled — tracking number 1Z12345."],
    expect: {
      actions: ['orders.mark_fulfilled'],
      state: [
        [
          'fulfilled',
          (h) => {
            const o = h.get('orders', 'ord_0002');
            return o.status === 'fulfilled' && o.trackingNumber === '1Z12345';
          },
        ],
      ],
    },
  },
  {
    id: 'D33-refunds-approve',
    category: 'direct',
    modules: ['refunds'],
    turns: ["Approve Julian Ortiz's pending refund request."],
    expect: {
      actions: ['refunds.approve'],
      state: [['approved', (h) => h.get('refunds', 'ref_0001').status === 'approved']],
    },
  },
  {
    id: 'D34-tax-rate',
    category: 'direct',
    modules: ['tax_rules'],
    turns: ['Change the New York sales tax rate to 8.5%.'],
    expect: {
      actions: ['tax_rules.set_rate'],
      state: [['rate 8.5', (h) => h.get('tax_rules', 'tax_0003').rate === 8.5]],
    },
  },
  {
    id: 'D35-websites-page',
    category: 'direct',
    modules: ['websites'],
    turns: ['Add a Careers page to the Northwind Main Site.'],
    expect: {
      actions: ['websites.add_page'],
      state: [
        ['page added', (h) => h.get('websites', 'site_0001').pages.some((p) => /careers/i.test(p.title))],
      ],
    },
  },
  {
    id: 'D36-funnels-metrics',
    category: 'direct',
    modules: ['funnels'],
    turns: ["What's the overall conversion rate of the Fall Promo Funnel?"],
    expect: { actions: ['funnels.conversion_metrics'], noWrites: true, reply: /1\.3\s?%|1\.28/ },
  },
  {
    id: 'D37-landing-unpublish',
    category: 'direct',
    modules: ['landing_pages'],
    turns: ['Unpublish the Thank You landing page.'],
    expect: {
      actions: ['landing_pages.unpublish'],
      state: [['unpublished', (h) => h.get('landing_pages', 'lp_0003').published === false]],
    },
  },
  {
    id: 'D38-blogs-schedule',
    category: 'direct',
    modules: ['blogs'],
    turns: ["Schedule the 'Fall product update' blog post for October 20 at 9am UTC."],
    expect: {
      actions: ['blogs.schedule'],
      state: [
        [
          'scheduled',
          (h) => {
            const p = h.get('blog_posts', 'post_0003');
            return p.status === 'scheduled' && p.publishAt.startsWith('2026-10-20T09:00');
          },
        ],
      ],
    },
  },
  {
    id: 'D39-media-alt',
    category: 'direct',
    modules: ['media'],
    turns: ["Set the alt text of logo.png to 'Northwind company logo'."],
    expect: {
      actions: ['media.set_alt_text'],
      state: [['alt text', (h) => h.get('media_assets', 'asset_0002').altText === 'Northwind company logo']],
    },
  },
  {
    id: 'D40-courses-section',
    category: 'direct',
    modules: ['courses'],
    turns: ["Add a 'Reporting' section to the CRM Fundamentals course."],
    expect: {
      actions: ['courses.add_section'],
      state: [
        ['section added', (h) => h.get('courses', 'crs_0001').sections.some((s) => s.title === 'Reporting')],
      ],
    },
  },
  {
    id: 'D41-lessons-publish',
    category: 'direct',
    modules: ['lessons'],
    turns: ["Publish the 'Branching logic' lesson."],
    expect: {
      actions: ['lessons.publish'],
      state: [['published', (h) => h.get('lessons', 'les_0007').published === true]],
    },
  },
  {
    id: 'D42-enrollments-enroll',
    category: 'direct',
    modules: ['enrollments', 'courses'],
    turns: ['Enroll Sarah Johnson in the CRM Fundamentals course.'],
    expect: {
      actions: ['enrollments.enroll'],
      state: [
        [
          'enrolled',
          (h) =>
            h.created('enrollments', (e) => e.contactId === 'con_0061' && e.courseId === 'crs_0001')
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D43-communities-remove',
    category: 'direct',
    modules: ['communities'],
    turns: ['Remove the reported spam post from the customer community.'],
    expect: {
      actions: ['communities.remove_reported_post'],
      state: [
        ['removed', (h) => h.get('community_posts', 'cpost_0003').status === 'removed'],
        ['others intact', (h) => h.find('community_posts', (p) => p.status === 'removed').length === 1],
      ],
    },
  },
  {
    id: 'D44-memberships-grant',
    category: 'direct',
    modules: ['memberships'],
    turns: ['Give Sarah Miller the Pro Learning membership.'],
    expect: {
      actions: ['memberships.grant'],
      state: [
        [
          'granted',
          (h) =>
            h.created(
              'memberships',
              (m) => m.contactId === 'con_0062' && m.planId === 'plan_0001' && m.status === 'active',
            ).length === 1,
        ],
      ],
    },
  },
  {
    id: 'D45-reviews-draft-response',
    category: 'direct',
    modules: ['reviews'],
    turns: ["Draft a reply to James Kaur's 1-star Google review — apologize and offer a call."],
    expect: {
      actions: ['reviews.draft_response'],
      forbid: ['reviews.publish_response'],
      state: [['draft response', (h) => h.get('reviews', 'rev_0008').response?.status === 'draft']],
    },
  },
  {
    id: 'D46-listings-name',
    category: 'direct',
    modules: ['listings'],
    turns: ["Rename our Yelp listing to 'Northwind CRM'."],
    expect: {
      actions: ['listings.update_name'],
      state: [['renamed', (h) => h.get('listings', 'lst_0002').name === 'Northwind CRM']],
    },
  },
  {
    id: 'D47-tickets-assign',
    category: 'direct',
    modules: ['tickets', 'users'],
    turns: ["Assign the urgent 'Cannot log in' ticket to Grace Chen."],
    expect: {
      actions: ['tickets.assign_owner'],
      state: [
        ['assigned', (h) => h.get('tickets', 'tkt_0001').ownerId === 'usr_0008'],
        ['medium one untouched', (h) => h.unchanged('tickets', 'tkt_0007')],
      ],
    },
  },
  {
    id: 'D48-users-invite',
    category: 'direct',
    modules: ['users'],
    turns: ['Invite Jordan Blake (jordan@northwind.example) as a marketing user.'],
    expect: {
      actions: ['users.invite'],
      state: [
        [
          'invited',
          (h) =>
            h.created('users', (u) => u.email === 'jordan@northwind.example' && u.roles.includes('marketing'))
              .length === 1,
        ],
      ],
    },
  },
  {
    id: 'D49-teams-manager',
    category: 'direct',
    modules: ['teams', 'users'],
    turns: ['Make Priya Shah the manager of the Sales team.'],
    expect: {
      actions: ['teams.assign_manager'],
      state: [['manager set', (h) => h.get('teams', 'team_0001').managerId === 'usr_0002']],
    },
  },
  {
    id: 'D50-reports-leads-by-source',
    category: 'direct',
    modules: ['reports', 'leads'],
    turns: ['How many new leads did we get in the last 7 days, broken down by source?'],
    expect: {
      actions: [['reports.run', 'leads.search']],
      noWrites: true,
      state: [
        [
          'reply has total',
          (h) =>
            h.mentionsNumber(
              h.seedFind(
                'leads',
                (l) => l.createdAt >= h.cal.last7Days.from && l.createdAt < h.cal.last7Days.to,
              ).length,
            ),
        ],
      ],
    },
  },
];
