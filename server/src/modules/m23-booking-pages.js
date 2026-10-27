import { z, ref, crud, action, fail } from '../core/kit.js';

export default {
  id: 'booking_pages',
  code: 'M23',
  title: 'Booking Pages',
  description: 'Configure the public booking experience.',
  keywords: ['booking page', 'scheduling page', 'booking link', 'calendly', 'public booking', 'intake'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create booking page',
      collection: 'booking_pages',
      description: 'Create an unpublished public booking page.',
      fields: {
        title: z.string().min(1),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .optional()
          .meta({ description: 'URL slug, lowercase-with-dashes' }),
        calendarId: ref('calendars').optional(),
      },
      validate(a, { db }) {
        a.slug ??= a.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        if (db.findOne('booking_pages', (b) => b.slug === a.slug))
          throw fail.conflict(`Slug "${a.slug}" is taken`);
        if (a.calendarId) db.must('calendars', a.calendarId);
      },
      defaults: () => ({
        calendarId: null,
        content: { headline: '', body: '' },
        intakeFields: [],
        confirmationMessage: '',
        redirectUrl: null,
        published: false,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get booking page',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      description: "Get a booking page's settings.",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List booking pages',
      collection: 'booking_pages',
      description: 'List booking pages.',
      text: ['title', 'slug'],
      filters: { published: z.boolean(), calendarId: ref('calendars') },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_content',
      title: 'Update booking page content',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'content',
      schema: z.object({ headline: z.string().optional(), body: z.string().optional() }),
      description: 'Update the headline/body text of a booking page.',
      transform: (a, r) => ({ content: { ...r.content, ...a.content } }),
    }),
    crud.setField({
      code: 'A05',
      name: 'link_calendar',
      title: 'Link calendar to booking page',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'calendarId',
      schema: ref('calendars'),
      description: 'Choose which calendar a booking page books into.',
      guard: (b, a, { db }) => {
        const c = db.must('calendars', a.calendarId);
        if (c.status !== 'active') throw fail.state(`Calendar ${c.name} is archived`);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_intake_fields',
      title: 'Set booking intake fields',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'intakeFields',
      schema: z.array(
        z.object({ key: z.string().min(1), label: z.string().min(1), required: z.boolean().optional() }),
      ),
      description: 'Set the questions asked when someone books.',
    }),
    crud.setField({
      code: 'A07',
      name: 'set_confirmation_message',
      title: 'Set booking confirmation message',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'confirmationMessage',
      schema: z.string().min(1).max(500),
      description: 'Set the message shown after a booking.',
    }),
    crud.setField({
      code: 'A08',
      name: 'set_redirect_url',
      title: 'Set booking redirect URL',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'redirectUrl',
      schema: z.string().url(),
      description: 'Redirect bookers to a URL after booking.',
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish booking page',
      effect: 'external',
      description: 'Publish a booking page publicly. Requires a linked active calendar.',
      input: z.object({ bookingPageId: ref('booking_pages') }),
      handler({ bookingPageId }, { db, actor }) {
        const b = db.must('booking_pages', bookingPageId);
        if (b.published) throw fail.conflict('Booking page is already published');
        if (!b.calendarId) throw fail.state(`Booking page "${b.title}" has no calendar linked`);
        return db.update(
          'booking_pages',
          b.id,
          { published: true, url: `https://book.northwind.example/${b.slug}` },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'unpublish',
      title: 'Unpublish booking page',
      collection: 'booking_pages',
      idField: 'bookingPageId',
      field: 'published',
      from: [true],
      to: false,
      effect: 'external',
      description: 'Take a booking page offline.',
      label: 'Booking page (published flag)',
    }),
  ],
};
