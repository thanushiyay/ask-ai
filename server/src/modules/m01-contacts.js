import { z, s, ref, out, crud, action, fail, fullName, defined } from '../core/kit.js';

const archived = (r) => r.status === 'archived';

export default {
  id: 'contacts',
  code: 'M01',
  title: 'Contacts',
  description: 'Manage people and their CRM profiles.',
  keywords: ['contact', 'person', 'people', 'customer', 'client', 'profile', 'crm'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create contact',
      collection: 'contacts',
      description: 'Create a new contact (person) with name, email, phone and optional owner/company/tags.',
      fields: {
        firstName: s.text('First name'),
        lastName: z.string().optional().meta({ description: 'Last name' }),
        email: s.email().optional(),
        phone: s.phone().optional(),
        companyId: ref('companies').optional(),
        ownerId: ref('users', 'User who owns this contact').optional(),
        tags: s.tags().optional(),
        source: z
          .string()
          .optional()
          .meta({ description: 'Acquisition source, e.g. website, referral, facebook' }),
      },
      validate(args, ctx) {
        if (!args.email && !args.phone)
          throw fail.validation('A contact needs at least an email or a phone number');
        if (
          args.email &&
          ctx.db.findOne(
            'contacts',
            (c) => c.email?.toLowerCase() === args.email.toLowerCase() && c.status !== 'archived',
          )
        ) {
          throw fail.conflict(`A contact with email ${args.email} already exists`);
        }
        if (args.ownerId) ctx.db.must('users', args.ownerId);
        if (args.companyId) ctx.db.must('companies', args.companyId);
      },
      defaults: (a) => ({
        name: fullName(a),
        lastName: a.lastName ?? '',
        email: a.email ?? null,
        phone: a.phone ?? null,
        tags: [],
        status: 'active',
        ownerId: null,
        companyId: null,
        source: 'manual',
        commPrefs: { email: 'subscribed', sms: 'opted_in', preferredChannel: 'email', doNotContact: false },
        relationships: [],
        customFields: {},
        taxExempt: false,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get contact details',
      collection: 'contacts',
      idField: 'contactId',
      description: 'Get the full profile of one contact by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search contacts',
      collection: 'contacts',
      description:
        'Search contacts by name/email text, owner, company, tag, source, or created date range. Returns matching contacts.',
      text: ['name', 'email', 'phone'],
      filters: {
        ownerId: ref('users'),
        companyId: ref('companies'),
        tags: z.string().meta({ description: 'Has this tag' }),
        source: z.string(),
        status: z.enum(['active', 'archived']),
      },
      extraInput: { unowned: z.boolean().optional().meta({ description: 'Only contacts with no owner' }) },
      where: (r, a) => (a.unowned ? !r.ownerId : true),
      hide: archived,
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update contact details',
      collection: 'contacts',
      idField: 'contactId',
      description: "Update a contact's name, email, phone, company or source.",
      fields: {
        firstName: z.string().min(1),
        lastName: z.string(),
        email: s.email(),
        phone: s.phone(),
        companyId: ref('companies'),
        source: z.string(),
      },
      guard(rec, a, ctx) {
        if (archived(rec)) throw fail.state(`Contact ${rec.id} is archived`);
        if (a.companyId) ctx.db.must('companies', a.companyId);
        return {
          name: fullName({ firstName: a.firstName ?? rec.firstName, lastName: a.lastName ?? rec.lastName }),
        };
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'archive',
      title: 'Archive contact',
      collection: 'contacts',
      idField: 'contactId',
      from: ['active'],
      to: 'archived',
      effect: 'destructive',
      description: 'Archive (soft-delete) a contact so it no longer appears in searches.',
      patch: (a, r, ctx) => ({ archivedAt: ctx.clock.nowIso() }),
    }),
    action({
      code: 'A06',
      name: 'merge_duplicates',
      title: 'Merge duplicate contacts',
      effect: 'destructive',
      description:
        'Merge a duplicate contact into a primary contact. Moves tasks, notes, conversations, appointments, invoices and leads to the primary, unions tags, then archives the duplicate.',
      input: z.object({
        primaryContactId: ref('contacts', 'Contact to keep'),
        duplicateContactId: ref('contacts', 'Contact to merge away'),
      }),
      output: out.shape({ id: z.string(), mergedFrom: z.string(), moved: z.record(z.string(), z.number()) }),
      handler({ primaryContactId, duplicateContactId }, { db, actor }) {
        if (primaryContactId === duplicateContactId)
          throw fail.validation('Cannot merge a contact into itself');
        const primary = db.must('contacts', primaryContactId);
        const dup = db.must('contacts', duplicateContactId);
        if (dup.status === 'archived') throw fail.state(`Contact ${dup.id} is already archived`);
        const moved = {};
        for (const col of [
          'tasks',
          'notes',
          'conversations',
          'appointments',
          'invoices',
          'leads',
          'opportunities',
          'emails',
          'sms',
        ]) {
          const rows = db.find(
            col,
            (r) => r.contactId === dup.id || r.recordRefs?.some?.((x) => x.id === dup.id),
          );
          rows.forEach((r) => {
            if (r.contactId === dup.id) r.contactId = primary.id;
            r.recordRefs?.forEach((x) => {
              if (x.id === dup.id) x.id = primary.id;
            });
          });
          if (rows.length) moved[col] = rows.length;
        }
        db.update(
          'contacts',
          primary.id,
          {
            tags: [...new Set([...primary.tags, ...dup.tags])],
            phone: primary.phone ?? dup.phone,
            email: primary.email ?? dup.email,
          },
          actor,
        );
        db.update('contacts', dup.id, { status: 'archived', mergedInto: primary.id }, actor);
        return { ...db.get('contacts', primary.id), mergedFrom: dup.id, moved };
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'assign_owner',
      title: 'Assign contact owner',
      collection: 'contacts',
      idField: 'contactId',
      field: 'ownerId',
      schema: ref('users', 'User to own the contact'),
      description: 'Assign a user as the owner of a contact.',
      guard(rec, a, { db }) {
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status} and cannot own records`);
      },
    }),
    action({
      code: 'A08',
      name: 'set_communication_preferences',
      title: 'Set communication preferences',
      effect: 'write',
      description:
        "Set a contact's email subscription, SMS opt-in, preferred channel and do-not-contact flag.",
      input: z.object({
        contactId: ref('contacts'),
        email: z.enum(['subscribed', 'unsubscribed']).optional(),
        sms: z.enum(['opted_in', 'opted_out']).optional(),
        preferredChannel: z.enum(['email', 'sms', 'phone']).optional(),
        doNotContact: z.boolean().optional(),
      }),
      handler({ contactId, ...prefs }, { db, actor }) {
        const c = db.must('contacts', contactId);
        if (!Object.values(prefs).some((v) => v !== undefined))
          throw fail.validation('Provide at least one preference');
        return db.update('contacts', c.id, { commPrefs: { ...c.commPrefs, ...defined(prefs) } }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'add_relationship',
      title: 'Add contact relationship',
      effect: 'write',
      description: 'Link two contacts with a relationship such as spouse, colleague, assistant, referred_by.',
      input: z.object({
        contactId: ref('contacts'),
        relatedContactId: ref('contacts'),
        type: z.enum(['spouse', 'colleague', 'assistant', 'manager', 'referred_by', 'family', 'other']),
      }),
      handler({ contactId, relatedContactId, type }, { db, actor }) {
        if (contactId === relatedContactId) throw fail.validation('A contact cannot be related to itself');
        const c = db.must('contacts', contactId);
        db.must('contacts', relatedContactId);
        if (c.relationships.some((r) => r.contactId === relatedContactId && r.type === type))
          throw fail.conflict('Relationship already exists');
        return db.update(
          'contacts',
          c.id,
          { relationships: [...c.relationships, { contactId: relatedContactId, type }] },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'activity_timeline',
      title: 'View contact activity timeline',
      effect: 'read',
      description:
        'Chronological activity for a contact: messages, emails, SMS, appointments, tasks, notes, invoices and payments.',
      input: z.object({ contactId: ref('contacts'), limit: s.limit() }),
      output: out.shape({
        contactId: z.string(),
        events: z.array(
          z.object({ at: z.string().nullable(), type: z.string(), summary: z.string(), refId: z.string() }),
        ),
      }),
      handler({ contactId, limit = 50 }, { db }) {
        const c = db.must('contacts', contactId);
        const ev = [];
        const push = (at, type, summary, refId) => ev.push({ at: at ?? null, type, summary, refId });
        db.find('conversations', (r) => r.contactId === c.id).forEach((cv) =>
          cv.messages.forEach((m) => push(m.at, `message_${m.direction}`, m.body.slice(0, 80), cv.id)),
        );
        db.find('emails', (r) => r.contactId === c.id).forEach((e) =>
          push(e.sentAt ?? e.createdAt, `email_${e.status}`, e.subject, e.id),
        );
        db.find('sms', (r) => r.contactId === c.id).forEach((e) =>
          push(e.sentAt ?? e.createdAt, `sms_${e.status}`, e.body.slice(0, 80), e.id),
        );
        db.find('appointments', (r) => r.contactId === c.id).forEach((a) =>
          push(a.startAt, `appointment_${a.status}`, a.title, a.id),
        );
        db.find('tasks', (r) => r.contactId === c.id).forEach((t) =>
          push(t.createdAt, `task_${t.status}`, t.title, t.id),
        );
        db.find('notes', (r) => r.recordRefs.some((x) => x.id === c.id)).forEach((n) =>
          push(n.createdAt, 'note', n.body.slice(0, 80), n.id),
        );
        db.find('invoices', (r) => r.contactId === c.id).forEach((i) =>
          push(
            i.issuedAt ?? i.createdAt,
            `invoice_${i.status}`,
            `${i.number} ${i.total} ${i.currency}`,
            i.id,
          ),
        );
        db.find('payments', (r) => r.contactId === c.id).forEach((p) =>
          push(p.processedAt, `payment_${p.status}`, `${p.amount} ${p.currency}`, p.id),
        );
        ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
        return { contactId: c.id, name: c.name, events: ev.slice(0, limit) };
      },
    }),
  ],
};
