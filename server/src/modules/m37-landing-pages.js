import { z, ref, crud, action, fail } from '../core/kit.js';

const seo = z.object({ title: z.string().max(70).optional(), description: z.string().max(160).optional() });

export default {
  id: 'landing_pages',
  code: 'M37',
  title: 'Landing Pages',
  description: 'Build and publish individual conversion pages.',
  keywords: ['landing page', 'page', 'squeeze page', 'opt-in page', 'hero', 'section', 'lead capture page'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create landing page',
      collection: 'landing_pages',
      description: 'Create an unpublished landing page with a headline.',
      fields: {
        title: z.string().min(1),
        headline: z.string().optional(),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .optional(),
      },
      validate(a, { db }) {
        a.slug ??= a.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        if (db.findOne('landing_pages', (p) => p.slug === a.slug))
          throw fail.conflict(`Slug "${a.slug}" is taken`);
      },
      defaults: (a) => ({
        content: { headline: a.headline ?? a.title, body: '' },
        sections: [],
        formId: null,
        seo: { title: '', description: '' },
        published: false,
        views: 0,
        conversions: 0,
        headline: undefined,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get landing page',
      collection: 'landing_pages',
      idField: 'landingPageId',
      description: 'Get a landing page with sections, form and SEO.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search landing pages',
      collection: 'landing_pages',
      description: 'Search landing pages by title/slug or published state.',
      text: ['title', 'slug'],
      filters: { published: z.boolean() },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_content',
      title: 'Update page content',
      collection: 'landing_pages',
      idField: 'landingPageId',
      field: 'content',
      schema: z.object({ headline: z.string().optional(), body: z.string().optional() }),
      description: "Update a landing page's headline/body copy.",
      transform: (a, p) => ({ content: { ...p.content, ...a.content } }),
    }),
    action({
      code: 'A05',
      name: 'add_section',
      title: 'Add page section',
      effect: 'write',
      description: 'Add a section (hero, features, testimonials, pricing, faq, cta, form) to a landing page.',
      input: z.object({
        landingPageId: ref('landing_pages'),
        type: z.enum(['hero', 'features', 'testimonials', 'pricing', 'faq', 'cta', 'form']),
        title: z.string().optional(),
      }),
      handler({ landingPageId, type, title }, { db, actor }) {
        const p = db.must('landing_pages', landingPageId);
        return db.update(
          'landing_pages',
          p.id,
          {
            sections: [
              ...p.sections,
              {
                id: `sec_${db.nextId('_child').split('_').pop()}`,
                type,
                title: title ?? type,
                order: p.sections.length + 1,
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'reorder_sections',
      title: 'Reorder page sections',
      effect: 'write',
      description: 'Reorder sections by listing every section ID in the new order.',
      input: z.object({ landingPageId: ref('landing_pages'), sectionIds: z.array(z.string()).min(1) }),
      handler({ landingPageId, sectionIds }, { db, actor }) {
        const p = db.must('landing_pages', landingPageId);
        if (
          [...sectionIds].sort().join() !==
          p.sections
            .map((x) => x.id)
            .sort()
            .join()
        )
          throw fail.validation('sectionIds must include every section exactly once', {
            sections: p.sections.map((x) => ({ id: x.id, title: x.title })),
          });
        return db.update(
          'landing_pages',
          p.id,
          { sections: sectionIds.map((id, i) => ({ ...p.sections.find((x) => x.id === id), order: i + 1 })) },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'attach_form',
      title: 'Attach form to page',
      collection: 'landing_pages',
      idField: 'landingPageId',
      field: 'formId',
      schema: ref('forms'),
      description: 'Embed a form on a landing page.',
      guard: (p, a, { db }) => {
        const f = db.must('forms', a.formId);
        if (p.formId === f.id) throw fail.conflict('That form is already attached');
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_seo',
      title: 'Set page SEO metadata',
      collection: 'landing_pages',
      idField: 'landingPageId',
      field: 'seo',
      schema: seo,
      description: "Set a landing page's SEO title and meta description.",
      transform: (a, p) => ({ seo: { ...p.seo, ...a.seo } }),
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish landing page',
      effect: 'external',
      description: 'Publish a landing page. Needs at least one section; an attached form must be published.',
      input: z.object({ landingPageId: ref('landing_pages') }),
      handler({ landingPageId }, { db, actor }) {
        const p = db.must('landing_pages', landingPageId);
        if (p.published) throw fail.conflict('Page is already published');
        if (!p.sections.length) throw fail.state(`"${p.title}" has no sections`);
        if (p.formId && db.get('forms', p.formId)?.status !== 'published')
          throw fail.state('The attached form is not published yet');
        return db.update(
          'landing_pages',
          p.id,
          { published: true, url: `https://pages.northwind.example/${p.slug}` },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'unpublish',
      title: 'Unpublish landing page',
      collection: 'landing_pages',
      idField: 'landingPageId',
      field: 'published',
      from: [true],
      to: false,
      effect: 'external',
      description: 'Take a landing page offline.',
      label: 'Landing page (published flag)',
    }),
  ],
};
