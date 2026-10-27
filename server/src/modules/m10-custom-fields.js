import { z, ref, crud, action, fail } from '../core/kit.js';
import { COLLECTION_FOR } from './_shared.js';

const TYPES = ['text', 'number', 'date', 'dropdown', 'checkbox'];
const moduleEnum = z.enum(Object.keys(COLLECTION_FOR));
const live = (f) => {
  if (f.status !== 'active') throw fail.state(`Custom field ${f.label} is archived`);
};

function validateValue(f, value) {
  const v = f.validation ?? {};
  if (value === null || value === '') {
    if (v.required) throw fail.validation(`${f.label} is required`);
    return null;
  }
  switch (f.type) {
    case 'number': {
      const n = Number(value);
      if (Number.isNaN(n)) throw fail.validation(`${f.label} must be a number`);
      if (v.min != null && n < v.min) throw fail.validation(`${f.label} must be ≥ ${v.min}`);
      if (v.max != null && n > v.max) throw fail.validation(`${f.label} must be ≤ ${v.max}`);
      return n;
    }
    case 'date':
      if (Number.isNaN(Date.parse(value))) throw fail.validation(`${f.label} must be a date`);
      return String(value).slice(0, 10);
    case 'checkbox':
      return value === true || value === 'true';
    case 'dropdown': {
      const opt = f.options.find((o) => o.value === value);
      if (!opt)
        throw fail.validation(
          `${f.label} must be one of: ${f.options
            .filter((o) => !o.retired)
            .map((o) => o.value)
            .join(', ')}`,
        );
      if (opt.retired) throw fail.validation(`Option "${value}" is retired`);
      return value;
    }
    default: {
      const s = String(value);
      if (v.maxLength && s.length > v.maxLength)
        throw fail.validation(`${f.label} max length is ${v.maxLength}`);
      if (v.pattern && !new RegExp(v.pattern).test(s))
        throw fail.validation(`${f.label} does not match the required format`);
      return s;
    }
  }
}

export default {
  id: 'custom_fields',
  code: 'M10',
  title: 'Custom Fields',
  description: 'Extend record schemas with typed business data.',
  keywords: ['custom field', 'field', 'attribute', 'property', 'dropdown option', 'schema'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create custom field',
      effect: 'write',
      description:
        'Create a typed custom field (text, number, date, dropdown, checkbox) on contacts, leads, companies, opportunities or tickets.',
      input: z.object({
        module: moduleEnum,
        label: z.string().min(1),
        type: z.enum(TYPES),
        options: z.array(z.string()).optional().meta({ description: 'Dropdown options' }),
        helpText: z.string().optional(),
      }),
      handler(a, { db, actor }) {
        const key = a.label.toLowerCase().replace(/\W+/g, '_').replace(/^_|_$/g, '');
        if (
          db.findOne('custom_fields', (f) => f.module === a.module && f.key === key && f.status === 'active')
        )
          throw fail.conflict(`Field "${key}" already exists on ${a.module}`);
        if (a.type === 'dropdown' && !a.options?.length)
          throw fail.validation('Dropdown fields need at least one option');
        return db.insert(
          'custom_fields',
          {
            module: a.module,
            key,
            label: a.label,
            type: a.type,
            options: (a.options ?? []).map((value) => ({ value, retired: false })),
            helpText: a.helpText ?? '',
            validation: {},
            status: 'active',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get field definition',
      collection: 'custom_fields',
      idField: 'fieldId',
      description: 'Get a custom field definition.',
    }),
    crud.search({
      code: 'A03',
      name: 'list_for_module',
      title: 'List fields for module',
      collection: 'custom_fields',
      description: 'List custom fields defined for a module.',
      text: ['label', 'key'],
      filters: { module: moduleEnum },
      hide: (f) => f.status !== 'active',
    }),
    crud.setField({
      code: 'A04',
      name: 'rename_label',
      title: 'Rename field label',
      collection: 'custom_fields',
      idField: 'fieldId',
      field: 'label',
      schema: z.string().min(1),
      description: "Change a custom field's display label (key is unchanged).",
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'update_help_text',
      title: 'Update field help text',
      collection: 'custom_fields',
      idField: 'fieldId',
      field: 'helpText',
      schema: z.string(),
      description: 'Update the help text shown under a custom field.',
      guard: live,
    }),
    crud.setField({
      code: 'A06',
      name: 'set_validation',
      title: 'Set field validation rules',
      collection: 'custom_fields',
      idField: 'fieldId',
      field: 'validation',
      schema: z.object({
        required: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        maxLength: z.number().int().optional(),
        pattern: z.string().optional(),
      }),
      description: 'Set validation rules (required, min/max, maxLength, regex pattern) for a custom field.',
      guard: live,
    }),
    action({
      code: 'A07',
      name: 'add_option',
      title: 'Add dropdown option',
      effect: 'write',
      description: 'Add an option to a dropdown custom field.',
      input: z.object({ fieldId: ref('custom_fields'), value: z.string().min(1) }),
      handler({ fieldId, value }, { db, actor }) {
        const f = db.must('custom_fields', fieldId);
        live(f);
        if (f.type !== 'dropdown') throw fail.state(`${f.label} is a ${f.type} field, not a dropdown`);
        if (f.options.some((o) => o.value === value)) throw fail.conflict(`Option "${value}" already exists`);
        return db.update(
          'custom_fields',
          f.id,
          { options: [...f.options, { value, retired: false }] },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'retire_option',
      title: 'Retire dropdown option',
      effect: 'write',
      description: 'Retire a dropdown option so it can no longer be selected (existing values are kept).',
      input: z.object({ fieldId: ref('custom_fields'), value: z.string().min(1) }),
      handler({ fieldId, value }, { db, actor }) {
        const f = db.must('custom_fields', fieldId);
        live(f);
        const o = f.options.find((x) => x.value === value);
        if (!o) throw fail.notFound('option', value);
        if (o.retired) throw fail.conflict(`Option "${value}" is already retired`);
        o.retired = true;
        return db.update('custom_fields', f.id, { options: f.options }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'set_record_value',
      title: 'Set record field value',
      effect: 'write',
      description: 'Set a custom field value on a record, validated against the field type and rules.',
      input: z.object({
        fieldId: ref('custom_fields'),
        recordId: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
      handler({ fieldId, recordId, value }, { db, actor }) {
        const f = db.must('custom_fields', fieldId);
        live(f);
        const rec = db.must(COLLECTION_FOR[f.module], recordId, COLLECTION_FOR[f.module]);
        const v = validateValue(f, value);
        return db.update(
          COLLECTION_FOR[f.module],
          rec.id,
          { customFields: { ...(rec.customFields ?? {}), [f.key]: v } },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'archive',
      title: 'Archive custom field',
      collection: 'custom_fields',
      idField: 'fieldId',
      from: ['active'],
      to: 'archived',
      effect: 'destructive',
      description: 'Archive a custom field (values are retained but hidden).',
    }),
  ],
};
