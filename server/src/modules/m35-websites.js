import { z, ref, crud, action, fail, child } from '../core/kit.js';

export default {
  id: 'websites',
  code: 'M35',
  title: 'Websites',
  description: 'Manage sites and their page collections.',
  keywords: ['website', 'site', 'web page', 'domain', 'navigation', 'menu', 'seo', 'homepage'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create website',
      collection: 'websites',
      description: 'Create an unpublished website.',
      fields: {
        name: z.string().min(1),
        domain: z
          .string()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
          .optional(),
      },
      validate: (a, { db }) => {
        if (a.domain && db.findOne('websites', (w) => w.domain === a.domain))
          throw fail.conflict(`Domain ${a.domain} is in use`);
      },
      defaults: () => ({
        domain: null,
        pages: [],
        homePageId: null,
        navigation: [],
        seo: {},
        published: false,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get website settings',
      collection: 'websites',
      idField: 'websiteId',
      description: "Get a website's pages, navigation, SEO and publish state.",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List websites',
      collection: 'websites',
      description: 'List websites.',
      text: ['name', 'domain'],
      filters: { published: z.boolean() },
    }),
    crud.setField({
      code: 'A04',
      name: 'rename',
      title: 'Rename website',
      collection: 'websites',
      idField: 'websiteId',
      field: 'name',
      schema: z.string().min(1),
      description: 'Rename a website.',
    }),
    action({
      code: 'A05',
      name: 'add_page',
      title: 'Add website page',
      effect: 'write',
      description: 'Add a page (title + path) to a website.',
      input: z.object({
        websiteId: ref('websites'),
        title: z.string().min(1),
        path: z
          .string()
          .regex(/^\/[a-z0-9/-]*$/)
          .optional()
          .meta({ description: 'e.g. /pricing' }),
      }),
      handler({ websiteId, title, path }, { db, actor }) {
        const w = db.must('websites', websiteId);
        const p =
          path ??
          `/${title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}`;
        if (w.pages.some((x) => x.path === p)) throw fail.conflict(`A page already exists at ${p}`);
        return db.update(
          'websites',
          w.id,
          { pages: [...w.pages, { id: `page_${db.nextId('_child').split('_').pop()}`, title, path: p }] },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'set_home_page',
      title: 'Set website home page',
      effect: 'write',
      description: 'Choose which page is the home page.',
      input: z.object({ websiteId: ref('websites'), pageId: z.string().min(1) }),
      handler({ websiteId, pageId }, { db, actor }) {
        const w = db.must('websites', websiteId);
        child(w.pages, pageId, 'page');
        return db.update('websites', w.id, { homePageId: pageId }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'update_navigation',
      title: 'Update site navigation',
      effect: 'write',
      description: 'Replace the navigation menu with an ordered list of {label, pageId}.',
      input: z.object({
        websiteId: ref('websites'),
        items: z.array(z.object({ label: z.string().min(1), pageId: z.string().min(1) })),
      }),
      handler({ websiteId, items }, { db, actor }) {
        const w = db.must('websites', websiteId);
        items.forEach((i) => child(w.pages, i.pageId, 'page'));
        return db.update('websites', w.id, { navigation: items }, actor);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_seo_defaults',
      title: 'Set site SEO defaults',
      collection: 'websites',
      idField: 'websiteId',
      field: 'seo',
      schema: z.object({
        titleTemplate: z.string().optional(),
        description: z.string().max(160).optional(),
        ogImageUrl: z.string().url().optional(),
      }),
      description: 'Set default SEO title template, meta description and social image.',
      transform: (a, w) => ({ seo: { ...w.seo, ...a.seo } }),
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish website',
      effect: 'external',
      description: 'Publish a website live. Requires a domain, at least one page and a home page.',
      input: z.object({ websiteId: ref('websites') }),
      handler({ websiteId }, { db, actor, clock }) {
        const w = db.must('websites', websiteId);
        const problems = [
          !w.domain && 'no domain',
          !w.pages.length && 'no pages',
          !w.homePageId && 'no home page',
        ].filter(Boolean);
        if (problems.length)
          throw fail.state(`Website ${w.name} cannot be published: ${problems.join(', ')}`, { problems });
        return db.update('websites', w.id, { published: true, publishedAt: clock.nowIso() }, actor);
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'unpublish',
      title: 'Unpublish website',
      collection: 'websites',
      idField: 'websiteId',
      field: 'published',
      from: [true],
      to: false,
      effect: 'external',
      description: 'Take a website offline.',
      label: 'Website (published flag)',
    }),
  ],
};
