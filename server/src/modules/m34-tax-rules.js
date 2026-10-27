import { z, ref, crud, action, fail, out } from '../core/kit.js';
import { round2 } from './_commerce.js';

const CATEGORIES = ['software', 'services', 'physical'];
const live = (t) => {
  if (t.status !== 'active') throw fail.state(`Tax rule ${t.name} is inactive`);
};
const region = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/)
  .meta({ description: 'Region code, e.g. US-CA, US-NY, EU, GB' });

export default {
  id: 'tax_rules',
  code: 'M34',
  title: 'Tax Rules',
  description: 'Configure tax calculations for simulated sales.',
  keywords: ['tax', 'vat', 'sales tax', 'gst', 'tax rate', 'tax exempt', 'region'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create tax rule',
      collection: 'tax_rules',
      description: 'Create a tax rule (rate % for a region and product categories).',
      fields: {
        name: z.string().min(1),
        rate: z.number().min(0).max(50),
        region,
        productCategories: z.array(z.enum(CATEGORIES)).optional(),
        inclusive: z.boolean().optional(),
      },
      validate: (a, { db }) => {
        if (
          db.findOne(
            'tax_rules',
            (t) =>
              t.region === a.region &&
              t.status === 'active' &&
              (a.productCategories ?? CATEGORIES).some((c) => t.productCategories.includes(c)),
          )
        )
          throw fail.conflict(`An active rule already covers ${a.region} for those categories`);
      },
      defaults: () => ({ productCategories: CATEGORIES, inclusive: false, status: 'active' }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get tax rule',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      description: 'Get one tax rule.',
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List tax rules',
      collection: 'tax_rules',
      description: 'List tax rules, optionally for a region.',
      text: ['name'],
      filters: { region: z.string(), status: z.enum(['active', 'inactive']) },
    }),
    crud.setField({
      code: 'A04',
      name: 'set_rate',
      title: 'Set tax rate',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      field: 'rate',
      schema: z.number().min(0).max(50).meta({ description: 'Percent' }),
      description: "Change a tax rule's rate (%).",
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'set_region',
      title: 'Set applicable region',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      field: 'region',
      schema: region,
      description: 'Change the region a tax rule applies to.',
      guard: live,
    }),
    crud.setField({
      code: 'A06',
      name: 'set_product_categories',
      title: 'Set product tax category',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      field: 'productCategories',
      schema: z.array(z.enum(CATEGORIES)).min(1),
      description: 'Set which product categories a tax rule applies to.',
      guard: live,
    }),
    crud.setField({
      code: 'A07',
      name: 'set_inclusive',
      title: 'Set tax-inclusive pricing',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      field: 'inclusive',
      schema: z.boolean(),
      description: 'Set whether prices already include this tax.',
      guard: live,
    }),
    action({
      code: 'A08',
      name: 'record_exemption',
      title: 'Record customer tax exemption',
      effect: 'write',
      description: 'Mark a contact as tax-exempt with a certificate reference.',
      input: z.object({
        contactId: ref('contacts'),
        certificateNumber: z.string().min(3),
        regions: z.array(z.string()).optional(),
      }),
      handler({ contactId, certificateNumber, regions }, { db, actor, clock }) {
        const c = db.must('contacts', contactId);
        return db.update(
          'contacts',
          c.id,
          {
            taxExempt: true,
            taxExemption: { certificateNumber, regions: regions ?? ['*'], recordedAt: clock.nowIso() },
          },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'calculate_for_order',
      title: 'Calculate tax for order',
      effect: 'read',
      description:
        'Calculate tax for an order given a destination region (defaults to the shipping address region).',
      input: z.object({ orderId: ref('orders'), region: z.string().optional() }),
      output: out.shape({ orderId: z.string(), taxTotal: z.number(), lines: z.array(z.any()) }),
      handler({ orderId, region: reg }, { db }) {
        const o = db.must('orders', orderId);
        const r = reg ?? o.shippingAddress?.region;
        if (!r) throw fail.validation('No region: pass one or set a shipping address with a region');
        const c = db.get('contacts', o.contactId);
        if (c?.taxExempt && (c.taxExemption?.regions ?? ['*']).some((x) => x === '*' || x === r))
          return { orderId: o.id, region: r, exempt: true, taxTotal: 0, lines: [] };
        const rules = db.find(
          'tax_rules',
          (t) => t.status === 'active' && (t.region === r || r.startsWith(t.region + '-')),
        );
        const lines = o.lineItems.map((l) => {
          const cat = db.get('products', l.productId)?.category;
          const rule = rules.find((t) => t.productCategories.includes(cat));
          const base = l.quantity * l.unitPrice;
          const tax = !rule
            ? 0
            : rule.inclusive
              ? round2(base - base / (1 + rule.rate / 100))
              : round2((base * rule.rate) / 100);
          return {
            lineItemId: l.id,
            description: l.description,
            category: cat,
            rule: rule?.name ?? null,
            rate: rule?.rate ?? 0,
            inclusive: rule?.inclusive ?? false,
            tax,
          };
        });
        return {
          orderId: o.id,
          region: r,
          exempt: false,
          taxTotal: round2(lines.filter((l) => !l.inclusive).reduce((a, l) => a + l.tax, 0)),
          includedTax: round2(lines.filter((l) => l.inclusive).reduce((a, l) => a + l.tax, 0)),
          lines,
        };
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'deactivate',
      title: 'Deactivate tax rule',
      collection: 'tax_rules',
      idField: 'taxRuleId',
      from: ['active'],
      to: 'inactive',
      effect: 'destructive',
      description: 'Deactivate a tax rule.',
    }),
  ],
};
