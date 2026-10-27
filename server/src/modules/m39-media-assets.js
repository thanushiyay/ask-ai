import { z, ref, crud, action, fail, out } from '../core/kit.js';

const live = (a) => {
  if (a.status !== 'active') throw fail.state(`Asset ${a.name} was deleted`);
};
const folder = z
  .string()
  .regex(/^\/[A-Za-z0-9 _/-]*$/)
  .meta({ description: 'Folder path like /marketing/logos' });

export default {
  id: 'media',
  code: 'M39',
  title: 'Media Assets',
  description: 'Store and organize images and downloadable files.',
  keywords: ['media', 'asset', 'image', 'file', 'upload', 'photo', 'pdf', 'video', 'alt text', 'library'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'upload',
      title: 'Upload media asset',
      collection: 'media_assets',
      description: 'Upload (simulated) a file to the media library.',
      fields: {
        name: z
          .string()
          .regex(/^[^/\\]+\.[a-z0-9]{2,5}$/i)
          .meta({ description: 'File name with extension' }),
        mime: z.string().optional(),
        sizeKb: z.number().int().min(1).max(512000).optional(),
        folder: folder.optional(),
      },
      defaults: (a, { db }) => ({
        mime: a.mime ?? 'application/octet-stream',
        sizeKb: a.sizeKb ?? 100,
        folder: a.folder ?? '/',
        altText: '',
        url: `https://cdn.northwind.example/a/${db.col('media_assets').length + 1}`,
        version: 1,
        references: [],
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get asset metadata',
      collection: 'media_assets',
      idField: 'assetId',
      description: "Get an asset's metadata.",
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search media assets',
      collection: 'media_assets',
      description: 'Search assets by name, folder or mime type.',
      text: ['name', 'altText'],
      filters: { folder: z.string(), mime: z.string() },
      hide: (a) => a.status !== 'active',
    }),
    crud.setField({
      code: 'A04',
      name: 'rename',
      title: 'Rename media asset',
      collection: 'media_assets',
      idField: 'assetId',
      field: 'name',
      schema: z.string().regex(/^[^/\\]+\.[a-z0-9]{2,5}$/i),
      description: 'Rename an asset.',
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'set_alt_text',
      title: 'Set asset alt text',
      collection: 'media_assets',
      idField: 'assetId',
      field: 'altText',
      schema: z.string().min(1).max(250),
      description: 'Set accessibility alt text for an image.',
      guard: (a) => {
        live(a);
        if (!a.mime.startsWith('image/')) throw fail.validation(`${a.name} is not an image`);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'move_to_folder',
      title: 'Move asset to folder',
      collection: 'media_assets',
      idField: 'assetId',
      field: 'folder',
      schema: folder,
      description: 'Move an asset to another folder.',
      guard: (a, x) => {
        live(a);
        if (a.folder === x.folder) throw fail.conflict(`Already in ${x.folder}`);
      },
    }),
    action({
      code: 'A07',
      name: 'replace_file',
      title: 'Replace asset file',
      effect: 'write',
      description: "Replace an asset's file (keeps its URL and references, bumps the version).",
      input: z.object({
        assetId: ref('media_assets'),
        sizeKb: z.number().int().min(1).optional(),
        mime: z.string().optional(),
      }),
      handler({ assetId, sizeKb, mime }, { db, actor }) {
        const a = db.must('media_assets', assetId);
        live(a);
        if (mime && mime.split('/')[0] !== a.mime.split('/')[0])
          throw fail.validation(`Replacement must be the same kind of file (${a.mime.split('/')[0]})`);
        return db.update(
          'media_assets',
          a.id,
          { version: a.version + 1, sizeKb: sizeKb ?? a.sizeKb, mime: mime ?? a.mime },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'list_references',
      title: 'List asset references',
      effect: 'read',
      description: 'Where an asset is used (landing pages, lessons, posts...).',
      input: z.object({ assetId: ref('media_assets') }),
      output: out.shape({ assetId: z.string(), references: z.array(z.any()) }),
      handler({ assetId }, { db }) {
        const a = db.must('media_assets', assetId);
        const lessonRefs = db
          .find('lessons', (l) => l.mediaIds.includes(a.id))
          .map((l) => ({ type: 'lesson', id: l.id }));
        const refs = [...a.references, ...lessonRefs];
        return { assetId: a.id, name: a.name, references: refs, count: refs.length };
      },
    }),
    action({
      code: 'A09',
      name: 'generate_access_link',
      title: 'Generate asset access link',
      effect: 'write',
      description: 'Generate a time-limited share link for an asset.',
      input: z.object({
        assetId: ref('media_assets'),
        expiresInHours: z.number().int().min(1).max(720).optional(),
      }),
      output: out.shape({ assetId: z.string(), url: z.string(), expiresAt: z.string() }),
      handler({ assetId, expiresInHours = 24 }, { db, clock, actor }) {
        const a = db.must('media_assets', assetId);
        live(a);
        const expiresAt = new Date(clock.now().getTime() + expiresInHours * 3600_000).toISOString();
        const link = {
          url: `${a.url}?token=sig_${a.id.split('_')[1]}_${(a.accessLinks?.length ?? 0) + 1}`,
          expiresAt,
        };
        db.update('media_assets', a.id, { accessLinks: [...(a.accessLinks ?? []), link] }, actor);
        return { assetId: a.id, ...link };
      },
    }),
    action({
      code: 'A10',
      name: 'delete_unreferenced',
      title: 'Delete unreferenced asset',
      effect: 'destructive',
      description: 'Delete an asset that is not used anywhere.',
      input: z.object({ assetId: ref('media_assets') }),
      handler({ assetId }, { db, actor }) {
        const a = db.must('media_assets', assetId);
        live(a);
        const n = a.references.length + db.find('lessons', (l) => l.mediaIds.includes(a.id)).length;
        if (n) throw fail.state(`${a.name} is used in ${n} places and cannot be deleted`);
        return db.update('media_assets', a.id, { status: 'deleted' }, actor);
      },
    }),
  ],
};
