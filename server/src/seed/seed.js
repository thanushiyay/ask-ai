// Deterministic seed data, including planted edge cases the scenarios rely on.
import { Store } from '../core/store.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'James',
  'Olivia',
  'Liam',
  'Emma',
  'Noah',
  'Ava',
  'Ethan',
  'Mia',
  'Lucas',
  'Isabella',
  'Mason',
  'Sophia',
  'Logan',
  'Amelia',
  'Aiden',
  'Harper',
  'Carter',
  'Evelyn',
  'Jackson',
  'Abigail',
  'Leo',
  'Ella',
  'Wyatt',
  'Scarlett',
  'Henry',
  'Chloe',
  'Owen',
  'Zoe',
  'Caleb',
  'Lily',
  'Ryan',
  'Nora',
  'Isaac',
  'Riley',
  'Julian',
  'Layla',
  'Aaron',
  'Grace',
  'Adrian',
  'Aria',
  'Rohan',
  'Ananya',
  'Kenji',
  'Yuki',
  'Mateo',
  'Lucia',
  'Felix',
  'Freya',
  'Hugo',
  'Clara',
  'Ivan',
  'Maya',
  'Jonah',
  'Ruby',
  'Theo',
  'Iris',
  'Victor',
  'Alice',
  'Samir',
  'Leila',
];
const LAST = [
  'Smith',
  'Garcia',
  'Patel',
  'Nguyen',
  'Kowalski',
  'Okafor',
  'Silva',
  'Muller',
  'Tanaka',
  'Rossi',
  'Dubois',
  'Novak',
  'Larsen',
  'Cohen',
  'Reyes',
  'Walsh',
  'Fischer',
  'Ibrahim',
  'Costa',
  'Moreau',
  'Jensen',
  'Kaur',
  'Ito',
  'Hughes',
  'Bennett',
  'Ward',
  'Price',
  'Foster',
  'Hayes',
  'Ortiz',
];
const COMPANIES = [
  'Acme Corp',
  'Globex',
  'Initech',
  'Umbrella Health',
  'Stark Logistics',
  'Wayne Fitness',
  'Hooli',
  'Vandelay Imports',
  'Pied Piper',
  'Soylent Foods',
  'Wonka Sweets',
  'Cyberdyne Labs',
  'Tyrell Design',
  'Gringotts Finance',
  'Oceanic Travel',
];
const INDUSTRIES = [
  'software',
  'healthcare',
  'logistics',
  'fitness',
  'retail',
  'finance',
  'food',
  'travel',
  'manufacturing',
];
const SOURCES = ['facebook', 'google_ads', 'website', 'referral', 'webinar'];

export function buildSeed(clock, seed = 42) {
  const rnd = mulberry32(seed);
  const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p) => rnd() < p;
  const db = new Store(clock);
  const ago = (days, hour = 10) => {
    const d = clock.addDays(clock.startOfDay(clock.now()), -days);
    d.setUTCHours(hour, int(0, 59));
    // Something that "already happened" today cannot be later than now.
    if (days >= 0 && d > clock.now()) {
      const earlier = Math.max(clock.now().getTime() - 15 * 60_000, clock.startOfDay(clock.now()).getTime());
      return new Date(earlier).toISOString();
    }
    return d.toISOString();
  };
  const ahead = (days, hour = 10) => ago(-days, hour);
  const sod = clock.startOfDay(clock.now());
  const weekStart = clock.startOfWeek(clock.now()); // Monday of this week
  const daysSinceMonday = clock.daysBetween(weekStart, sod); // 3 when now is Thursday
  const ins = (col, rec) => db.insert(col, rec, 'seed');

  const userSpecs = [
    ['Alex Morgan', 'admin'],
    ['Priya Shah', 'sales_rep'],
    ['Marcus Lee', 'sales_rep'],
    ['Elena Rossi', 'sales_rep'],
    ['Diego Alvarez', 'sales_rep', 'deactivated'],
    ['Hannah Kim', 'sales_rep'],
    ['Omar Haddad', 'sales_rep'],
    ['Grace Chen', 'support'],
    ['Tom Becker', 'support'],
    ['Nina Patel', 'marketing'],
    ['Sam Rivera', 'instructor'],
  ];
  const users = userSpecs.map(([name, role, status = 'active']) =>
    ins('users', {
      name,
      email: `${name.split(' ')[0].toLowerCase()}@northwind.example`,
      role,
      roles: [role],
      status,
      title: {
        admin: 'Head of Revenue',
        sales_rep: 'Account Executive',
        support: 'Support Specialist',
        marketing: 'Marketing Manager',
        instructor: 'Instructor',
      }[role],
      timezone: 'UTC',
      createdAt: ago(400),
      auditTrail: [
        { at: ago(1, 8), op: 'login', collection: 'session', id: 'web' },
        { at: ago(3, 9), op: 'login', collection: 'session', id: 'mobile' },
      ],
    }),
  );
  const U = Object.fromEntries(users.map((u) => [u.name.split(' ')[0].toLowerCase(), u]));
  const reps = users.filter((u) => u.role === 'sales_rep');
  const activeReps = reps.filter((u) => u.status === 'active');

  ins('teams', {
    name: 'Sales',
    memberIds: reps.map((u) => u.id),
    managerId: U.alex.id,
    assignmentStrategy: 'round_robin',
    status: 'active',
    createdAt: ago(380),
  });
  ins('teams', {
    name: 'Support',
    memberIds: [U.grace.id, U.tom.id],
    managerId: U.grace.id,
    assignmentStrategy: 'least_busy',
    status: 'active',
    createdAt: ago(380),
  });
  ins('teams', {
    name: 'Marketing',
    memberIds: [U.nina.id],
    managerId: U.nina.id,
    assignmentStrategy: 'round_robin',
    status: 'active',
    createdAt: ago(300),
  });

  for (const u of users) {
    ins('availability', {
      id: `avl_${u.id}`,
      userId: u.id,
      weeklyHours: Object.fromEntries(
        ['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, [{ start: '09:00', end: '17:00' }]]),
      ),
      dateOverrides: [],
      blocks: [],
      minNoticeHours: 4,
      maxHorizonDays: 60,
      createdAt: ago(380),
    });
  }
  // Hannah is out of office this week, so she must never receive assignments.
  db.get('availability', `avl_${U.hannah.id}`).blocks.push({
    id: 'blk_0001',
    start: weekStart.toISOString(),
    end: clock.addDays(weekStart, 7).toISOString(),
    reason: 'Out of office',
  });

  for (const [name, color] of [
    ['vip', '#7c3aed'],
    ['newsletter', '#0ea5e9'],
    ['hot-lead', '#ef4444'],
    ['partner', '#10b981'],
    ['churn-risk', '#f59e0b'],
    ['webinar-2026', '#6366f1'],
    ['legacy-import', '#94a3b8'],
  ]) {
    ins('tags', { name, color, createdAt: ago(300) });
  }
  const companies = COMPANIES.map((name, i) =>
    ins('companies', {
      name,
      domain: `${name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
      industry: INDUSTRIES[i % INDUSTRIES.length],
      size: pickOne(['1-10', '11-50', '51-200', '201-1000']),
      accountManagerId: pickOne(activeReps).id,
      status: 'active',
      tags: [],
      createdAt: ago(int(100, 300)),
    }),
  );
  // Planted duplicate company.
  ins('companies', {
    name: 'Acme Corporation',
    domain: 'acmecorp.example',
    industry: 'software',
    size: '51-200',
    accountManagerId: U.priya.id,
    status: 'active',
    tags: [],
    createdAt: ago(20),
  });

  ins('custom_fields', {
    module: 'contacts',
    key: 'industry',
    label: 'Industry',
    type: 'dropdown',
    options: INDUSTRIES.map((v) => ({ value: v, retired: false })),
    helpText: '',
    validation: {},
    status: 'active',
    createdAt: ago(200),
  });
  ins('custom_fields', {
    module: 'contacts',
    key: 'budget',
    label: 'Annual budget',
    type: 'number',
    options: [],
    helpText: 'In USD',
    validation: { min: 0 },
    status: 'active',
    createdAt: ago(200),
  });
  ins('custom_fields', {
    module: 'leads',
    key: 'timeline',
    label: 'Purchase timeline',
    type: 'dropdown',
    options: ['this_month', 'this_quarter', 'next_year'].map((v) => ({ value: v, retired: false })),
    helpText: '',
    validation: {},
    status: 'active',
    createdAt: ago(150),
  });
  ins('custom_fields', {
    module: 'opportunities',
    key: 'competitor',
    label: 'Main competitor',
    type: 'text',
    options: [],
    helpText: '',
    validation: {},
    status: 'active',
    createdAt: ago(150),
  });

  const contacts = [];
  const mkContact = (firstName, lastName, extra = {}) => {
    const c = ins('contacts', {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      email:
        `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '') +
        `@${pickOne(['gmail.example', 'mail.example', 'outlook.example'])}`,
      phone: `+1415555${String(1000 + contacts.length).slice(-4)}`,
      companyId: chance(0.6) ? pickOne(companies).id : null,
      ownerId: chance(0.7) ? pickOne(activeReps).id : null,
      tags: chance(0.3) ? [pickOne(['vip', 'newsletter', 'partner', 'churn-risk'])] : [],
      status: 'active',
      source: pickOne(SOURCES),
      commPrefs: { email: 'subscribed', sms: 'opted_in', preferredChannel: 'email', doNotContact: false },
      relationships: [],
      customFields: {},
      taxExempt: false,
      createdAt: ago(int(30, 400)),
      ...extra,
    });
    contacts.push(c);
    return c;
  };
  const used = new Set();
  while (contacts.length < 60) {
    const f = pickOne(FIRST);
    const l = pickOne(LAST);
    if (used.has(f + l)) continue;
    used.add(f + l);
    mkContact(f, l);
  }
  // Planted contacts: two Sarahs, SMS opt-out, unsubscribed email.
  const sarahJ = mkContact('Sarah', 'Johnson', { email: 'sarah.johnson@brightpath.example', tags: ['vip'] });
  const sarahM = mkContact('Sarah', 'Miller', { email: 'sarah.miller@mail.example' });
  const dup1 = mkContact('Michael', 'Brown', { email: 'michael.brown@mail.example', createdAt: ago(200) });
  const dup2 = mkContact('Mike', 'Brown', {
    email: 'michael.brown@mail.example',
    phone: '+14155559911',
    createdAt: ago(15),
  });
  const optOut = mkContact('Laura', 'Chen', {
    commPrefs: { email: 'subscribed', sms: 'opted_out', preferredChannel: 'sms', doNotContact: false },
  });
  const unsub = mkContact('Peter', 'Novak', {
    commPrefs: { email: 'unsubscribed', sms: 'opted_in', preferredChannel: 'email', doNotContact: false },
  });
  const noPhone = mkContact('Quinn', 'Harper', { phone: null });
  contacts.slice(0, 6).forEach((c) => (c.tags = [...new Set([...c.tags, 'newsletter'])]));
  sarahJ.companyId = companies[0].id;
  void [dup1, dup2, optOut, unsub, noPhone, sarahM];

  const fbCampaign = ins('campaigns', {
    name: 'Facebook Fall Promo',
    channel: 'email',
    sourceChannel: 'facebook',
    audience: { type: 'tag', value: 'hot-lead' },
    steps: [{ id: 'cstep_0001', channel: 'email', templateId: null, delayDays: 0, subject: 'Fall offer' }],
    schedule: { startAt: ago(30), timezone: 'UTC' },
    status: 'active',
    stats: { sent: 420, delivered: 410, opened: 168, clicked: 51, replied: 12, conversions: 9 },
    createdAt: ago(35),
  });
  const googleCampaign = ins('campaigns', {
    name: 'Google Search Q4',
    channel: 'email',
    sourceChannel: 'google_ads',
    audience: { type: 'tag', value: 'newsletter' },
    steps: [],
    schedule: { startAt: ago(20), timezone: 'UTC' },
    status: 'active',
    stats: { sent: 260, delivered: 255, opened: 90, clicked: 30, replied: 6, conversions: 4 },
    createdAt: ago(25),
  });
  const webinarCampaign = ins('campaigns', {
    name: 'Webinar Nurture',
    channel: 'email',
    sourceChannel: 'webinar',
    audience: { type: 'tag', value: 'webinar-2026' },
    steps: [
      { id: 'cstep_0002', channel: 'email', templateId: null, delayDays: 2, subject: 'Thanks for joining' },
    ],
    schedule: { startAt: ago(60), timezone: 'UTC' },
    status: 'paused',
    stats: { sent: 150, delivered: 149, opened: 70, clicked: 22, replied: 3, conversions: 2 },
    createdAt: ago(65),
  });
  ins('campaigns', {
    name: 'October Newsletter',
    channel: 'email',
    sourceChannel: null,
    audience: null,
    steps: [],
    schedule: null,
    status: 'draft',
    stats: { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, conversions: 0 },
    createdAt: ago(5),
  });
  const campaignFor = { facebook: fbCampaign.id, google_ads: googleCampaign.id, webinar: webinarCampaign.id };

  const leads = [];
  const mkLead = (createdDaysAgo, overrides = {}) => {
    let f, l;
    do {
      f = pickOne(FIRST);
      l = pickOne(LAST);
    } while (used.has(f + l));
    used.add(f + l);
    const source = overrides.source ?? pickOne(SOURCES);
    const createdAt = overrides.createdAt ?? ago(createdDaysAgo, int(8, 18));
    const c = mkContact(f, l, {
      source,
      createdAt,
      ownerId: null,
      tags: source === 'webinar' ? ['webinar-2026'] : [],
    });
    const lead = ins('leads', {
      contactId: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      source,
      campaignId: campaignFor[source] ?? null,
      status: 'new',
      ownerId: null,
      score: int(10, 60),
      qualification: {},
      disqualifyReason: null,
      opportunityId: null,
      createdAt,
      ...overrides,
    });
    leads.push({ lead, contact: c });
    return { lead, contact: c };
  };
  // 14 leads from last week (Mon–Sun) with a deliberate source mix.
  const lastWeekSources = [
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'facebook',
    'google_ads',
    'google_ads',
    'website',
    'website',
    'referral',
    'facebook',
    'webinar',
    'google_ads',
    'facebook',
  ];
  const lastWeek = lastWeekSources.map((src, i) => mkLead(daysSinceMonday + 7 - (i % 7), { source: src }));
  const thisWeek = ['facebook', 'website', 'google_ads', 'facebook', 'referral', 'website'].map((src, i) =>
    mkLead(Math.min(i % 3, daysSinceMonday), { source: src }),
  );
  for (let i = 0; i < 20; i++) {
    const st = pickOne(['contacted', 'qualified', 'new', 'disqualified', 'contacted']);
    mkLead(int(16, 90), {
      status: st,
      ownerId: pickOne(activeReps).id,
      score: int(20, 95),
      disqualifyReason: st === 'disqualified' ? 'No budget' : null,
    });
  }
  for (const { lead, contact } of leads) if (lead.ownerId) contact.ownerId = lead.ownerId;
  [lastWeek[3], thisWeek[2]].forEach(({ lead, contact }) => {
    lead.ownerId = U.marcus.id;
    contact.ownerId = U.marcus.id;
    lead.status = 'contacted';
  });

  const salesCal = ins('calendars', {
    name: 'Discovery Call',
    description: '30 min intro call with sales',
    timezone: 'UTC',
    hostIds: activeReps.map((u) => u.id),
    durationMinutes: 30,
    bufferMinutes: 10,
    visibility: 'public',
    status: 'active',
    createdAt: ago(300),
  });
  const demoCal = ins('calendars', {
    name: 'Product Demo',
    description: '60 min tailored demo',
    timezone: 'UTC',
    hostIds: [U.priya.id, U.elena.id],
    durationMinutes: 60,
    bufferMinutes: 15,
    visibility: 'public',
    status: 'active',
    createdAt: ago(300),
  });
  const onboardCal = ins('calendars', {
    name: 'Customer Onboarding',
    description: 'Kickoff with support',
    timezone: 'UTC',
    hostIds: [U.grace.id, U.tom.id],
    durationMinutes: 45,
    bufferMinutes: 0,
    visibility: 'internal',
    status: 'active',
    createdAt: ago(250),
  });
  const mkAppt = (contact, calendar, startIso, status = 'booked', hostId = pickOne(calendar.hostIds)) => {
    const end = new Date(new Date(startIso).getTime() + calendar.durationMinutes * 60000).toISOString();
    return ins('appointments', {
      calendarId: calendar.id,
      contactId: contact.id,
      hostId,
      title: `${calendar.name} with ${contact.name}`,
      startAt: startIso,
      endAt: end,
      status,
      attendees: [{ contactId: contact.id, status: status === 'no_show' ? 'no_show' : 'confirmed' }],
      notes: '',
      createdAt: ago(3),
    });
  };
  // Last-week leads 1, 4, 7 and 10 are booked; 12 had a booking that was cancelled.
  [1, 4, 7, 10].forEach((i, k) => mkAppt(lastWeek[i].contact, k % 2 ? demoCal : salesCal, ahead(k + 1, 14)));
  mkAppt(lastWeek[12].contact, salesCal, ahead(2, 11), 'cancelled');
  mkAppt(thisWeek[0].contact, salesCal, ahead(1, 15));
  for (let i = 0; i < 14; i++) {
    const c = contacts[i * 3];
    const past = i < 8;
    mkAppt(
      c,
      pickOne([salesCal, demoCal, onboardCal]),
      past ? ago(int(1, 20), int(9, 16)) : ahead(int(1, 14), int(9, 16)),
      past ? pickOne(['completed', 'completed', 'no_show', 'cancelled']) : 'booked',
    );
  }
  mkAppt(sarahJ, demoCal, ahead(1, 9)); // Sarah Johnson has a demo tomorrow 09:00

  const mkConv = (contact, messages, extra = {}) => {
    const msgs = messages.map(([direction, body, at], i) => ({
      id: `msg_${contact.id.split('_')[1]}${i}`,
      direction,
      body,
      at,
      channel: extra.channel ?? 'email',
    }));
    const last = msgs.at(-1);
    const lastIn = msgs.filter((m) => m.direction === 'inbound').at(-1);
    return ins('conversations', {
      contactId: contact.id,
      channel: extra.channel ?? 'email',
      status: extra.status ?? 'open',
      ownerId: extra.ownerId ?? contact.ownerId ?? null,
      unread: last?.direction === 'inbound',
      messages: msgs,
      comments: [],
      lastMessageAt: last?.at ?? null,
      lastInboundAt: lastIn?.at ?? null,
      lastOutboundAt: msgs.filter((m) => m.direction === 'outbound').at(-1)?.at ?? null,
      hasInbound: Boolean(lastIn),
      awaitingReply: last?.direction === 'inbound',
      subject: extra.subject ?? `Conversation with ${contact.name}`,
      createdAt: msgs[0]?.at ?? ago(5),
    });
  };
  lastWeek.forEach(({ contact }, i) => {
    const intro = [
      'outbound',
      `Hi ${contact.firstName}, thanks for your interest! Want to set up a quick call?`,
      ago(daysSinceMonday + 6 - (i % 7) + 0, 16),
    ];
    if ([0, 4, 6, 9, 13].includes(i))
      mkConv(contact, [
        intro,
        ['inbound', 'Thanks! Can you send pricing details?', ago(daysSinceMonday + 2, 9)],
      ]); // replied
    else if (i % 4 !== 3) mkConv(contact, [intro]); // never replied
    // Leads 3, 7 and 11 have no conversation at all, so they also never replied.
  });
  thisWeek.forEach(({ contact }, i) => {
    if (i % 2 === 0) mkConv(contact, [['outbound', `Welcome ${contact.firstName}!`, ago(0, 8)]]);
  });
  for (let i = 0; i < 12; i++) {
    const c = contacts[i * 4 + 1];
    const msgs = [
      [
        'inbound',
        pickOne([
          'Can I change my plan?',
          'Invoice question',
          'Loving the product!',
          'How do I reset my password?',
          'Is there a discount for annual billing?',
        ]),
        ago(int(1, 12), int(8, 18)),
      ],
    ];
    if (i % 3 === 0) msgs.push(['outbound', 'Happy to help — details below.', ago(0, 9)]);
    mkConv(c, msgs, {
      channel: i % 2 ? 'sms' : 'email',
      status: i === 11 ? 'closed' : 'open',
      ownerId: pickOne([U.grace.id, U.tom.id, null]),
    });
  }
  mkConv(sarahJ, [['inbound', 'Looking forward to the demo tomorrow.', ago(1, 13)]]);

  const stage = (name, order, p) => ({
    id: `stg_${name.toLowerCase().replace(/\W/g, '')}`,
    name,
    order,
    winProbability: p,
  });
  const salesPipe = ins('pipelines', {
    name: 'Sales Pipeline',
    stages: [
      stage('New', 1, 10),
      stage('Qualified', 2, 30),
      stage('Proposal', 3, 55),
      stage('Negotiation', 4, 75),
    ],
    status: 'active',
    createdAt: ago(400),
  });
  const partnerPipe = ins('pipelines', {
    name: 'Partnerships',
    stages: [
      { id: 'stg_p_intro', name: 'Intro', order: 1, winProbability: 15 },
      { id: 'stg_p_pilot', name: 'Pilot', order: 2, winProbability: 50 },
      { id: 'stg_p_legal', name: 'Legal Review', order: 3, winProbability: 80 },
    ],
    status: 'active',
    createdAt: ago(200),
  });
  for (let i = 0; i < 24; i++) {
    const c = contacts[(i * 7) % 60];
    const st = salesPipe.stages[i % 4];
    const status = i < 18 ? 'open' : i < 21 ? 'won' : 'lost';
    ins('opportunities', {
      name: `${c.lastName} — ${pickOne(['Starter', 'Growth', 'Enterprise'])} plan`,
      contactId: c.id,
      companyId: c.companyId,
      pipelineId: salesPipe.id,
      stageId: st.id,
      value: int(5, 120) * 100,
      currency: 'USD',
      ownerId: c.ownerId ?? pickOne(activeReps).id,
      status,
      expectedCloseDate: clock.date(
        clock.daysFromNow(((d) => (i === 3 ? -6 : i === 7 ? -12 : d))(int(1, 60))),
      ),
      lostReason: status === 'lost' ? 'Chose competitor' : null,
      closedAt: status === 'open' ? null : ago(int(1, 30)),
      createdAt: ago(int(10, 120)),
    });
  }
  ins('opportunities', {
    name: 'Globex reseller pilot',
    contactId: contacts[2].id,
    companyId: companies[1].id,
    pipelineId: partnerPipe.id,
    stageId: 'stg_p_pilot',
    value: 25000,
    currency: 'USD',
    ownerId: U.priya.id,
    status: 'open',
    expectedCloseDate: clock.date(clock.daysFromNow(30)),
    lostReason: null,
    closedAt: null,
    createdAt: ago(40),
  });
  ins('opportunities', {
    name: 'Johnson — Enterprise plan',
    contactId: sarahJ.id,
    companyId: sarahJ.companyId,
    pipelineId: salesPipe.id,
    stageId: 'stg_proposal',
    value: 18000,
    currency: 'USD',
    ownerId: U.priya.id,
    status: 'open',
    expectedCloseDate: clock.date(clock.daysFromNow(21)),
    lostReason: null,
    closedAt: null,
    createdAt: ago(25),
  });

  const taskTitles = [
    'Call back about pricing',
    'Send proposal',
    'Prepare demo deck',
    'Check in after onboarding',
    'Renewal conversation',
    'Update CRM notes',
    'Collect testimonial',
    'Schedule QBR',
  ];
  for (let i = 0; i < 26; i++) {
    const c = contacts[(i * 5) % 60];
    const status = i < 18 ? 'open' : i < 24 ? 'completed' : 'cancelled';
    ins('tasks', {
      title: `${pickOne(taskTitles)} — ${c.name}`,
      description: '',
      contactId: c.id,
      relatedTo: null,
      ownerId: pickOne([...activeReps, U.grace]).id,
      dueDate: ago(int(-10, 10), 17),
      priority: pickOne(['low', 'medium', 'medium', 'high']),
      status,
      type: 'general',
      completedAt: status === 'completed' ? ago(int(1, 5)) : null,
      createdAt: ago(int(10, 40)),
    });
  }
  // Existing follow-up for a last-week lead; agents must not duplicate it.
  ins('tasks', {
    title: `Follow up with ${lastWeek[2].contact.name}`,
    description: 'New lead follow-up',
    contactId: lastWeek[2].contact.id,
    relatedTo: { type: 'lead', id: lastWeek[2].lead.id },
    ownerId: U.elena.id,
    dueDate: ahead(1, 17),
    priority: 'medium',
    status: 'open',
    type: 'follow_up',
    completedAt: null,
    createdAt: ago(2),
  });

  for (let i = 0; i < 14; i++) {
    const c = contacts[(i * 3 + 2) % 60];
    ins('notes', {
      body: pickOne([
        'Prefers email over calls.',
        'Budget approved for Q1.',
        'Asked about API access.',
        'Decision maker is the CFO.',
        'Interested in annual billing.',
      ]),
      recordRefs: [{ type: 'contact', id: c.id }],
      pinned: i < 2,
      revisions: [],
      authorId: pickOne(users).id,
      status: 'active',
      createdAt: ago(int(1, 60)),
    });
  }
  ins('notes', {
    body: 'Sarah wants SSO in the enterprise plan.',
    recordRefs: [{ type: 'contact', id: sarahJ.id }],
    pinned: true,
    revisions: [],
    authorId: U.priya.id,
    status: 'active',
    createdAt: ago(4),
  });

  ins('smart_lists', {
    name: 'VIP customers',
    module: 'contacts',
    rules: [{ field: 'tags', op: 'contains', value: 'vip' }],
    status: 'active',
    createdAt: ago(100),
  });
  ins('smart_lists', {
    name: 'Facebook leads',
    module: 'leads',
    rules: [{ field: 'source', op: 'eq', value: 'facebook' }],
    status: 'active',
    createdAt: ago(40),
  });
  ins('smart_lists', {
    name: 'Unassigned new leads',
    module: 'leads',
    rules: [
      { field: 'status', op: 'eq', value: 'new' },
      { field: 'ownerId', op: 'exists', value: false },
    ],
    status: 'active',
    createdAt: ago(30),
  });

  const tpl = (name, channel, subject, body, variables) =>
    ins('templates', {
      name,
      channel,
      subject,
      body,
      variables,
      versions: [{ version: 1, subject, body, at: ago(90) }],
      version: 1,
      status: 'active',
      createdAt: ago(90),
    });
  const reminderTpl = tpl(
    'Invoice payment reminder',
    'email',
    'Reminder: invoice {{invoice_number}} is overdue',
    'Hi {{first_name}}, invoice {{invoice_number}} for {{amount_due}} was due on {{due_date}}. You can pay online at any time. Thank you!',
    ['first_name', 'invoice_number', 'amount_due', 'due_date'],
  );
  tpl(
    'New lead follow-up',
    'email',
    'Great to meet you, {{first_name}}',
    'Hi {{first_name}}, following up on your interest — do you have 15 minutes this week?',
    ['first_name'],
  );
  tpl('Welcome SMS', 'sms', null, 'Hi {{first_name}}, welcome to Northwind! Reply STOP to opt out.', [
    'first_name',
  ]);
  tpl(
    'Review request',
    'email',
    'How did we do, {{first_name}}?',
    'Hi {{first_name}}, would you leave us a quick review? {{review_link}}',
    ['first_name', 'review_link'],
  );
  tpl('Appointment reminder', 'sms', null, 'Reminder: {{appointment_title}} at {{appointment_time}}.', [
    'appointment_title',
    'appointment_time',
  ]);
  tpl('Legacy promo', 'email', 'Old promo', 'Retired content', []).status = 'archived';

  const productSpecs = [
    ['Starter Plan', 'SUB-START', 'software', 49],
    ['Growth Plan', 'SUB-GROW', 'software', 149],
    ['Enterprise Plan', 'SUB-ENT', 'software', 499],
    ['Onboarding Package', 'SRV-ONB', 'services', 900],
    ['Strategy Workshop', 'SRV-WKS', 'services', 1500],
    ['Branded Hoodie', 'MER-HOOD', 'physical', 45],
    ['Water Bottle', 'MER-BOTL', 'physical', 18],
    ['Legacy Add-on', 'OLD-ADD', 'software', 10],
  ];
  const products = productSpecs.map(([name, sku, category, base], i) =>
    ins('products', {
      name,
      description: `${name} for growing teams`,
      sku,
      category,
      variants:
        category === 'physical'
          ? [
              { id: `var_${sku}_s`, name: 'Small', sku: `${sku}-S`, inventory: 12 },
              { id: `var_${sku}_l`, name: 'Large', sku: `${sku}-L`, inventory: 0 },
            ]
          : [],
      inventory: category === 'physical' ? int(0, 40) : null,
      trackInventory: category === 'physical',
      basePrice: base,
      status: i === 7 ? 'archived' : 'active',
      createdAt: ago(300),
    }),
  );
  const prices = [];
  products.slice(0, 7).forEach((p) => {
    if (p.category === 'software') {
      prices.push(
        ins('prices', {
          productId: p.id,
          label: 'Monthly',
          amount: p.basePrice,
          currency: 'USD',
          interval: 'month',
          trialDays: 14,
          isDefault: true,
          status: 'active',
          createdAt: ago(300),
        }),
      );
      prices.push(
        ins('prices', {
          productId: p.id,
          label: 'Annual',
          amount: p.basePrice * 10,
          currency: 'USD',
          interval: 'year',
          trialDays: 14,
          isDefault: false,
          status: 'active',
          createdAt: ago(300),
        }),
      );
    } else
      prices.push(
        ins('prices', {
          productId: p.id,
          label: 'One-time',
          amount: p.basePrice,
          currency: 'USD',
          interval: 'one_time',
          trialDays: 0,
          isDefault: true,
          status: 'active',
          createdAt: ago(300),
        }),
      );
  });
  ins('tax_rules', {
    name: 'California sales tax',
    rate: 7.25,
    region: 'US-CA',
    productCategories: ['physical'],
    inclusive: false,
    status: 'active',
    createdAt: ago(300),
  });
  ins('tax_rules', {
    name: 'EU VAT standard',
    rate: 20,
    region: 'EU',
    productCategories: ['software', 'services', 'physical'],
    inclusive: true,
    status: 'active',
    createdAt: ago(300),
  });
  ins('tax_rules', {
    name: 'New York sales tax',
    rate: 8.875,
    region: 'US-NY',
    productCategories: ['physical', 'services'],
    inclusive: false,
    status: 'active',
    createdAt: ago(300),
  });

  let invNo = 1040;
  const line = (p, qty = 1) => ({
    id: `li_${p.sku}_${qty}_${int(100, 999)}`,
    productId: p.id,
    description: p.name,
    quantity: qty,
    unitPrice: p.basePrice,
  });
  const total = (items) => Math.round(items.reduce((a, l) => a + l.quantity * l.unitPrice, 0) * 100) / 100;
  const invoices = [];
  const mkInvoice = (contact, { status, dueDaysAgo, paid = 0, items }) => {
    const lineItems = items ?? [line(pickOne(products.slice(0, 5)), int(1, 3))];
    const t = total(lineItems);
    const amountPaid = status === 'paid' ? t : Math.min(paid, t);
    const inv = ins('invoices', {
      number: `INV-${++invNo}`,
      contactId: contact.id,
      lineItems,
      currency: 'USD',
      subtotal: t,
      tax: 0,
      total: t,
      amountPaid,
      balance: Math.round((t - amountPaid) * 100) / 100,
      status,
      issuedAt: status === 'draft' ? null : ago(dueDaysAgo + 30),
      dueDate: status === 'draft' ? null : ago(dueDaysAgo, 23),
      remindersSent: 0,
      lastReminderAt: null,
      paidAt: status === 'paid' ? ago(Math.max(dueDaysAgo - 2, 0)) : null,
      createdAt: ago(dueDaysAgo + 31),
    });
    invoices.push(inv);
    return inv;
  };
  // Overdue issued invoices for the conditional reminder use case.
  const overdueDays = [3, 8, 12, 16, 18, 22, 25, 31, 40, 55, 19, 27];
  const overdue = overdueDays.map((d, i) =>
    mkInvoice(contacts[(i * 5 + 3) % 60], { status: 'issued', dueDaysAgo: d, paid: i === 5 ? 50 : 0 }),
  );
  overdue.push(mkInvoice(unsub, { status: 'issued', dueDaysAgo: 21 })); // email unsubscribed customer
  for (let i = 0; i < 6; i++)
    mkInvoice(contacts[(i * 9 + 4) % 60], { status: 'issued', dueDaysAgo: -int(5, 25) }); // not yet due
  for (let i = 0; i < 9; i++)
    mkInvoice(contacts[(i * 6 + 2) % 60], { status: 'paid', dueDaysAgo: int(5, 60) });
  for (let i = 0; i < 3; i++) mkInvoice(contacts[(i * 11 + 7) % 60], { status: 'draft', dueDaysAgo: 0 });
  mkInvoice(contacts[33], { status: 'void', dueDaysAgo: 30 });
  const sarahInv = mkInvoice(sarahJ, { status: 'issued', dueDaysAgo: -10, items: [line(products[2], 1)] });
  void sarahInv;

  const mkEmail = (contact, extra) =>
    ins('emails', {
      contactId: contact.id,
      to: contact.email,
      from: 'billing@northwind.example',
      subject: '',
      body: '',
      status: 'sent',
      category: 'general',
      direction: 'outbound',
      invoiceId: null,
      templateId: null,
      scheduledAt: null,
      sentAt: null,
      deliveryStatus: 'delivered',
      openedAt: null,
      createdAt: ago(5),
      ...extra,
    });
  // Invoices 3, 6 and 8 were reminded this week and must be skipped; 7 was reminded last week.
  const remindedThisWeek = [overdue[3], overdue[6], overdue[8]];
  remindedThisWeek.forEach((inv, k) => {
    const c = db.get('contacts', inv.contactId);
    const at = ago(Math.max(daysSinceMonday - k, 0), 9);
    mkEmail(c, {
      subject: `Reminder: invoice ${inv.number} is overdue`,
      body: 'Friendly reminder…',
      category: 'invoice_reminder',
      invoiceId: inv.id,
      templateId: reminderTpl.id,
      sentAt: at,
      createdAt: at,
    });
    Object.assign(inv, { remindersSent: 1, lastReminderAt: at });
  });
  {
    const inv = overdue[7];
    const c = db.get('contacts', inv.contactId);
    const at = ago(daysSinceMonday + 3, 9);
    mkEmail(c, {
      subject: `Reminder: invoice ${inv.number} is overdue`,
      body: 'Friendly reminder…',
      category: 'invoice_reminder',
      invoiceId: inv.id,
      templateId: reminderTpl.id,
      sentAt: at,
      createdAt: at,
    });
    Object.assign(inv, { remindersSent: 1, lastReminderAt: at });
  }
  for (let i = 0; i < 14; i++) {
    const c = contacts[(i * 4 + 6) % 60];
    const at = ago(int(1, 30), int(8, 18));
    mkEmail(c, {
      subject: pickOne(['Your monthly update', 'Welcome aboard', 'Quick question', 'Your demo recording']),
      body: 'Hello!',
      category: pickOne(['general', 'marketing', 'follow_up']),
      sentAt: at,
      createdAt: at,
      deliveryStatus: i === 3 ? 'bounced' : 'delivered',
      openedAt: i % 3 ? null : at,
    });
  }
  mkEmail(contacts[5], {
    subject: 'Draft: renewal offer',
    body: 'Draft body',
    status: 'draft',
    deliveryStatus: null,
  });
  mkEmail(contacts[8], {
    subject: 'Holiday hours',
    body: 'We will be closed…',
    status: 'scheduled',
    scheduledAt: ahead(5, 9),
    deliveryStatus: null,
  });

  for (let i = 0; i < 12; i++) {
    const c = contacts[(i * 5 + 1) % 60];
    const at = ago(int(0, 20), int(8, 18));
    ins('sms', {
      contactId: c.id,
      to: c.phone,
      body: pickOne([
        'Your appointment is confirmed.',
        'Thanks for your purchase!',
        'Reminder: demo tomorrow at 10am.',
      ]),
      status: i === 10 ? 'scheduled' : 'sent',
      direction: i % 4 === 0 ? 'inbound' : 'outbound',
      segments: 1,
      scheduledAt: i === 10 ? ahead(2, 10) : null,
      sentAt: i === 10 ? null : at,
      deliveryStatus: i === 10 ? null : i === 7 ? 'failed' : 'delivered',
      failureReason: i === 7 ? 'Carrier rejected message' : null,
      createdAt: at,
    });
  }

  const paidInvoices = invoices.filter((x) => x.status === 'paid');
  paidInvoices.forEach((inv, i) =>
    ins('payments', {
      contactId: inv.contactId,
      amount: inv.total,
      currency: 'USD',
      method: pickOne(['card', 'bank_transfer', 'card']),
      status: 'succeeded',
      failureReason: null,
      allocations: [{ invoiceId: inv.id, amount: inv.total }],
      refundedAmount: 0,
      processedAt: inv.paidAt,
      reference: `ch_${1000 + i}`,
      createdAt: inv.paidAt,
    }),
  );
  ins('payments', {
    contactId: overdue[5].contactId,
    amount: 50,
    currency: 'USD',
    method: 'card',
    status: 'succeeded',
    failureReason: null,
    allocations: [{ invoiceId: overdue[5].id, amount: 50 }],
    refundedAmount: 0,
    processedAt: ago(10),
    reference: 'ch_2001',
    createdAt: ago(10),
  });
  ins('payments', {
    contactId: overdue[1].contactId,
    amount: overdue[1].total,
    currency: 'USD',
    method: 'card',
    status: 'failed',
    failureReason: 'card_declined: insufficient funds',
    allocations: [],
    refundedAmount: 0,
    processedAt: ago(4),
    reference: 'ch_2002',
    createdAt: ago(4),
  });
  ins('payments', {
    contactId: contacts[12].id,
    amount: 300,
    currency: 'USD',
    method: 'bank_transfer',
    status: 'succeeded',
    failureReason: null,
    allocations: [],
    refundedAmount: 0,
    processedAt: ago(2),
    reference: 'ch_2003',
    createdAt: ago(2),
  });
  ins('payment_requests', {
    contactId: overdue[0].contactId,
    invoiceId: overdue[0].id,
    amount: overdue[0].balance,
    currency: 'USD',
    status: 'pending',
    link: 'https://pay.northwind.example/r/preq_0001',
    expiresAt: ahead(10),
    createdAt: ago(2),
  });
  ins('payment_requests', {
    contactId: contacts[20].id,
    invoiceId: null,
    amount: 120,
    currency: 'USD',
    status: 'paid',
    link: 'https://pay.northwind.example/r/preq_0002',
    expiresAt: ahead(5),
    createdAt: ago(8),
  });
  const pays = db.col('payments');
  ins('refunds', {
    paymentId: pays[0].id,
    contactId: pays[0].contactId,
    amount: 20,
    reason: 'Billing error',
    status: 'requested',
    executedAt: null,
    createdAt: ago(1),
  });
  ins('refunds', {
    paymentId: pays[1].id,
    contactId: pays[1].contactId,
    amount: pays[1].amount,
    reason: 'Cancelled within trial',
    status: 'approved',
    executedAt: null,
    createdAt: ago(3),
  });

  const subPrices = prices.filter((p) => p.interval !== 'one_time');
  for (let i = 0; i < 9; i++) {
    const pr = subPrices[i % subPrices.length];
    const status = [
      'active',
      'active',
      'active',
      'trialing',
      'paused',
      'active',
      'cancelled',
      'active',
      'active',
    ][i];
    ins('subscriptions', {
      contactId: contacts[(i * 7 + 3) % 60].id,
      priceId: pr.id,
      productId: pr.productId,
      quantity: int(1, 5),
      status,
      trialEndsAt: status === 'trialing' ? ahead(6) : null,
      currentPeriodEnd: ahead(int(3, 28)),
      cancelledAt: status === 'cancelled' ? ago(10) : null,
      createdAt: ago(int(30, 300)),
    });
  }
  ins('coupons', {
    code: 'FALL20',
    description: '20% off fall promo',
    type: 'percent',
    value: 20,
    validFrom: ago(30),
    validTo: ahead(30),
    redemptionLimit: 100,
    redemptions: 37,
    productIds: [],
    status: 'active',
    createdAt: ago(30),
  });
  ins('coupons', {
    code: 'WELCOME50',
    description: '$50 off first order',
    type: 'fixed',
    value: 50,
    validFrom: ago(200),
    validTo: ahead(200),
    redemptionLimit: null,
    redemptions: 112,
    productIds: [products[3].id, products[4].id],
    status: 'active',
    createdAt: ago(200),
  });
  ins('coupons', {
    code: 'SUMMER10',
    description: 'Summer sale',
    type: 'percent',
    value: 10,
    validFrom: ago(150),
    validTo: ago(40),
    redemptionLimit: 50,
    redemptions: 50,
    productIds: [],
    status: 'active',
    createdAt: ago(150),
  });
  for (let i = 0; i < 6; i++) {
    const p = products[5 + (i % 2)];
    const items = [
      {
        id: `oli_${i}`,
        productId: p.id,
        variantId: null,
        description: p.name,
        quantity: int(1, 4),
        unitPrice: p.basePrice,
      },
    ];
    const status = ['draft', 'submitted', 'submitted', 'fulfilled', 'cancelled', 'submitted'][i];
    ins('orders', {
      contactId: contacts[(i * 8 + 5) % 60].id,
      lineItems: items,
      shippingAddress:
        i === 0
          ? null
          : {
              line1: `${100 + i} Market St`,
              city: 'San Francisco',
              region: 'US-CA',
              postalCode: '94105',
              country: 'US',
            },
      couponCode: null,
      discount: 0,
      subtotal: total(items),
      total: total(items),
      status,
      submittedAt: status === 'draft' ? null : ago(i + 1),
      fulfilledAt: status === 'fulfilled' ? ago(1) : null,
      createdAt: ago(i + 3),
    });
  }

  const wf1 = ins('workflows', {
    name: 'New lead welcome',
    description: 'Send welcome email to new leads',
    steps: [
      { id: 'wstep_0001', type: 'send_email', config: { templateId: null, subject: 'Welcome!' } },
      { id: 'wstep_0002', type: 'wait', config: { days: 2 } },
    ],
    status: 'published',
    executions: [
      { id: 'wexec_1', at: ago(3), status: 'success', contactId: thisWeek[0].contact.id },
      {
        id: 'wexec_2',
        at: ago(2),
        status: 'failed',
        error: 'Template missing',
        contactId: thisWeek[1].contact.id,
      },
    ],
    createdAt: ago(100),
  });
  ins('workflows', {
    name: 'Invoice overdue escalation',
    description: 'Notify account owner when invoice overdue 30 days',
    steps: [{ id: 'wstep_0003', type: 'create_task', config: { title: 'Escalate overdue invoice' } }],
    status: 'paused',
    executions: [],
    createdAt: ago(80),
  });
  ins('workflows', {
    name: 'Draft: webinar follow-up',
    description: '',
    steps: [],
    status: 'draft',
    executions: [],
    createdAt: ago(4),
  });
  ins('triggers', {
    name: 'Lead created',
    eventType: 'lead.created',
    conditions: [],
    workflowId: wf1.id,
    enabled: true,
    firings: [{ at: ago(3), eventId: 'evt_x1', matched: true }],
    createdAt: ago(100),
  });
  ins('triggers', {
    name: 'Form submitted: Contact us',
    eventType: 'form.submitted',
    conditions: [{ field: 'formName', op: 'eq', value: 'Contact us' }],
    workflowId: null,
    enabled: false,
    firings: [],
    createdAt: ago(50),
  });

  const contactForm = ins('forms', {
    name: 'Contact us',
    fields: [
      { id: 'fld_name', label: 'Full name', type: 'text', required: true, order: 1 },
      { id: 'fld_email', label: 'Email', type: 'email', required: true, order: 2 },
      { id: 'fld_msg', label: 'Message', type: 'textarea', required: false, order: 3 },
    ],
    validation: { spamProtection: true },
    status: 'published',
    createdAt: ago(200),
  });
  ins('forms', {
    name: 'Webinar registration',
    fields: [
      { id: 'fld_wname', label: 'Name', type: 'text', required: true, order: 1 },
      { id: 'fld_wemail', label: 'Email', type: 'email', required: true, order: 2 },
    ],
    validation: {},
    status: 'draft',
    createdAt: ago(10),
  });
  for (let i = 0; i < 5; i++) {
    const c = contacts[i + 40];
    ins('form_submissions', {
      formId: contactForm.id,
      contactId: c.id,
      answers: { fld_name: c.name, fld_email: c.email, fld_msg: 'Please call me back' },
      createdAt: ago(int(0, 14)),
    });
  }
  const nps = ins('surveys', {
    name: 'Customer NPS Q3',
    questions: [
      {
        id: 'q_nps',
        text: 'How likely are you to recommend us (0-10)?',
        type: 'scale',
        options: [],
        order: 1,
        branching: [],
      },
      {
        id: 'q_why',
        text: 'What is the main reason for your score?',
        type: 'text',
        options: [],
        order: 2,
        branching: [],
      },
    ],
    status: 'open',
    createdAt: ago(60),
  });
  for (let i = 0; i < 8; i++)
    ins('survey_responses', {
      surveyId: nps.id,
      contactId: contacts[i * 6].id,
      answers: {
        q_nps: [10, 9, 6, 8, 3, 10, 7, 9][i],
        q_why: pickOne(['Great support', 'Pricey', 'Easy to use']),
      },
      createdAt: ago(int(1, 50)),
    });
  ins('surveys', { name: 'Onboarding feedback', questions: [], status: 'draft', createdAt: ago(3) });

  ins('booking_pages', {
    title: 'Book a discovery call',
    slug: 'discovery',
    calendarId: salesCal.id,
    content: { headline: 'Talk to sales', body: 'Pick a time that suits you.' },
    intakeFields: [{ key: 'company', label: 'Company', required: true }],
    confirmationMessage: 'Thanks! We will see you soon.',
    redirectUrl: null,
    published: true,
    createdAt: ago(200),
  });
  ins('booking_pages', {
    title: 'Onboarding kickoff',
    slug: 'onboarding',
    calendarId: null,
    content: { headline: 'Kickoff', body: '' },
    intakeFields: [],
    confirmationMessage: '',
    redirectUrl: null,
    published: false,
    createdAt: ago(20),
  });

  ins('events', {
    name: 'Growth Masterclass (live)',
    description: 'Monthly live training',
    startAt: ahead(7, 16),
    endAt: ahead(7, 17),
    location: 'Online',
    capacity: 3,
    registrations: [contacts[1], contacts[2], contacts[3]]
      .map((c, i) => ({ id: `reg_${i + 1}`, contactId: c.id, status: 'registered', at: ago(5) }))
      .concat([{ id: 'reg_4', contactId: contacts[4].id, status: 'waitlisted', at: ago(2) }]),
    status: 'scheduled',
    createdAt: ago(30),
  });
  ins('events', {
    name: 'Customer Meetup NYC',
    description: 'In-person networking',
    startAt: ahead(20, 18),
    endAt: ahead(20, 21),
    location: 'New York',
    capacity: 50,
    registrations: [{ id: 'reg_5', contactId: sarahJ.id, status: 'registered', at: ago(3) }],
    status: 'scheduled',
    createdAt: ago(25),
  });
  ins('events', {
    name: 'Product Launch Webinar',
    description: 'What is new this fall',
    startAt: ago(0, 9),
    endAt: ago(0, 11),
    location: 'Online',
    capacity: 200,
    registrations: [
      { id: 'reg_6', contactId: contacts[10].id, status: 'registered', at: ago(6) },
      { id: 'reg_7', contactId: contacts[11].id, status: 'checked_in', at: ago(0, 9) },
    ],
    status: 'live',
    createdAt: ago(40),
  });

  ins('quotes', {
    number: 'Q-2001',
    contactId: sarahJ.id,
    lineItems: [
      {
        id: 'qli_1',
        productId: products[2].id,
        description: 'Enterprise Plan (annual)',
        quantity: 1,
        unitPrice: 4990,
      },
    ],
    discount: null,
    subtotal: 4990,
    total: 4990,
    expiresAt: ahead(14),
    status: 'sent',
    acceptedAt: null,
    invoiceId: null,
    createdAt: ago(5),
  });
  ins('quotes', {
    number: 'Q-2002',
    contactId: contacts[7].id,
    lineItems: [
      {
        id: 'qli_2',
        productId: products[4].id,
        description: 'Strategy Workshop',
        quantity: 1,
        unitPrice: 1500,
      },
    ],
    discount: { type: 'percent', value: 10 },
    subtotal: 1500,
    total: 1350,
    expiresAt: ahead(20),
    status: 'accepted',
    acceptedAt: ago(1),
    invoiceId: null,
    createdAt: ago(9),
  });
  ins('quotes', {
    number: 'Q-2003',
    contactId: contacts[14].id,
    lineItems: [],
    discount: null,
    subtotal: 0,
    total: 0,
    expiresAt: null,
    status: 'draft',
    acceptedAt: null,
    invoiceId: null,
    createdAt: ago(1),
  });
  ins('quotes', {
    number: 'Q-1999',
    contactId: contacts[18].id,
    lineItems: [
      { id: 'qli_3', productId: products[1].id, description: 'Growth Plan', quantity: 2, unitPrice: 149 },
    ],
    discount: null,
    subtotal: 298,
    total: 298,
    expiresAt: ago(3),
    status: 'sent',
    acceptedAt: null,
    invoiceId: null,
    createdAt: ago(30),
  });

  const lp1 = ins('landing_pages', {
    title: 'Fall Promo Landing',
    slug: 'fall-promo',
    content: { headline: 'Grow faster this fall', body: 'Get 20% off.' },
    sections: [
      { id: 'sec_1', type: 'hero', title: 'Hero', order: 1 },
      { id: 'sec_2', type: 'features', title: 'Features', order: 2 },
      { id: 'sec_3', type: 'cta', title: 'Call to action', order: 3 },
    ],
    formId: contactForm.id,
    seo: { title: 'Fall Promo', description: '' },
    published: true,
    views: 3200,
    conversions: 160,
    createdAt: ago(35),
  });
  const lp2 = ins('landing_pages', {
    title: 'Webinar Signup',
    slug: 'webinar',
    content: { headline: 'Join the masterclass', body: '' },
    sections: [{ id: 'sec_4', type: 'hero', title: 'Hero', order: 1 }],
    formId: null,
    seo: { title: '', description: '' },
    published: false,
    views: 0,
    conversions: 0,
    createdAt: ago(6),
  });
  ins('landing_pages', {
    title: 'Thank You',
    slug: 'thanks',
    content: { headline: 'Thanks!', body: '' },
    sections: [],
    formId: null,
    seo: { title: 'Thanks', description: '' },
    published: true,
    views: 160,
    conversions: 0,
    createdAt: ago(35),
  });
  ins('funnels', {
    name: 'Fall Promo Funnel',
    steps: [
      { id: 'fstep_1', name: 'Opt-in', order: 1, landingPageId: lp1.id, visitors: 3200, conversions: 160 },
      { id: 'fstep_2', name: 'Thank you', order: 2, landingPageId: null, visitors: 160, conversions: 41 },
    ],
    goal: { type: 'form_submission', target: 200 },
    published: true,
    createdAt: ago(35),
  });
  ins('funnels', {
    name: 'Webinar Funnel',
    steps: [
      { id: 'fstep_3', name: 'Register', order: 1, landingPageId: lp2.id, visitors: 0, conversions: 0 },
    ],
    goal: null,
    published: false,
    createdAt: ago(6),
  });
  ins('websites', {
    name: 'Northwind Main Site',
    domain: 'northwind.example',
    pages: [
      { id: 'page_home', title: 'Home', path: '/' },
      { id: 'page_pricing', title: 'Pricing', path: '/pricing' },
      { id: 'page_about', title: 'About', path: '/about' },
    ],
    homePageId: 'page_home',
    navigation: [
      { label: 'Pricing', pageId: 'page_pricing' },
      { label: 'About', pageId: 'page_about' },
    ],
    seo: { titleTemplate: '%s | Northwind', description: 'CRM for growing teams' },
    published: true,
    createdAt: ago(400),
  });
  ins('websites', {
    name: 'Partner Portal',
    domain: 'partners.northwind.example',
    pages: [],
    homePageId: null,
    navigation: [],
    seo: {},
    published: false,
    createdAt: ago(30),
  });
  for (const [title, status, i] of [
    ['10 ways to follow up with leads', 'published', 1],
    ['Pricing your services', 'published', 2],
    ['Fall product update', 'draft', 3],
    ['Customer story: Globex', 'scheduled', 4],
    ['Onboarding checklist', 'draft', 5],
  ]) {
    ins('blog_posts', {
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      body: `${title}…`,
      authorId: pickOne([U.nina, U.alex]).id,
      categories: i % 2 ? ['sales'] : ['product'],
      seo: { title, description: '' },
      status,
      publishAt: status === 'scheduled' ? ahead(3) : null,
      publishedAt: status === 'published' ? ago(i * 10) : null,
      createdAt: ago(i * 12),
    });
  }
  for (let i = 0; i < 8; i++) {
    ins('media_assets', {
      name: [
        'hero.jpg',
        'logo.png',
        'pricing.pdf',
        'team.jpg',
        'promo.mp4',
        'old-banner.png',
        'guide.pdf',
        'icon.svg',
      ][i],
      mime: [
        'image/jpeg',
        'image/png',
        'application/pdf',
        'image/jpeg',
        'video/mp4',
        'image/png',
        'application/pdf',
        'image/svg+xml',
      ][i],
      sizeKb: int(20, 9000),
      folder: i < 4 ? '/marketing' : '/misc',
      altText: i === 1 ? 'Northwind logo' : '',
      url: `https://cdn.northwind.example/a/${i}`,
      version: 1,
      references: i < 3 ? [{ type: 'landing_page', id: lp1.id }] : [],
      status: 'active',
      createdAt: ago(int(5, 200)),
    });
  }

  const course1 = ins('courses', {
    title: 'CRM Fundamentals',
    description: 'Get started with the platform',
    sections: [
      { id: 'csec_1', title: 'Getting started', order: 1 },
      { id: 'csec_2', title: 'Contacts & leads', order: 2 },
      { id: 'csec_3', title: 'Automation', order: 3 },
    ],
    instructorId: U.sam.id,
    prerequisites: [],
    status: 'published',
    createdAt: ago(200),
  });
  const course2 = ins('courses', {
    title: 'Advanced Automation',
    description: 'Workflows and triggers in depth',
    sections: [{ id: 'csec_4', title: 'Workflows', order: 1 }],
    instructorId: U.sam.id,
    prerequisites: [course1.id],
    status: 'published',
    createdAt: ago(100),
  });
  ins('courses', {
    title: 'Sales Playbook',
    description: 'Draft course',
    sections: [],
    instructorId: null,
    prerequisites: [],
    status: 'draft',
    createdAt: ago(10),
  });
  const lessons = [];
  [
    ['Welcome', 'csec_1'],
    ['Navigating the app', 'csec_1'],
    ['Creating contacts', 'csec_2'],
    ['Working with leads', 'csec_2'],
    ['Intro to workflows', 'csec_3'],
  ].forEach(([t, sec], i) =>
    lessons.push(
      ins('lessons', {
        courseId: course1.id,
        sectionId: sec,
        title: t,
        content: `${t} content`,
        mediaIds: [],
        releaseAt: null,
        completionCriteria: { type: 'view', minPercent: 80 },
        published: true,
        order: i + 1,
        createdAt: ago(190),
      }),
    ),
  );
  [
    ['Triggers deep dive', 'csec_4'],
    ['Branching logic', 'csec_4'],
  ].forEach(([t, sec], i) =>
    lessons.push(
      ins('lessons', {
        courseId: course2.id,
        sectionId: sec,
        title: t,
        content: `${t} content`,
        mediaIds: [],
        releaseAt: null,
        completionCriteria: { type: 'quiz', passScore: 70 },
        published: i === 0,
        order: i + 1,
        createdAt: ago(90),
      }),
    ),
  );
  const c1Lessons = lessons.filter((l) => l.courseId === course1.id).map((l) => l.id);
  for (let i = 0; i < 8; i++) {
    const done = i === 0 ? c1Lessons : c1Lessons.slice(0, i % 4);
    ins('enrollments', {
      contactId: contacts[i * 2 + 20].id,
      courseId: i < 6 ? course1.id : course2.id,
      status: i === 7 ? 'suspended' : 'active',
      expiresAt: i === 5 ? ahead(5) : null,
      completedLessonIds: i < 6 ? done : [],
      certificateId: null,
      createdAt: ago(int(10, 100)),
    });
  }
  const community = ins('communities', {
    name: 'Northwind Customers',
    description: 'Customer community',
    guidelines: 'Be kind. No spam.',
    channels: [
      { id: 'ch_general', name: 'general' },
      { id: 'ch_tips', name: 'tips-and-tricks' },
    ],
    memberIds: contacts.slice(20, 32).map((c) => c.id),
    status: 'active',
    createdAt: ago(200),
  });
  ins('communities', {
    name: 'Partner Lounge',
    description: 'For agency partners',
    guidelines: '',
    channels: [{ id: 'ch_partners', name: 'announcements' }],
    memberIds: [],
    status: 'active',
    createdAt: ago(50),
  });
  for (let i = 0; i < 6; i++)
    ins('community_posts', {
      communityId: community.id,
      channelId: i % 2 ? 'ch_tips' : 'ch_general',
      authorContactId: contacts[20 + i].id,
      body: [
        'Hello everyone!',
        'Tip: use smart lists',
        'BUY CHEAP FOLLOWERS!!!',
        'How do I export reports?',
        'Love the new update',
        'Workflow question',
      ][i],
      replies: [],
      pinned: false,
      reported: i === 2,
      reportReason: i === 2 ? 'spam' : null,
      status: 'visible',
      createdAt: ago(10 - i),
    });
  const plan1 = ins('membership_plans', {
    name: 'Pro Learning',
    description: 'All courses + community',
    entitlements: [
      { type: 'course', id: course1.id },
      { type: 'course', id: course2.id },
      { type: 'community', id: community.id },
    ],
    status: 'active',
    createdAt: ago(150),
  });
  ins('membership_plans', {
    name: 'Community Only',
    description: 'Community access',
    entitlements: [{ type: 'community', id: community.id }],
    status: 'active',
    createdAt: ago(150),
  });
  for (let i = 0; i < 4; i++)
    ins('memberships', {
      planId: plan1.id,
      contactId: contacts[20 + i].id,
      status: i === 3 ? 'revoked' : 'active',
      expiresAt: i === 1 ? ahead(10) : null,
      createdAt: ago(60),
    });

  for (let i = 0; i < 4; i++)
    ins('review_requests', {
      contactId: contacts[i + 50].id,
      channel: i % 2 ? 'sms' : 'email',
      templateId: null,
      message: 'Would you review us?',
      status: ['sent', 'sent', 'draft', 'cancelled'][i],
      sentAt: i < 2 ? ago(i + 2) : null,
      createdAt: ago(i + 3),
    });
  [5, 4, 5, 2, 5, 3, 4, 1].forEach((rating, i) =>
    ins('reviews', {
      contactId: contacts[i + 44].id,
      platform: pickOne(['google', 'facebook', 'trustpilot']),
      rating,
      text:
        rating >= 4
          ? 'Great service, very responsive team.'
          : rating === 3
            ? 'Decent but a bit expensive.'
            : 'Support took too long to reply.',
      response: null,
      publishedAt: ago(int(1, 60)),
      createdAt: ago(int(1, 60)),
    }),
  );
  ins('listings', {
    directory: 'Google Business Profile',
    name: 'Northwind CRM',
    address: '500 Market St, San Francisco, CA',
    phone: '+14155550100',
    hours: {
      mon: '09:00-17:00',
      tue: '09:00-17:00',
      wed: '09:00-17:00',
      thu: '09:00-17:00',
      fri: '09:00-17:00',
    },
    categories: ['Software company'],
    published: true,
    syncStatus: 'synced',
    lastSyncedAt: ago(2),
    createdAt: ago(300),
  });
  ins('listings', {
    directory: 'Yelp',
    name: 'Northwind CRM Inc',
    address: '500 Market Street, SF',
    phone: '+14155550100',
    hours: {},
    categories: ['Business consulting'],
    published: true,
    syncStatus: 'out_of_sync',
    lastSyncedAt: ago(40),
    createdAt: ago(250),
  });
  ins('listings', {
    directory: 'Bing Places',
    name: 'Northwind CRM',
    address: '',
    phone: '',
    hours: {},
    categories: [],
    published: false,
    syncStatus: 'not_published',
    lastSyncedAt: null,
    createdAt: ago(5),
  });
  const SLA = { urgent: 4, high: 8, medium: 24, low: 72 };
  for (let i = 0; i < 12; i++) {
    const pr = ['urgent', 'high', 'medium', 'low'][i % 4];
    const status = i < 7 ? 'open' : i < 9 ? 'pending' : i < 11 ? 'resolved' : 'closed';
    const createdAt = ago(int(0, 6), int(8, 18));
    ins('tickets', {
      subject: [
        'Cannot log in',
        'Billing discrepancy',
        'Feature request: dark mode',
        'Email not sending',
        'Import failed',
        'Calendar sync issue',
      ][i % 6],
      description: 'Customer reported an issue.',
      requesterContactId: contacts[(i * 3 + 9) % 60].id,
      ownerId: i % 3 ? pickOne([U.grace, U.tom]).id : null,
      priority: pr,
      status,
      notes: [],
      replies: [],
      slaHours: SLA[pr],
      firstResponseAt: i % 2 ? createdAt : null,
      resolvedAt: status === 'resolved' || status === 'closed' ? ago(0) : null,
      createdAt,
    });
  }

  ins('reports', {
    name: 'Weekly new leads',
    metric: 'leads_created',
    filters: [],
    dateRange: { preset: 'last_7_days' },
    groupBy: 'source',
    schedule: null,
    createdAt: ago(60),
  });
  ins('reports', {
    name: 'Monthly revenue',
    metric: 'revenue',
    filters: [],
    dateRange: { preset: 'last_30_days' },
    groupBy: 'none',
    schedule: { frequency: 'monthly', recipients: ['alex@northwind.example'] },
    createdAt: ago(90),
  });
  ins('reports', {
    name: 'Deals won by owner',
    metric: 'deals_won',
    filters: [],
    dateRange: { preset: 'last_90_days' },
    groupBy: 'ownerId',
    schedule: null,
    createdAt: ago(90),
  });

  db.log = [];
  return db.snapshot();
}
