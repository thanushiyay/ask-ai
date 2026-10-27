import { fail } from './errors.js';

const PREFIX = {
  contacts: 'con',
  companies: 'com',
  leads: 'lead',
  opportunities: 'opp',
  pipelines: 'pipe',
  tasks: 'task',
  notes: 'note',
  tags: 'tag',
  smart_lists: 'sl',
  custom_fields: 'cf',
  conversations: 'conv',
  sms: 'sms',
  emails: 'eml',
  templates: 'tpl',
  campaigns: 'camp',
  workflows: 'wf',
  triggers: 'trg',
  forms: 'form',
  form_submissions: 'fsub',
  surveys: 'srv',
  survey_responses: 'sres',
  calendars: 'cal',
  appointments: 'appt',
  availability: 'avl',
  booking_pages: 'bp',
  events: 'evt',
  products: 'prod',
  prices: 'price',
  quotes: 'quo',
  invoices: 'inv',
  payment_requests: 'preq',
  payments: 'pay',
  receipts: 'rcpt',
  subscriptions: 'sub',
  coupons: 'cpn',
  orders: 'ord',
  refunds: 'ref',
  tax_rules: 'tax',
  websites: 'site',
  funnels: 'fun',
  landing_pages: 'lp',
  blog_posts: 'post',
  media_assets: 'asset',
  courses: 'crs',
  lessons: 'les',
  enrollments: 'enr',
  certificates: 'cert',
  communities: 'cmty',
  community_posts: 'cpost',
  membership_plans: 'plan',
  memberships: 'mem',
  review_requests: 'rreq',
  reviews: 'rev',
  listings: 'lst',
  tickets: 'tkt',
  users: 'usr',
  teams: 'team',
  reports: 'rpt',
  exports: 'exp',
};

export class Store {
  constructor(clock) {
    this.clock = clock;
    this.data = {};
    this.counters = {};
    this.log = [];
    this._seed = null;
  }

  /** Load a seed snapshot and remember it for reset(). */
  load(snapshot) {
    this._seed = structuredClone(snapshot);
    this.reset();
    return this;
  }

  reset() {
    const s = structuredClone(this._seed ?? { data: {}, counters: {} });
    this.data = s.data;
    this.counters = s.counters;
    this.log = [];
  }

  snapshot() {
    return structuredClone({ data: this.data, counters: this.counters });
  }

  col(name) {
    return (this.data[name] ??= []);
  }

  nextId(name) {
    const n = (this.counters[name] = (this.counters[name] ?? 0) + 1);
    return `${PREFIX[name] ?? name}_${String(n).padStart(4, '0')}`;
  }

  insert(name, record, actor = 'agent') {
    const now = this.clock.nowIso();
    const rec = { id: record.id ?? this.nextId(name), createdAt: now, updatedAt: now, ...record };
    this.col(name).push(rec);
    this._audit('create', name, rec.id, actor);
    return rec;
  }

  get(name, id) {
    return this.col(name).find((r) => r.id === id);
  }

  must(name, id, label = name) {
    const r = this.get(name, id);
    if (!r) throw fail.notFound(label.replace(/s$/, ''), id);
    return r;
  }

  find(name, pred = () => true) {
    return this.col(name).filter(pred);
  }

  findOne(name, pred) {
    return this.col(name).find(pred);
  }

  /** Shallow-merge a patch into a record (mutates in place so references stay valid). */
  update(name, id, patch, actor = 'agent') {
    const rec = this.must(name, id);
    Object.assign(rec, patch, { updatedAt: this.clock.nowIso() });
    this._audit('update', name, id, actor, Object.keys(patch));
    return rec;
  }

  remove(name, id, actor = 'agent') {
    const list = this.col(name);
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) throw fail.notFound(name.replace(/s$/, ''), id);
    const [rec] = list.splice(i, 1);
    this._audit('delete', name, id, actor);
    return rec;
  }

  _audit(op, collection, id, actor, fields) {
    this.log.push({ at: this.clock.nowIso(), op, collection, id, actor, ...(fields ? { fields } : {}) });
  }

  counts() {
    return Object.fromEntries(Object.entries(this.data).map(([k, v]) => [k, v.length]));
  }
}
