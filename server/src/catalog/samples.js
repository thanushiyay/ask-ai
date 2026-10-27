const FUTURE = '2026-10-16T10:00:00.000Z'; // Friday 10:00 UTC, inside working hours
const KEY_HINTS = {
  phone: '+14155550199',
  color: '#22c55e',
  slug: 'smoke-test',
  code: 'SMOKE10',
  region: 'US-CA',
  folder: '/smoke',
  domain: 'smoke-test.example',
  url: 'https://example.com/thanks',
  redirectUrl: 'https://example.com/thanks',
  certificateNumber: 'EX-12345',
  reason: 'Smoke test reason',
  body: 'Smoke test body',
  title: 'Smoke test',
  subject: 'Smoke test subject',
  label: 'Smoke Label',
  description: 'Smoke test description',
  content: 'Smoke content',
  firstName: 'Smoke',
  lastName: 'Tester',
  query: undefined,
  timezone: 'America/New_York',
  sku: 'SMOKE-SKU-1',
};

const metaOf = (schema) => schema.meta?.() ?? {};

function gen(schema, key, ctx, mode) {
  const def = schema._zod.def;
  switch (def.type) {
    case 'optional':
    case 'default':
      return mode === 'full' ? gen(def.innerType, key, ctx, mode) : undefined;
    case 'nullable':
      return gen(def.innerType, key, ctx, mode);
    case 'pipe':
      return gen(def.in, key, ctx, mode);
    case 'object': {
      const outObj = {};
      for (const [k, v] of Object.entries(def.shape)) {
        const val = gen(v, k, ctx, mode);
        if (val !== undefined) outObj[k] = val;
      }
      return outObj;
    }
    case 'string': {
      const meta = metaOf(schema);
      if (meta.ref) {
        const rows = ctx.db.col(meta.ref);
        return rows[Math.min(ctx.variant, rows.length - 1)]?.id ?? `${meta.ref}_missing`;
      }
      if (schema.format === 'email') return `smoke.${ctx.variant}@example.com`;
      if (meta.format === 'date-time' || meta.format === 'date') return FUTURE;
      if (key in KEY_HINTS && KEY_HINTS[key] !== undefined) return KEY_HINTS[key];
      if (key === 'name') return `Smoke Test ${ctx.variant}`;
      return 'smoke';
    }
    case 'number': {
      const min = schema.minValue ?? 1;
      return Math.max(min, Number.isFinite(min) ? min : 1, 1);
    }
    case 'boolean':
      return true;
    case 'enum': {
      const vals = Object.values(def.entries);
      return vals[ctx.variant % vals.length];
    }
    case 'literal':
      return def.values[0];
    case 'array': {
      const v = gen(def.element, key, ctx, mode);
      return v === undefined ? [] : [v];
    }
    case 'union':
      return gen(def.options[0], key, ctx, mode);
    case 'record':
      return {};
    case 'any':
    case 'unknown':
      return 'smoke';
    default:
      return undefined;
  }
}

export function generateArgs(action, db, variant, mode) {
  return gen(action.input, '', { db, variant }, mode);
}

// Inputs that depend on nested state (a stage in a pipeline, a field in a form).
const first = (db, col, pred = () => true) => db.find(col, pred)[0];
export const EXAMPLES = {
  'contacts.create': () => ({ firstName: 'Smoke', lastName: 'Tester', email: 'smoke.contact@example.com' }),
  'contacts.update': (db) => ({ contactId: first(db, 'contacts').id, phone: '+14155550111' }),
  'contacts.merge_duplicates': (db) => ({
    primaryContactId: first(db, 'contacts', (c) => c.firstName === 'Michael').id,
    duplicateContactId: first(db, 'contacts', (c) => c.firstName === 'Mike').id,
  }),
  'contacts.add_relationship': (db) => ({
    contactId: db.col('contacts')[0].id,
    relatedContactId: db.col('contacts')[1].id,
    type: 'colleague',
  }),
  'contacts.set_communication_preferences': (db) => ({
    contactId: first(db, 'contacts').id,
    preferredChannel: 'sms',
  }),
  'companies.create': () => ({ name: 'Smoke Industries', domain: 'smoke.example', industry: 'software' }),
  'companies.update': (db) => ({ companyId: first(db, 'companies').id, industry: 'retail' }),
  'companies.link_contact': (db) => ({
    companyId: db.col('companies')[0].id,
    contactId: first(db, 'contacts', (c) => c.companyId !== db.col('companies')[0].id).id,
  }),
  'companies.unlink_contact': (db) => {
    const c = first(db, 'contacts', (x) => x.companyId);
    return { companyId: c.companyId, contactId: c.id };
  },
  'companies.merge_duplicates': (db) => ({
    primaryCompanyId: first(db, 'companies', (c) => c.name === 'Acme Corp').id,
    duplicateCompanyId: first(db, 'companies', (c) => c.name === 'Acme Corporation').id,
  }),
  'leads.create': () => ({ name: 'Smoke Lead', email: 'smoke.lead@example.com', source: 'facebook' }),
  'leads.update': (db) => ({ leadId: first(db, 'leads', (l) => l.status === 'new').id, status: 'contacted' }),
  'leads.record_qualification': (db) => ({
    leadId: first(db, 'leads', (l) => l.status === 'new').id,
    budget: true,
    authority: true,
    need: true,
    timeline: 'this_month',
  }),
  'leads.disqualify': (db) => ({
    leadId: first(db, 'leads', (l) => l.status === 'new').id,
    reason: 'No budget this year',
  }),
  'leads.convert_to_opportunity': (db) => ({
    leadId: first(db, 'leads', (l) => l.status === 'qualified').id,
    value: 5000,
  }),
  'opportunities.create': (db) => ({
    name: 'Smoke deal',
    contactId: first(db, 'contacts').id,
    pipelineId: first(db, 'pipelines').id,
    value: 1000,
  }),
  'opportunities.update_value': (db) => ({
    opportunityId: first(db, 'opportunities', (o) => o.status === 'open').id,
    value: 2500,
  }),
  'opportunities.move_stage': (db) => ({
    opportunityId: first(
      db,
      'opportunities',
      (o) => o.status === 'open' && o.stageId !== 'stg_proposal' && o.pipelineId === 'pipe_0001',
    ).id,
    stage: 'Proposal',
  }),
  'opportunities.set_close_date': (db) => ({
    opportunityId: first(db, 'opportunities', (o) => o.status === 'open').id,
    expectedCloseDate: '2026-11-30',
  }),
  'opportunities.mark_won': (db) => ({
    opportunityId: first(db, 'opportunities', (o) => o.status === 'open').id,
  }),
  'opportunities.mark_lost': (db) => ({
    opportunityId: first(db, 'opportunities', (o) => o.status === 'open').id,
    reason: 'Budget',
  }),
  'opportunities.reopen': (db) => ({
    opportunityId: first(db, 'opportunities', (o) => o.status === 'lost').id,
  }),
  'pipelines.create': () => ({ name: 'Smoke Pipeline', stageNames: ['Lead', 'Demo', 'Contract'] }),
  'pipelines.archive': (db) => {
    db.insert('pipelines', {
      name: 'Empty',
      stages: [{ id: 'stg_e1', name: 'One', order: 1, winProbability: 10 }],
      status: 'active',
    });
    return { pipelineId: db.col('pipelines').at(-1).id };
  },
  'pipelines.add_stage': (db) => ({
    pipelineId: first(db, 'pipelines').id,
    name: 'Contract Sent',
    position: 4,
  }),
  'pipelines.rename_stage': () => ({ pipelineId: 'pipe_0001', stageId: 'stg_new', name: 'Fresh' }),
  'pipelines.reorder_stages': (db) => ({
    pipelineId: 'pipe_0002',
    stageIds: [...db.get('pipelines', 'pipe_0002').stages].reverse().map((s) => s.id),
  }),
  'pipelines.remove_empty_stage': () => ({ pipelineId: 'pipe_0002', stageId: 'stg_p_legal' }),
  'pipelines.set_stage_probability': () => ({
    pipelineId: 'pipe_0001',
    stageId: 'stg_proposal',
    winProbability: 60,
  }),
  'tasks.create': (db) => ({
    title: 'Follow up with smoke',
    contactId: first(db, 'contacts').id,
    dueDate: FUTURE,
    priority: 'high',
  }),
  'tasks.update_description': (db) => ({
    taskId: first(db, 'tasks', (t) => t.status === 'open').id,
    description: 'Updated',
  }),
  'tasks.reopen': (db) => ({ taskId: first(db, 'tasks', (t) => t.status === 'completed').id }),
  'notes.create': (db) => ({ body: 'Smoke note', recordType: 'contact', recordId: first(db, 'contacts').id }),
  'notes.attach': (db) => ({
    noteId: first(db, 'notes').id,
    recordType: 'lead',
    recordId: first(db, 'leads').id,
  }),
  'notes.detach': (db) => {
    const n = first(db, 'notes', (x) => x.recordRefs.length);
    return { noteId: n.id, recordId: n.recordRefs[0].id };
  },
  'notes.pin': (db) => ({ noteId: first(db, 'notes', (n) => !n.pinned).id }),
  'notes.unpin': (db) => ({ noteId: first(db, 'notes', (n) => n.pinned).id }),
  'tags.create': () => ({ name: 'smoke-tag', color: '#22c55e' }),
  'tags.rename': (db) => ({ tagId: first(db, 'tags').id, name: 'very-important' }),
  'tags.delete_unused': (db) => ({ tagId: first(db, 'tags', (t) => t.name === 'legacy-import').id }),
  'tags.apply': (db) => ({ tag: 'smoke', recordType: 'contact', recordId: first(db, 'contacts').id }),
  'tags.remove': (db) => {
    const c = first(db, 'contacts', (x) => x.tags.length);
    return { tag: c.tags[0], recordType: 'contact', recordId: c.id };
  },
  'tags.list_records': () => ({ tag: 'vip' }),
  'tags.merge': (db) => ({
    sourceTagId: first(db, 'tags', (t) => t.name === 'partner').id,
    targetTagId: first(db, 'tags', (t) => t.name === 'vip').id,
  }),
  'smart_lists.create': () => ({
    name: 'Smoke list',
    module: 'contacts',
    rules: [{ field: 'tags', op: 'contains', value: 'vip' }],
  }),
  'smart_lists.update_rules': (db) => ({
    smartListId: first(db, 'smart_lists').id,
    rules: [{ field: 'source', op: 'eq', value: 'referral' }],
  }),
  'custom_fields.create': () => ({ module: 'contacts', label: 'Shoe size', type: 'number' }),
  'custom_fields.set_validation': (db) => ({
    fieldId: first(db, 'custom_fields').id,
    validation: { required: true },
  }),
  'custom_fields.add_option': (db) => ({
    fieldId: first(db, 'custom_fields', (f) => f.type === 'dropdown').id,
    value: 'education',
  }),
  'custom_fields.retire_option': (db) => ({
    fieldId: first(db, 'custom_fields', (f) => f.type === 'dropdown').id,
    value: 'travel',
  }),
  'custom_fields.set_record_value': (db) => ({
    fieldId: first(db, 'custom_fields', (f) => f.key === 'budget').id,
    recordId: first(db, 'contacts').id,
    value: 5000,
  }),
  'conversations.mark_read': (db) => ({ conversationId: first(db, 'conversations', (c) => c.unread).id }),
  'conversations.mark_unread': (db) => ({ conversationId: first(db, 'conversations', (c) => !c.unread).id }),
  'conversations.close': (db) => ({
    conversationId: first(db, 'conversations', (c) => c.status === 'open').id,
  }),
  'conversations.reopen': (db) => ({
    conversationId: first(db, 'conversations', (c) => c.status === 'closed').id,
  }),
  'sms.draft': (db) => ({
    contactId: first(db, 'contacts', (c) => c.phone && c.commPrefs.sms === 'opted_in').id,
    body: 'Hello from smoke test',
  }),
  'sms.send': (db) => ({
    contactId: first(db, 'contacts', (c) => c.phone && c.commPrefs.sms === 'opted_in').id,
    body: 'Hello from smoke test',
  }),
  'sms.schedule': (db) => ({
    contactId: first(db, 'contacts', (c) => c.phone && c.commPrefs.sms === 'opted_in').id,
    body: 'Later',
    sendAt: FUTURE,
  }),
  'sms.cancel_scheduled': (db) => ({ smsId: first(db, 'sms', (m) => m.status === 'scheduled').id }),
  'sms.record_opt_out': (db) => ({
    contactId: first(db, 'contacts', (c) => c.commPrefs.sms === 'opted_in').id,
  }),
  'email.draft': (db) => ({ contactId: first(db, 'contacts').id, subject: 'Hi', body: 'Hello' }),
  'email.preview': (db) => ({
    contactId: first(db, 'contacts').id,
    templateId: first(db, 'templates', (t) => t.name === 'New lead follow-up').id,
  }),
  'email.send': (db) => ({
    contactId: first(db, 'contacts', (c) => c.commPrefs.email === 'subscribed').id,
    subject: 'Hi',
    body: 'Hello',
  }),
  'email.schedule': (db) => ({
    emailId: first(db, 'emails', (e) => e.status === 'draft').id,
    sendAt: FUTURE,
  }),
  'email.cancel_scheduled': (db) => ({ emailId: first(db, 'emails', (e) => e.status === 'scheduled').id }),
  'email.record_unsubscribe': (db) => ({
    contactId: first(db, 'contacts', (c) => c.commPrefs.email === 'subscribed').id,
  }),
  'templates.create': () => ({
    name: 'Smoke template',
    channel: 'email',
    subject: 'Hi {{first_name}}',
    body: 'Hello {{first_name}}',
  }),
  'templates.update_content': (db) => ({
    templateId: first(db, 'templates').id,
    body: 'New body {{first_name}}',
  }),
  'templates.define_variables': (db) => ({
    templateId: first(db, 'templates').id,
    variables: ['first_name', 'invoice_number'],
  }),
  'templates.restore_version': (db) => {
    const t = first(db, 'templates');
    t.versions.push({ version: 2, subject: 'v2', body: 'v2', at: FUTURE });
    t.version = 2;
    return { templateId: t.id, version: 1 };
  },
  'campaigns.create': () => ({ name: 'Smoke campaign', channel: 'email' }),
  'campaigns.set_audience': (db) => ({
    campaignId: first(db, 'campaigns', (c) => c.status === 'draft').id,
    type: 'tag',
    value: 'vip',
  }),
  'campaigns.add_step': (db) => ({
    campaignId: first(db, 'campaigns', (c) => c.status === 'draft').id,
    subject: 'Hello',
    delayDays: 0,
  }),
  'campaigns.set_schedule': (db) => ({
    campaignId: first(db, 'campaigns', (c) => c.status === 'draft').id,
    startAt: FUTURE,
  }),
  'campaigns.launch': (db) => {
    const c = first(db, 'campaigns', (x) => x.status === 'draft');
    c.audience = { type: 'tag', value: 'vip' };
    c.steps = [{ id: 'cs1', channel: 'email', subject: 'x', templateId: null, delayDays: 0 }];
    return { campaignId: c.id };
  },
  'campaigns.pause': (db) => ({ campaignId: first(db, 'campaigns', (c) => c.status === 'active').id }),
  'campaigns.resume': (db) => ({ campaignId: first(db, 'campaigns', (c) => c.status === 'paused').id }),
  'workflows.create': () => ({
    name: 'Smoke workflow',
    steps: [{ type: 'create_task', config: { title: 'Follow up' } }],
  }),
  'workflows.add_step': (db) => ({
    workflowId: first(db, 'workflows', (w) => w.status === 'draft').id,
    type: 'create_task',
    config: { title: 'Call' },
  }),
  'workflows.update_step': (db) => {
    const w = first(db, 'workflows', (x) => x.status === 'paused');
    return { workflowId: w.id, stepId: w.steps[0].id, config: { title: 'Escalate now' } };
  },
  'workflows.remove_step': (db) => {
    const w = first(db, 'workflows', (x) => x.status === 'paused');
    return { workflowId: w.id, stepId: w.steps[0].id };
  },
  'workflows.publish': (db) => ({ workflowId: first(db, 'workflows', (w) => w.status === 'paused').id }),
  'workflows.pause': (db) => ({ workflowId: first(db, 'workflows', (w) => w.status === 'published').id }),
  'triggers.create': (db) => ({
    name: 'Smoke trigger',
    eventType: 'lead.created',
    workflowId: first(db, 'workflows').id,
  }),
  'triggers.update_conditions': (db) => ({
    triggerId: first(db, 'triggers').id,
    conditions: [{ field: 'source', op: 'eq', value: 'facebook' }],
  }),
  'triggers.bind_workflow': (db) => ({
    triggerId: first(db, 'triggers', (t) => !t.workflowId).id,
    workflowId: first(db, 'workflows').id,
  }),
  'triggers.enable': (db) => {
    const t = first(db, 'triggers', (x) => !x.enabled);
    t.workflowId = first(db, 'workflows', (w) => w.status === 'published').id;
    return { triggerId: t.id };
  },
  'triggers.disable': (db) => ({ triggerId: first(db, 'triggers', (t) => t.enabled).id }),
  'triggers.test': (db) => ({
    triggerId: first(db, 'triggers', (t) => t.enabled).id,
    payload: { source: 'facebook' },
  }),
  'forms.create': () => ({ name: 'Smoke form', fields: [{ label: 'Email', type: 'email', required: true }] }),
  'forms.add_field': (db) => ({ formId: first(db, 'forms').id, label: 'Company', type: 'text' }),
  'forms.update_field': (db) => {
    const f = first(db, 'forms');
    return { formId: f.id, fieldId: f.fields[2].id, required: true };
  },
  'forms.reorder_fields': (db) => {
    const f = first(db, 'forms');
    return { formId: f.id, fieldIds: [...f.fields].reverse().map((x) => x.id) };
  },
  'forms.publish': (db) => ({ formId: first(db, 'forms', (f) => f.status === 'draft').id }),
  'forms.submit_response': (db) => ({
    formId: first(db, 'forms', (f) => f.status === 'published').id,
    answers: { 'Full name': 'Smoke Person', Email: 'smoke.form@example.com' },
  }),
  'surveys.add_question': (db) => ({
    surveyId: first(db, 'surveys').id,
    text: 'Anything else?',
    type: 'text',
  }),
  'surveys.update_question': (db) => ({
    surveyId: first(db, 'surveys').id,
    questionId: 'q_why',
    text: 'Why that score?',
  }),
  'surveys.set_branching': (db) => ({
    surveyId: first(db, 'surveys').id,
    questionId: 'q_nps',
    rules: [{ ifAnswer: 10, gotoQuestionId: 'q_why' }],
  }),
  'surveys.publish': (db) => {
    const s = first(db, 'surveys', (x) => x.status === 'draft');
    s.questions.push({ id: 'q1', text: 'Q', type: 'text', options: [], order: 1, branching: [] });
    return { surveyId: s.id };
  },
  'surveys.submit_response': (db) => ({
    surveyId: first(db, 'surveys', (s) => s.status === 'open').id,
    answers: { q_nps: 9 },
  }),
  'calendars.create': (db) => ({ name: 'Smoke calendar', hostIds: [first(db, 'users').id] }),
  'calendars.update': (db) => ({ calendarId: first(db, 'calendars').id, description: 'New description' }),
  'calendars.assign_host': (db) => ({
    calendarId: first(db, 'calendars', (c) => !c.hostIds.includes('usr_0001')).id,
    hostId: 'usr_0001',
  }),
  'calendars.archive': (db) => {
    db.insert('calendars', {
      name: 'Unused',
      description: '',
      timezone: 'UTC',
      hostIds: [],
      durationMinutes: 30,
      bufferMinutes: 0,
      visibility: 'public',
      status: 'active',
    });
    return { calendarId: db.col('calendars').at(-1).id };
  },
  'appointments.create': (db) => ({
    calendarId: first(db, 'calendars').id,
    contactId: first(db, 'contacts').id,
    startAt: '2026-10-20T11:00:00.000Z',
    hostId: 'usr_0002',
  }),
  'appointments.reschedule': (db) => ({
    appointmentId: first(db, 'appointments', (a) => a.status === 'booked' && a.startAt > '2026-10-15T10').id,
    startAt: '2026-10-21T13:00:00.000Z',
  }),
  'appointments.cancel': (db) => ({
    appointmentId: first(db, 'appointments', (a) => a.status === 'booked').id,
  }),
  'appointments.assign_host': (db) => {
    const a = first(
      db,
      'appointments',
      (x) => x.status === 'booked' && x.calendarId === 'cal_0001' && x.startAt > '2026-10-16',
    );
    const cal = db.get('calendars', a.calendarId);
    return { appointmentId: a.id, hostId: cal.hostIds.find((h) => h !== a.hostId && h !== 'usr_0006') };
  },
  'appointments.add_attendee': (db) => {
    const a = first(db, 'appointments', (x) => x.status === 'booked');
    return {
      appointmentId: a.id,
      contactId: first(db, 'contacts', (c) => !a.attendees.some((t) => t.contactId === c.id)).id,
    };
  },
  'appointments.remove_attendee': (db) => {
    const a = first(db, 'appointments', (x) => x.status === 'booked');
    const c = first(db, 'contacts', (x) => x.id !== a.contactId);
    a.attendees.push({ contactId: c.id, status: 'invited' });
    return { appointmentId: a.id, contactId: c.id };
  },
  'appointments.mark_no_show': (db) => ({
    appointmentId: first(db, 'appointments', (a) => a.status === 'completed').id,
  }),
  'appointments.mark_completed': (db) => {
    const a = first(db, 'appointments', (x) => x.status === 'booked');
    a.startAt = '2026-10-14T10:00:00.000Z';
    return { appointmentId: a.id };
  },
  'availability.set_weekly_hours': () => ({
    userId: 'usr_0002',
    weeklyHours: { sat: [{ start: '10:00', end: '14:00' }] },
  }),
  'availability.add_date_override': () => ({
    userId: 'usr_0002',
    date: '2026-10-17',
    ranges: [{ start: '10:00', end: '12:00' }],
  }),
  'availability.remove_date_override': (db) => {
    db.get('availability', 'avl_usr_0002').dateOverrides.push({ date: '2026-10-17', ranges: [] });
    return { userId: 'usr_0002', date: '2026-10-17' };
  },
  'availability.block_time': () => ({
    userId: 'usr_0002',
    start: '2026-10-22T09:00:00.000Z',
    end: '2026-10-22T12:00:00.000Z',
    reason: 'Dentist',
  }),
  'availability.remove_block': () => ({ userId: 'usr_0006', blockId: 'blk_0001' }),
  'availability.find_slots': () => ({
    userId: 'usr_0002',
    from: '2026-10-16T00:00:00.000Z',
    to: '2026-10-20T00:00:00.000Z',
    durationMinutes: 30,
  }),
  'availability.check_conflicts': () => ({
    userId: 'usr_0002',
    start: '2026-10-16T10:00:00.000Z',
    end: '2026-10-16T10:30:00.000Z',
  }),
  'booking_pages.create': () => ({ title: 'Smoke booking page' }),
  'booking_pages.update_content': (db) => ({
    bookingPageId: first(db, 'booking_pages').id,
    content: { headline: 'Book now' },
  }),
  'booking_pages.set_intake_fields': (db) => ({
    bookingPageId: first(db, 'booking_pages').id,
    intakeFields: [{ key: 'goal', label: 'Your goal' }],
  }),
  'booking_pages.publish': (db) => {
    const b = first(db, 'booking_pages', (x) => !x.published);
    b.calendarId = 'cal_0001';
    return { bookingPageId: b.id };
  },
  'booking_pages.unpublish': (db) => ({ bookingPageId: first(db, 'booking_pages', (b) => b.published).id }),
  'events.create': () => ({ name: 'Smoke event', startAt: '2026-11-01T16:00:00.000Z', capacity: 20 }),
  'events.update': (db) => ({ eventId: first(db, 'events').id, location: 'Zoom' }),
  'events.set_capacity': (db) => ({ eventId: first(db, 'events').id, capacity: 10 }),
  'events.register': (db) => ({
    eventId: first(db, 'events', (e) => e.capacity > 10).id,
    contactId: db.col('contacts')[30].id,
  }),
  'events.cancel_registration': (db) => {
    const e = first(db, 'events');
    return { eventId: e.id, contactId: e.registrations[0].contactId };
  },
  'events.add_to_waitlist': (db) => ({
    eventId: first(db, 'events').id,
    contactId: db.col('contacts')[30].id,
  }),
  'events.promote_waitlisted': (db) => {
    const e = first(db, 'events');
    e.capacity = 10;
    return { eventId: e.id };
  },
  'events.check_in': (db) => {
    const e = first(db, 'events', (x) => x.status === 'live');
    return { eventId: e.id, contactId: e.registrations.find((r) => r.status === 'registered').contactId };
  },
  'products.create': () => ({ name: 'Smoke Mug', category: 'physical', basePrice: 12, sku: 'MUG-SMOKE' }),
  'products.update': (db) => ({ productId: first(db, 'products').id, description: 'Updated description' }),
  'products.archive': (db) => ({ productId: first(db, 'products', (p) => p.category === 'physical').id }),
  'products.add_variant': (db) => ({
    productId: first(db, 'products', (p) => p.category === 'physical').id,
    name: 'XL',
    sku: 'MER-HOOD-XL',
    inventory: 5,
  }),
  'products.update_variant': (db) => {
    const p = first(db, 'products', (x) => x.variants.length);
    return { productId: p.id, variantId: p.variants[0].id, name: 'Small (S)' };
  },
  'products.set_inventory': (db) => ({
    productId: first(db, 'products', (p) => p.trackInventory).id,
    quantity: 50,
  }),
  'products.inventory_availability': (db) => ({
    productId: first(db, 'products', (p) => p.trackInventory).id,
  }),
  'prices.create': (db) => ({
    productId: first(db, 'products').id,
    label: 'Quarterly',
    amount: 129,
    interval: 'month',
  }),
  'prices.set_currency': (db) => ({
    priceId: first(db, 'prices', (p) => !db.findOne('subscriptions', (s) => s.priceId === p.id)).id,
    currency: 'EUR',
  }),
  'prices.set_interval': (db) => ({
    priceId: first(db, 'prices', (p) => !db.findOne('subscriptions', (s) => s.priceId === p.id)).id,
    interval: 'year',
  }),
  'prices.set_trial': (db) => ({
    priceId: first(db, 'prices', (p) => p.interval !== 'one_time').id,
    trialDays: 30,
  }),
  'prices.set_default': (db) => ({ priceId: first(db, 'prices', (p) => !p.isDefault).id }),
  'prices.archive': (db) => ({
    priceId: db.insert('prices', {
      productId: 'prod_0001',
      label: 'Legacy',
      amount: 39,
      currency: 'USD',
      interval: 'month',
      trialDays: 0,
      isDefault: false,
      status: 'active',
    }).id,
  }),
  'quotes.create': (db) => ({
    contactId: first(db, 'contacts').id,
    lineItems: [{ productId: first(db, 'products').id, quantity: 2 }],
  }),
  'quotes.add_line_item': (db) => ({
    quoteId: first(db, 'quotes', (q) => q.status === 'draft').id,
    productId: first(db, 'products').id,
    quantity: 1,
  }),
  'quotes.update_line_item': (db) => {
    const q = first(db, 'quotes', (x) => x.status === 'draft');
    q.lineItems.push({ id: 'qli_x', productId: null, description: 'X', quantity: 1, unitPrice: 10 });
    return { quoteId: q.id, lineItemId: 'qli_x', quantity: 3 };
  },
  'quotes.set_expiry': (db) => ({
    quoteId: first(db, 'quotes', (q) => q.status === 'draft').id,
    expiresAt: '2026-11-30',
  }),
  'quotes.apply_discount': (db) => ({
    quoteId: first(db, 'quotes', (q) => q.status === 'draft').id,
    type: 'percent',
    value: 10,
  }),
  'quotes.send': (db) => {
    const q = first(db, 'quotes', (x) => x.status === 'draft');
    q.lineItems.push({ id: 'qli_y', productId: null, description: 'Y', quantity: 1, unitPrice: 10 });
    return { quoteId: q.id };
  },
  'quotes.record_acceptance': (db) => ({
    quoteId: first(db, 'quotes', (q) => q.status === 'sent' && q.expiresAt > '2026-10-15').id,
  }),
  'quotes.convert_to_invoice': (db) => ({ quoteId: first(db, 'quotes', (q) => q.status === 'accepted').id }),
  'invoices.create': (db) => ({
    contactId: first(db, 'contacts').id,
    lineItems: [{ productId: first(db, 'products').id, quantity: 1 }],
  }),
  'invoices.add_line_item': (db) => ({
    invoiceId: first(db, 'invoices', (i) => i.status === 'draft').id,
    description: 'Consulting hour',
    unitPrice: 150,
    quantity: 2,
  }),
  'invoices.update_draft': (db) => ({
    invoiceId: first(db, 'invoices', (i) => i.status === 'draft').id,
    notes: 'Thanks!',
  }),
  'invoices.set_due_date': (db) => ({
    invoiceId: first(db, 'invoices', (i) => i.status === 'issued').id,
    dueDate: '2026-11-01',
  }),
  'invoices.issue': (db) => ({ invoiceId: first(db, 'invoices', (i) => i.status === 'draft').id }),
  'invoices.send_reminder': (db) => ({
    invoiceId: first(
      db,
      'invoices',
      (i) =>
        i.status === 'issued' &&
        i.balance > 0 &&
        db.get('contacts', i.contactId).commPrefs.email === 'subscribed',
    ).id,
  }),
  'invoices.void': (db) => ({
    invoiceId: first(db, 'invoices', (i) => i.status === 'issued' && i.amountPaid === 0).id,
  }),
  'payments.create_request': (db) => {
    const i = first(db, 'invoices', (x) => x.status === 'issued' && x.balance > 0);
    return { contactId: i.contactId, invoiceId: i.id };
  },
  'payments.cancel_request': (db) => ({
    paymentRequestId: first(db, 'payment_requests', (r) => r.status === 'pending').id,
  }),
  'payments.record': (db) => {
    const i = first(db, 'invoices', (x) => x.status === 'issued' && x.balance > 0);
    return { contactId: i.contactId, amount: i.balance, invoiceId: i.id, method: 'card' };
  },
  'payments.allocate': (db) => {
    const p = first(db, 'payments', (x) => x.status === 'succeeded' && !x.allocations.length);
    const i = db.insert('invoices', {
      number: 'INV-SMOKE',
      contactId: p.contactId,
      lineItems: [{ id: 'l', description: 'x', quantity: 1, unitPrice: 100 }],
      total: 100,
      amountPaid: 0,
      balance: 100,
      status: 'issued',
      dueDate: FUTURE,
    });
    return { paymentId: p.id, invoiceId: i.id };
  },
  'payments.remove_allocation': (db) => {
    const p = first(db, 'payments', (x) => x.allocations.length);
    return { paymentId: p.id, invoiceId: p.allocations[0].invoiceId };
  },
  'payments.generate_receipt': (db) => ({
    paymentId: first(db, 'payments', (p) => p.status === 'succeeded').id,
  }),
  'payments.failure_details': (db) => ({ paymentId: first(db, 'payments', (p) => p.status === 'failed').id }),
  'subscriptions.create': (db) => ({
    contactId: db.col('contacts')[50].id,
    priceId: first(db, 'prices', (p) => p.interval === 'month').id,
  }),
  'subscriptions.change_plan': (db) => {
    const s = first(db, 'subscriptions', (x) => x.status === 'active');
    return {
      subscriptionId: s.id,
      priceId: first(db, 'prices', (p) => p.interval !== 'one_time' && p.id !== s.priceId).id,
    };
  },
  'subscriptions.update_quantity': (db) => ({
    subscriptionId: first(db, 'subscriptions', (s) => s.status === 'active').id,
    quantity: 7,
  }),
  'subscriptions.set_trial_end': (db) => ({
    subscriptionId: first(db, 'subscriptions', (s) => s.status === 'trialing').id,
    trialEndsAt: '2026-10-30T00:00:00.000Z',
  }),
  'subscriptions.pause': (db) => ({
    subscriptionId: first(db, 'subscriptions', (s) => s.status === 'active').id,
  }),
  'subscriptions.resume': (db) => ({
    subscriptionId: first(db, 'subscriptions', (s) => s.status === 'paused').id,
  }),
  'subscriptions.cancel': (db) => ({
    subscriptionId: first(db, 'subscriptions', (s) => s.status === 'active').id,
  }),
  'coupons.create': () => ({ code: 'SMOKE15', type: 'percent', value: 15 }),
  'coupons.set_discount_value': (db) => ({ couponId: first(db, 'coupons').id, value: 25 }),
  'coupons.set_validity_window': (db) => ({
    couponId: first(db, 'coupons').id,
    validTo: '2026-12-31T00:00:00.000Z',
  }),
  'coupons.set_redemption_limit': (db) => ({ couponId: first(db, 'coupons').id, redemptionLimit: 500 }),
  'coupons.restrict_to_products': (db) => ({
    couponId: first(db, 'coupons').id,
    productIds: [first(db, 'products').id],
  }),
  'coupons.validate_for_order': (db) => ({
    code: 'FALL20',
    orderId: first(db, 'orders', (o) => o.lineItems.length).id,
  }),
  'orders.create_draft': (db) => ({ contactId: first(db, 'contacts').id }),
  'orders.add_line_item': (db) => ({
    orderId: first(db, 'orders', (o) => o.status === 'draft').id,
    productId: first(db, 'products', (p) => p.category === 'software').id,
    quantity: 1,
  }),
  'orders.update_quantity': (db) => {
    const o = first(db, 'orders', (x) => x.status === 'draft');
    return { orderId: o.id, lineItemId: o.lineItems[0].id, quantity: 1 };
  },
  'orders.set_shipping_address': (db) => ({
    orderId: first(db, 'orders', (o) => o.status === 'draft').id,
    shippingAddress: {
      line1: '1 Main St',
      city: 'Austin',
      region: 'US-TX',
      postalCode: '73301',
      country: 'US',
    },
  }),
  'orders.apply_coupon': (db) => ({
    orderId: first(db, 'orders', (o) => o.status === 'draft').id,
    code: 'FALL20',
  }),
  'orders.submit': (db) => {
    const o = first(db, 'orders', (x) => x.status === 'draft');
    o.shippingAddress = { line1: '1 Main', city: 'SF', region: 'US-CA', postalCode: '94105', country: 'US' };
    const p = db.get('products', o.lineItems[0].productId);
    p.inventory = 100;
    return { orderId: o.id };
  },
  'orders.cancel': (db) => ({ orderId: first(db, 'orders', (o) => o.status === 'submitted').id }),
  'orders.mark_fulfilled': (db) => ({
    orderId: first(db, 'orders', (o) => o.status === 'submitted').id,
    trackingNumber: '1Z999',
  }),
  'refunds.create': (db) => ({
    paymentId: first(
      db,
      'payments',
      (p) => p.status === 'succeeded' && !db.findOne('refunds', (r) => r.paymentId === p.id),
    ).id,
    amount: 10,
    reason: 'Goodwill credit',
  }),
  'refunds.set_reason': (db) => ({
    refundId: first(db, 'refunds', (r) => r.status === 'requested').id,
    reason: 'Duplicate charge',
  }),
  'refunds.set_partial_amount': (db) => ({
    refundId: first(db, 'refunds', (r) => r.status === 'requested').id,
    amount: 15,
  }),
  'refunds.approve': (db) => ({ refundId: first(db, 'refunds', (r) => r.status === 'requested').id }),
  'refunds.reject': (db) => ({ refundId: first(db, 'refunds', (r) => r.status === 'requested').id }),
  'refunds.execute': (db) => ({ refundId: first(db, 'refunds', (r) => r.status === 'approved').id }),
  'tax_rules.create': () => ({ name: 'Texas sales tax', rate: 6.25, region: 'US-TX' }),
  'tax_rules.set_region': (db) => ({ taxRuleId: first(db, 'tax_rules').id, region: 'US-OR' }),
  'tax_rules.calculate_for_order': (db) => ({ orderId: first(db, 'orders', (o) => o.shippingAddress).id }),
  'websites.create': () => ({ name: 'Smoke Site', domain: 'smoke-site.example' }),
  'websites.add_page': (db) => ({ websiteId: first(db, 'websites').id, title: 'Careers' }),
  'websites.set_home_page': () => ({ websiteId: 'site_0001', pageId: 'page_about' }),
  'websites.update_navigation': () => ({
    websiteId: 'site_0001',
    items: [{ label: 'About', pageId: 'page_about' }],
  }),
  'websites.set_seo_defaults': (db) => ({
    websiteId: first(db, 'websites').id,
    seo: { description: 'Best CRM' },
  }),
  'websites.publish': (db) => {
    const w = first(db, 'websites', (x) => !x.published);
    w.pages = [{ id: 'p1', title: 'Home', path: '/' }];
    w.homePageId = 'p1';
    return { websiteId: w.id };
  },
  'websites.unpublish': (db) => ({ websiteId: first(db, 'websites', (w) => w.published).id }),
  'funnels.create': () => ({ name: 'Smoke funnel' }),
  'funnels.add_step': (db) => ({
    funnelId: first(db, 'funnels').id,
    name: 'Upsell',
    landingPageId: first(db, 'landing_pages').id,
  }),
  'funnels.reorder_steps': (db) => {
    const f = first(db, 'funnels');
    return { funnelId: f.id, stepIds: [...f.steps].reverse().map((s) => s.id) };
  },
  'funnels.remove_step': (db) => {
    const f = first(db, 'funnels');
    return { funnelId: f.id, stepId: f.steps.at(-1).id };
  },
  'funnels.link_landing_page': (db) => {
    const f = first(db, 'funnels');
    return { funnelId: f.id, stepId: f.steps[1].id, landingPageId: first(db, 'landing_pages').id };
  },
  'funnels.set_goal': (db) => ({ funnelId: first(db, 'funnels').id, goal: { type: 'purchase', target: 50 } }),
  'funnels.publish': (db) => {
    const f = first(db, 'funnels', (x) => !x.published);
    f.goal = { type: 'booking' };
    return { funnelId: f.id };
  },
  'landing_pages.create': () => ({ title: 'Smoke Landing' }),
  'landing_pages.update_content': (db) => ({
    landingPageId: first(db, 'landing_pages').id,
    content: { headline: 'New headline' },
  }),
  'landing_pages.reorder_sections': (db) => {
    const p = first(db, 'landing_pages');
    return { landingPageId: p.id, sectionIds: [...p.sections].reverse().map((s) => s.id) };
  },
  'landing_pages.attach_form': (db) => ({
    landingPageId: first(db, 'landing_pages', (p) => !p.formId).id,
    formId: first(db, 'forms').id,
  }),
  'landing_pages.set_seo': (db) => ({
    landingPageId: first(db, 'landing_pages').id,
    seo: { title: 'SEO title' },
  }),
  'landing_pages.publish': (db) => ({ landingPageId: first(db, 'landing_pages', (p) => !p.published).id }),
  'landing_pages.unpublish': (db) => ({ landingPageId: first(db, 'landing_pages', (p) => p.published).id }),
  'blogs.create_post': (db) => ({ title: 'Smoke post', body: 'Body', authorId: first(db, 'users').id }),
  'blogs.update_post': (db) => ({ postId: first(db, 'blog_posts').id, body: 'New body' }),
  'blogs.set_seo': (db) => ({ postId: first(db, 'blog_posts').id, seo: { description: 'Meta' } }),
  'blogs.schedule': (db) => ({
    postId: first(db, 'blog_posts', (p) => p.status === 'draft').id,
    publishAt: FUTURE,
  }),
  'blogs.publish': (db) => ({ postId: first(db, 'blog_posts', (p) => p.status === 'draft').id }),
  'blogs.unpublish': (db) => ({ postId: first(db, 'blog_posts', (p) => p.status === 'published').id }),
  'media.upload': () => ({ name: 'smoke.png', mime: 'image/png', sizeKb: 120 }),
  'media.rename': (db) => ({ assetId: first(db, 'media_assets').id, name: 'renamed.jpg' }),
  'media.set_alt_text': (db) => ({
    assetId: first(db, 'media_assets', (a) => a.mime.startsWith('image/')).id,
    altText: 'A hero image',
  }),
  'media.move_to_folder': (db) => ({ assetId: first(db, 'media_assets').id, folder: '/archive' }),
  'media.replace_file': (db) => ({ assetId: first(db, 'media_assets').id, sizeKb: 300 }),
  'media.delete_unreferenced': (db) => ({
    assetId: first(db, 'media_assets', (a) => !a.references.length).id,
  }),
  'courses.create': (db) => ({ title: 'Smoke course', instructorId: first(db, 'users').id }),
  'courses.update': (db) => ({ courseId: first(db, 'courses').id, description: 'Updated' }),
  'courses.add_section': (db) => ({ courseId: first(db, 'courses').id, title: 'Bonus' }),
  'courses.reorder_sections': (db) => {
    const c = first(db, 'courses');
    return { courseId: c.id, sectionIds: [...c.sections].reverse().map((s) => s.id) };
  },
  'courses.set_prerequisites': (db) => ({
    courseId: db.col('courses')[2].id,
    prerequisiteIds: [db.col('courses')[0].id],
  }),
  'courses.publish': (db) => {
    const c = db.col('courses')[2];
    c.instructorId = 'usr_0011';
    db.col('lessons')[0].courseId = c.id;
    return { courseId: c.id };
  },
  'courses.archive': (db) => ({ courseId: db.col('courses')[2].id }),
  'lessons.create': (db) => ({ courseId: first(db, 'courses').id, title: 'Smoke lesson', content: 'Hi' }),
  'lessons.update_content': (db) => ({
    lessonId: first(db, 'lessons').id,
    content: 'Updated lesson content',
  }),
  'lessons.attach_media': (db) => ({
    lessonId: first(db, 'lessons').id,
    assetId: first(db, 'media_assets').id,
  }),
  'lessons.move_to_section': (db) => {
    const l = first(db, 'lessons');
    return {
      lessonId: l.id,
      sectionId: db.get('courses', l.courseId).sections.find((s) => s.id !== l.sectionId).id,
    };
  },
  'lessons.set_release_schedule': (db) => ({ lessonId: first(db, 'lessons').id, releaseAt: FUTURE }),
  'lessons.set_completion_criteria': (db) => ({
    lessonId: first(db, 'lessons').id,
    completionCriteria: { type: 'quiz', passScore: 80 },
  }),
  'lessons.publish': (db) => ({ lessonId: first(db, 'lessons', (l) => !l.published).id }),
  'lessons.unpublish': (db) => ({ lessonId: first(db, 'lessons', (l) => l.published).id }),
  'enrollments.enroll': (db) => ({
    contactId: db.col('contacts')[5].id,
    courseId: first(db, 'courses', (c) => c.status === 'published' && !c.prerequisites.length).id,
  }),
  'enrollments.set_expiry': (db) => ({
    enrollmentId: first(db, 'enrollments').id,
    expiresAt: '2027-01-01T00:00:00.000Z',
  }),
  'enrollments.suspend': (db) => ({
    enrollmentId: first(db, 'enrollments', (e) => e.status === 'active').id,
  }),
  'enrollments.resume': (db) => ({
    enrollmentId: first(db, 'enrollments', (e) => e.status === 'suspended').id,
  }),
  'enrollments.revoke': (db) => ({ enrollmentId: first(db, 'enrollments', (e) => e.status === 'active').id }),
  'enrollments.record_lesson_completion': (db) => {
    const e = db.col('enrollments')[1];
    return {
      enrollmentId: e.id,
      lessonId: db.find(
        'lessons',
        (l) => l.courseId === e.courseId && l.published && !e.completedLessonIds.includes(l.id),
      )[0].id,
    };
  },
  'enrollments.issue_certificate': (db) => ({ enrollmentId: db.col('enrollments')[0].id }),
  'communities.create': () => ({ name: 'Smoke Community' }),
  'communities.update_guidelines': (db) => ({
    communityId: first(db, 'communities').id,
    guidelines: 'Be excellent to each other.',
  }),
  'communities.create_channel': (db) => ({ communityId: first(db, 'communities').id, name: 'smoke-chat' }),
  'communities.join': (db) => {
    const c = first(db, 'communities');
    return { communityId: c.id, contactId: first(db, 'contacts', (x) => !c.memberIds.includes(x.id)).id };
  },
  'communities.leave': (db) => {
    const c = first(db, 'communities');
    return { communityId: c.id, contactId: c.memberIds[0] };
  },
  'communities.create_post': (db) => {
    const c = first(db, 'communities');
    return {
      communityId: c.id,
      channelId: c.channels[0].id,
      authorContactId: c.memberIds[0],
      body: 'Hello community',
    };
  },
  'communities.reply_to_post': (db) => {
    const p = first(db, 'community_posts', (x) => x.status === 'visible');
    return {
      postId: p.id,
      authorContactId: db.get('communities', p.communityId).memberIds[1],
      body: 'Welcome!',
    };
  },
  'communities.pin_post': (db) => ({
    postId: first(db, 'community_posts', (p) => !p.pinned && p.status === 'visible').id,
  }),
  'communities.remove_reported_post': (db) => ({
    postId: first(db, 'community_posts', (p) => p.reported).id,
  }),
  'memberships.create_plan': () => ({ name: 'Smoke Plan' }),
  'memberships.add_entitlement': (db) => ({
    planId: db.col('membership_plans')[1].id,
    type: 'course',
    resourceId: first(db, 'courses').id,
  }),
  'memberships.remove_entitlement': (db) => {
    const p = first(db, 'membership_plans');
    return { planId: p.id, resourceId: p.entitlements[0].id };
  },
  'memberships.grant': (db) => ({
    planId: first(db, 'membership_plans').id,
    contactId: db.col('contacts')[40].id,
  }),
  'memberships.set_expiry': (db) => ({
    membershipId: first(db, 'memberships', (m) => m.status === 'active').id,
    expiresAt: '2027-01-01T00:00:00.000Z',
  }),
  'memberships.revoke': (db) => ({ membershipId: first(db, 'memberships', (m) => m.status === 'active').id }),
  'memberships.check_access': (db) => {
    const m = first(db, 'memberships', (x) => x.status === 'active');
    return { contactId: m.contactId, resourceId: db.get('membership_plans', m.planId).entitlements[0].id };
  },
  'reviews.create_request': (db) => ({ contactId: db.col('contacts')[10].id, channel: 'email' }),
  'reviews.send_request': (db) => ({
    reviewRequestId: first(db, 'review_requests', (r) => r.status === 'draft').id,
  }),
  'reviews.cancel_request': (db) => ({
    reviewRequestId: first(db, 'review_requests', (r) => r.status === 'draft').id,
  }),
  'reviews.record_review': (db) => ({ contactId: first(db, 'contacts').id, rating: 5, text: 'Great!' }),
  'reviews.draft_response': (db) => ({ reviewId: first(db, 'reviews').id, body: 'Thank you!' }),
  'reviews.publish_response': (db) => {
    const r = first(db, 'reviews');
    r.response = { body: 'Thanks', status: 'draft' };
    return { reviewId: r.id };
  },
  'listings.create': () => ({ directory: 'Apple Maps', name: 'Northwind CRM' }),
  'listings.update_address': (db) => ({ listingId: first(db, 'listings').id, address: '1 New Street, SF' }),
  'listings.set_hours': (db) => ({ listingId: first(db, 'listings').id, hours: { sat: '10:00-14:00' } }),
  'listings.set_categories': (db) => ({ listingId: first(db, 'listings').id, categories: ['CRM software'] }),
  'listings.publish': (db) => ({ listingId: first(db, 'listings', (l) => l.address && l.phone).id }),
  'tickets.create': (db) => ({
    subject: 'Smoke ticket',
    requesterContactId: first(db, 'contacts').id,
    priority: 'high',
  }),
  'tickets.update_status': (db) => ({
    ticketId: first(db, 'tickets', (t) => t.status === 'open').id,
    status: 'pending',
  }),
  'tickets.reply_to_requester': (db) => ({
    ticketId: first(db, 'tickets', (t) => t.status === 'open').id,
    body: 'We are on it.',
  }),
  'tickets.link_contact': (db) => {
    const t = first(db, 'tickets');
    return {
      ticketId: t.id,
      requesterContactId: first(db, 'contacts', (c) => c.id !== t.requesterContactId).id,
    };
  },
  'users.invite': () => ({ name: 'Smoke User', email: 'smoke.user@example.com', role: 'sales_rep' }),
  'users.update_profile': (db) => ({ userId: first(db, 'users').id, title: 'VP Sales' }),
  'users.assign_role': () => ({ userId: 'usr_0002', role: 'marketing' }),
  'users.revoke_role': (db) => {
    db.get('users', 'usr_0002').roles.push('viewer');
    return { userId: 'usr_0002', role: 'viewer' };
  },
  'users.deactivate': () => ({ userId: 'usr_0003' }),
  'users.reactivate': () => ({ userId: 'usr_0005' }),
  'teams.create': (db) => ({ name: 'Smoke Team', memberIds: [first(db, 'users').id] }),
  'teams.add_member': (db) => ({ teamId: db.col('teams')[2].id, userId: 'usr_0001' }),
  'teams.remove_member': (db) => ({ teamId: db.col('teams')[0].id, userId: 'usr_0003' }),
  'teams.assign_manager': (db) => ({ teamId: db.col('teams')[0].id, managerId: 'usr_0002' }),
  'reports.create': () => ({ name: 'Smoke report', metric: 'leads_created', groupBy: 'source' }),
  'reports.update_filters': (db) => ({
    reportId: first(db, 'reports').id,
    filters: [{ field: 'source', value: 'facebook' }],
  }),
  'reports.set_date_range': (db) => ({
    reportId: first(db, 'reports').id,
    dateRange: { preset: 'last_90_days' },
  }),
  'reports.run': () => ({
    metric: 'leads_created',
    groupBy: 'source',
    dateRange: { preset: 'last_30_days' },
  }),
  'reports.compare_periods': () => ({ metric: 'revenue', days: 30 }),
  'reports.schedule_delivery': (db) => ({
    reportId: first(db, 'reports').id,
    frequency: 'weekly',
    recipients: ['alex@northwind.example'],
  }),
};
