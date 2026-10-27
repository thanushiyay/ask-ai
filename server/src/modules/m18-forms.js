import { z, ref, crud, action, fail, child, listResult, out } from '../core/kit.js';

const FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'number', 'dropdown', 'checkbox', 'date'];
const draftable = (f) => f; // forms stay editable; publishing just exposes them

export default {
  id: 'forms',
  code: 'M18',
  title: 'Forms',
  description: 'Capture structured input through reusable forms.',
  keywords: ['form', 'web form', 'signup form', 'contact form', 'submission', 'fields', 'intake'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create form',
      effect: 'write',
      description: 'Create a draft form, optionally with fields (label, type, required).',
      input: z.object({
        name: z.string().min(1),
        fields: z
          .array(
            z.object({
              label: z.string().min(1),
              type: z.enum(FIELD_TYPES),
              required: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
      handler({ name, fields }, { db, actor }) {
        if (db.findOne('forms', (f) => f.name.toLowerCase() === name.toLowerCase()))
          throw fail.conflict(`Form "${name}" exists`);
        return db.insert(
          'forms',
          {
            name,
            fields: (fields ?? []).map((f, i) => ({
              id: `fld_${db.nextId('_child').split('_').pop()}`,
              label: f.label,
              type: f.type,
              required: f.required ?? false,
              order: i + 1,
            })),
            validation: {},
            status: 'draft',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get form definition',
      collection: 'forms',
      idField: 'formId',
      description: 'Get a form with its fields and status.',
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List forms',
      collection: 'forms',
      description: 'List forms by name or status.',
      text: ['name'],
      filters: { status: z.enum(['draft', 'published']) },
    }),
    action({
      code: 'A04',
      name: 'add_field',
      title: 'Add form field',
      effect: 'write',
      description: 'Add a field to a form.',
      input: z.object({
        formId: ref('forms'),
        label: z.string().min(1),
        type: z.enum(FIELD_TYPES),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
      }),
      handler({ formId, label, type, required, options }, { db, actor }) {
        const f = draftable(db.must('forms', formId));
        if (f.fields.some((x) => x.label.toLowerCase() === label.toLowerCase()))
          throw fail.conflict(`Field "${label}" already exists`);
        if (type === 'dropdown' && !options?.length) throw fail.validation('Dropdown fields need options');
        return db.update(
          'forms',
          f.id,
          {
            fields: [
              ...f.fields,
              {
                id: `fld_${db.nextId('_child').split('_').pop()}`,
                label,
                type,
                required: required ?? false,
                options: options ?? [],
                order: f.fields.length + 1,
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A05',
      name: 'update_field',
      title: 'Update form field',
      effect: 'write',
      description: "Change a form field's label, type or required flag.",
      input: z.object({
        formId: ref('forms'),
        fieldId: z.string().min(1),
        label: z.string().optional(),
        type: z.enum(FIELD_TYPES).optional(),
        required: z.boolean().optional(),
      }),
      handler({ formId, fieldId, ...patch }, { db, actor }) {
        const f = db.must('forms', formId);
        const fld = child(f.fields, fieldId, 'form field');
        Object.entries(patch).forEach(([k, v]) => v !== undefined && (fld[k] = v));
        return db.update('forms', f.id, { fields: f.fields }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'reorder_fields',
      title: 'Reorder form fields',
      effect: 'write',
      description: 'Reorder fields by listing every field ID in the new order.',
      input: z.object({ formId: ref('forms'), fieldIds: z.array(z.string()).min(1) }),
      handler({ formId, fieldIds }, { db, actor }) {
        const f = db.must('forms', formId);
        if (
          [...fieldIds].sort().join() !==
          f.fields
            .map((x) => x.id)
            .sort()
            .join()
        )
          throw fail.validation('fieldIds must include every field exactly once', {
            fields: f.fields.map((x) => ({ id: x.id, label: x.label })),
          });
        return db.update(
          'forms',
          f.id,
          { fields: fieldIds.map((id, i) => ({ ...f.fields.find((x) => x.id === id), order: i + 1 })) },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'set_validation',
      title: 'Set form validation rules',
      collection: 'forms',
      idField: 'formId',
      field: 'validation',
      schema: z.object({
        spamProtection: z.boolean().optional(),
        requireConsent: z.boolean().optional(),
        allowedEmailDomains: z.array(z.string()).optional(),
      }),
      description: 'Set form-level validation (spam protection, consent checkbox, allowed email domains).',
    }),
    action({
      code: 'A08',
      name: 'publish',
      title: 'Publish form',
      effect: 'external',
      description: 'Publish a form so it can accept public submissions. Needs at least one field.',
      input: z.object({ formId: ref('forms') }),
      handler({ formId }, { db, actor }) {
        const f = db.must('forms', formId);
        if (f.status === 'published') throw fail.conflict(`Form ${f.name} is already published`);
        if (!f.fields.length) throw fail.state(`Form ${f.name} has no fields`);
        return db.update(
          'forms',
          f.id,
          { status: 'published', url: `https://forms.northwind.example/${f.id}` },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'submit_response',
      title: 'Submit simulated form response',
      effect: 'write',
      description:
        'Simulate a form submission (answers keyed by field ID or label). Validates required fields and links/creates the contact by email.',
      input: z.object({ formId: ref('forms'), answers: z.record(z.string(), z.any()) }),
      handler({ formId, answers }, { db, actor }) {
        const f = db.must('forms', formId);
        if (f.status !== 'published') throw fail.state(`Form ${f.name} is not published`);
        const byId = {};
        for (const [k, v] of Object.entries(answers)) {
          const fld = f.fields.find((x) => x.id === k || x.label.toLowerCase() === k.toLowerCase());
          if (!fld) throw fail.validation(`Unknown field "${k}"`, { fields: f.fields.map((x) => x.label) });
          byId[fld.id] = v;
        }
        const missing = f.fields
          .filter((x) => x.required && (byId[x.id] === undefined || byId[x.id] === ''))
          .map((x) => x.label);
        if (missing.length) throw fail.validation(`Missing required fields: ${missing.join(', ')}`);
        const emailFld = f.fields.find((x) => x.type === 'email');
        const email = emailFld ? byId[emailFld.id] : null;
        if (email && !/^\S+@\S+\.\S+$/.test(email))
          throw fail.validation('Email answer is not a valid email');
        let contact = email
          ? db.findOne('contacts', (c) => c.email?.toLowerCase() === String(email).toLowerCase())
          : null;
        if (!contact && email) {
          const nameFld = f.fields.find((x) => /name/i.test(x.label));
          const full = String(byId[nameFld?.id] ?? email.split('@')[0]);
          const [firstName, ...rest] = full.split(' ');
          contact = db.insert(
            'contacts',
            {
              firstName,
              lastName: rest.join(' '),
              name: full,
              email,
              phone: null,
              companyId: null,
              ownerId: null,
              tags: [],
              status: 'active',
              source: 'website',
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
        return db.insert(
          'form_submissions',
          { formId: f.id, contactId: contact?.id ?? null, answers: byId },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'list_submissions',
      title: 'List form submissions',
      effect: 'read',
      description: 'List submissions for a form, optionally within a date range.',
      input: z.object({
        formId: ref('forms'),
        submittedFrom: z.string().optional(),
        submittedTo: z.string().optional(),
      }),
      output: out.list,
      handler({ formId, submittedFrom, submittedTo }, { db }) {
        db.must('forms', formId);
        return listResult(
          db.find(
            'form_submissions',
            (x) =>
              x.formId === formId &&
              (!submittedFrom || x.createdAt >= submittedFrom) &&
              (!submittedTo || x.createdAt < submittedTo),
          ),
          200,
        );
      },
    }),
  ],
};
