import { z, s, ref, crud, action, fail, out } from '../core/kit.js';

const DIRECTORIES = ['Google Business Profile', 'Yelp', 'Bing Places', 'Apple Maps', 'Facebook'];
const dirty = (patch) => ({ ...patch, syncStatus: 'pending_sync' });
const hours = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$|^closed$/)
  .meta({ description: 'HH:MM-HH:MM or "closed"' });

export default {
  id: 'listings',
  code: 'M46',
  title: 'Business Listings',
  description: 'Manage business profiles in simulated directories.',
  keywords: [
    'listing',
    'business listing',
    'directory',
    'google business profile',
    'yelp',
    'local seo',
    'nap',
    'business hours',
  ],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create business listing',
      collection: 'listings',
      description: 'Create an unpublished business listing for a directory.',
      fields: {
        directory: z.enum(DIRECTORIES),
        name: z.string().min(1),
        address: z.string().optional(),
        phone: s.phone().optional(),
      },
      validate: (a, { db }) => {
        if (db.findOne('listings', (l) => l.directory === a.directory))
          throw fail.conflict(`A ${a.directory} listing already exists`);
      },
      defaults: () => ({
        address: '',
        phone: '',
        hours: {},
        categories: [],
        published: false,
        syncStatus: 'not_published',
        lastSyncedAt: null,
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get listing details',
      collection: 'listings',
      idField: 'listingId',
      description: 'Get one directory listing.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search business listings',
      collection: 'listings',
      description: 'Search listings by name/directory or sync status.',
      text: ['name', 'directory', 'address'],
      filters: {
        directory: z.enum(DIRECTORIES),
        syncStatus: z.enum(['synced', 'pending_sync', 'out_of_sync', 'not_published']),
        published: z.boolean(),
      },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_name',
      title: 'Update listing name',
      collection: 'listings',
      idField: 'listingId',
      field: 'name',
      schema: z.string().min(1),
      description: 'Change the business name on a listing.',
      transform: (a) => dirty({ name: a.name }),
    }),
    crud.setField({
      code: 'A05',
      name: 'update_address',
      title: 'Update listing address',
      collection: 'listings',
      idField: 'listingId',
      field: 'address',
      schema: z.string().min(5),
      description: 'Change the street address on a listing.',
      transform: (a) => dirty({ address: a.address }),
    }),
    crud.setField({
      code: 'A06',
      name: 'update_phone',
      title: 'Update listing phone',
      collection: 'listings',
      idField: 'listingId',
      field: 'phone',
      schema: s.phone(),
      description: 'Change the phone number on a listing.',
      transform: (a) => dirty({ phone: a.phone }),
    }),
    crud.setField({
      code: 'A07',
      name: 'set_hours',
      title: 'Set listing business hours',
      collection: 'listings',
      idField: 'listingId',
      field: 'hours',
      schema: z.partialRecord(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), hours),
      description: 'Set opening hours per weekday.',
      transform: (a, l) => dirty({ hours: { ...l.hours, ...a.hours } }),
    }),
    crud.setField({
      code: 'A08',
      name: 'set_categories',
      title: 'Set listing categories',
      collection: 'listings',
      idField: 'listingId',
      field: 'categories',
      schema: z.array(z.string().min(1)).min(1).max(10),
      description: 'Set the business categories on a listing.',
      transform: (a) => dirty({ categories: a.categories }),
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish listing to simulated directory',
      effect: 'external',
      description: 'Push a listing to its directory. Requires name, address and phone.',
      input: z.object({ listingId: ref('listings') }),
      handler({ listingId }, { db, actor, clock }) {
        const l = db.must('listings', listingId);
        const missing = ['name', 'address', 'phone'].filter((k) => !l[k]);
        if (missing.length) throw fail.state(`Listing on ${l.directory} is missing: ${missing.join(', ')}`);
        return db.update(
          'listings',
          l.id,
          { published: true, syncStatus: 'synced', lastSyncedAt: clock.nowIso() },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'sync_status',
      title: 'Get listing sync status',
      effect: 'read',
      description:
        'Whether a listing is in sync with its directory, and inconsistencies with the primary (Google) listing.',
      input: z.object({ listingId: ref('listings') }),
      output: out.shape({
        listingId: z.string(),
        syncStatus: z.string(),
        inconsistencies: z.array(z.string()),
      }),
      handler({ listingId }, { db }) {
        const l = db.must('listings', listingId);
        const primary = db.findOne('listings', (x) => x.directory === 'Google Business Profile');
        const inconsistencies =
          primary && primary.id !== l.id
            ? ['name', 'address', 'phone']
                .filter((k) => l[k] !== primary[k])
                .map((k) => `${k} differs from Google listing ("${l[k]}" vs "${primary[k]}")`)
            : [];
        return {
          listingId: l.id,
          directory: l.directory,
          syncStatus: l.syncStatus,
          lastSyncedAt: l.lastSyncedAt,
          inconsistencies,
        };
      },
    }),
  ],
};
