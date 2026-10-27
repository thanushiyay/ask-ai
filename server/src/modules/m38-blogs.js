import { z, s, ref, crud, action, fail } from '../core/kit.js';

export default {
  id: 'blogs',
  code: 'M38',
  title: 'Blogs',
  description: 'Manage articles and editorial publishing.',
  keywords: ['blog', 'post', 'article', 'content', 'author', 'publish article', 'editorial'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create_post',
      title: 'Create blog post',
      collection: 'blog_posts',
      description: 'Create a draft blog post.',
      fields: {
        title: z.string().min(1),
        body: z.string().optional(),
        authorId: ref('users').optional(),
        categories: z.array(z.string()).optional(),
      },
      validate: (a, { db }) => {
        if (a.authorId) db.must('users', a.authorId);
      },
      defaults: (a) => ({
        slug: a.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        body: '',
        authorId: null,
        categories: [],
        seo: { title: a.title, description: '' },
        status: 'draft',
        publishAt: null,
        publishedAt: null,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get_post',
      title: 'Get blog post',
      collection: 'blog_posts',
      idField: 'postId',
      description: 'Get one blog post.',
    }),
    crud.search({
      code: 'A03',
      name: 'search_posts',
      title: 'Search blog posts',
      collection: 'blog_posts',
      description: 'Search posts by title/body, status, author or category.',
      text: ['title', 'body'],
      filters: {
        status: z.enum(['draft', 'scheduled', 'published']),
        authorId: ref('users'),
        categories: z.string(),
      },
    }),
    crud.update({
      code: 'A04',
      name: 'update_post',
      title: 'Update blog post',
      collection: 'blog_posts',
      idField: 'postId',
      description: "Update a post's title or body.",
      fields: { title: z.string().min(1), body: z.string() },
    }),
    crud.setField({
      code: 'A05',
      name: 'assign_author',
      title: 'Assign post author',
      collection: 'blog_posts',
      idField: 'postId',
      field: 'authorId',
      schema: ref('users'),
      description: 'Set the author of a post.',
      guard: (p, a, { db }) => db.must('users', a.authorId),
    }),
    crud.setField({
      code: 'A06',
      name: 'set_categories',
      title: 'Set post categories',
      collection: 'blog_posts',
      idField: 'postId',
      field: 'categories',
      schema: z.array(z.string().min(1)).min(1),
      description: "Set a post's categories.",
    }),
    crud.setField({
      code: 'A07',
      name: 'set_seo',
      title: 'Set post SEO metadata',
      collection: 'blog_posts',
      idField: 'postId',
      field: 'seo',
      schema: z.object({ title: z.string().max(70).optional(), description: z.string().max(160).optional() }),
      description: "Set a post's SEO title and meta description.",
      transform: (a, p) => ({ seo: { ...p.seo, ...a.seo } }),
    }),
    action({
      code: 'A08',
      name: 'schedule',
      title: 'Schedule post publication',
      effect: 'external',
      description: 'Schedule a draft post to publish at a future time.',
      input: z.object({ postId: ref('blog_posts'), publishAt: s.datetime('Future publish time') }),
      handler({ postId, publishAt }, { db, actor, clock }) {
        const p = db.must('blog_posts', postId);
        if (p.status === 'published') throw fail.state('Post is already published');
        if (new Date(publishAt) <= clock.now()) throw fail.validation('publishAt must be in the future');
        if (!p.body) throw fail.state('Post has no body yet');
        return db.update('blog_posts', p.id, { status: 'scheduled', publishAt }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish post',
      effect: 'external',
      description: 'Publish a post now. Requires a body and an author.',
      input: z.object({ postId: ref('blog_posts') }),
      handler({ postId }, { db, actor, clock }) {
        const p = db.must('blog_posts', postId);
        if (p.status === 'published') throw fail.conflict('Post is already published');
        const problems = [!p.body && 'no body', !p.authorId && 'no author'].filter(Boolean);
        if (problems.length) throw fail.state(`Cannot publish "${p.title}": ${problems.join(', ')}`);
        return db.update(
          'blog_posts',
          p.id,
          { status: 'published', publishedAt: clock.nowIso(), publishAt: null },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'unpublish',
      title: 'Unpublish post',
      collection: 'blog_posts',
      idField: 'postId',
      from: ['published', 'scheduled'],
      to: 'draft',
      effect: 'external',
      description: 'Unpublish (or unschedule) a post back to draft.',
      patch: () => ({ publishAt: null }),
    }),
  ],
};
