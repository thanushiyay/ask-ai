import { z, crud, action, fail, out, ref } from '../core/kit.js';

const RECORD_TYPES = {
  contact: 'contacts',
  company: 'companies',
  lead: 'leads',
  opportunity: 'opportunities',
  ticket: 'tickets',
  task: 'tasks',
  invoice: 'invoices',
  appointment: 'appointments',
  order: 'orders',
};
const recordType = z.enum(Object.keys(RECORD_TYPES));
const live = (n) => {
  if (n.status === 'deleted') throw fail.state(`Note ${n.id} was deleted`);
};

export default {
  id: 'notes',
  code: 'M07',
  title: 'Notes',
  description: 'Attach contextual notes to business records.',
  keywords: ['note', 'comment', 'memo', 'annotation', 'remark', 'jot down'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create note',
      effect: 'write',
      description: 'Create a note, optionally attached to a record (contact, lead, opportunity, ticket...).',
      input: z.object({
        body: z.string().min(1),
        recordType: recordType.optional(),
        recordId: z.string().optional(),
        pinned: z.boolean().optional(),
      }),
      handler({ body, recordType: t, recordId, pinned }, { db, actor }) {
        if (Boolean(t) !== Boolean(recordId))
          throw fail.validation('recordType and recordId must be given together');
        if (t) db.must(RECORD_TYPES[t], recordId, RECORD_TYPES[t]);
        return db.insert(
          'notes',
          {
            body,
            recordRefs: t ? [{ type: t, id: recordId }] : [],
            pinned: pinned ?? false,
            revisions: [],
            authorId: null,
            status: 'active',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get note',
      collection: 'notes',
      idField: 'noteId',
      description: 'Get one note by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search notes',
      collection: 'notes',
      description: 'Search notes by text, by attached record, or pinned status.',
      text: ['body'],
      filters: { pinned: z.boolean() },
      extraInput: {
        recordId: z.string().optional().meta({ description: 'Notes attached to this record ID' }),
      },
      where: (n, a) => !a.recordId || n.recordRefs.some((r) => r.id === a.recordId),
      hide: (n) => n.status === 'deleted',
    }),
    action({
      code: 'A04',
      name: 'update',
      title: 'Update note',
      effect: 'write',
      description: 'Replace the text of a note (previous text is kept in revision history).',
      input: z.object({ noteId: ref('notes'), body: z.string().min(1) }),
      handler({ noteId, body }, { db, actor, clock }) {
        const n = db.must('notes', noteId);
        live(n);
        if (n.body === body) throw fail.conflict('Note already has this text');
        return db.update(
          'notes',
          n.id,
          { body, revisions: [...n.revisions, { body: n.body, at: clock.nowIso() }] },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'delete',
      title: 'Delete note',
      collection: 'notes',
      idField: 'noteId',
      from: ['active'],
      to: 'deleted',
      effect: 'destructive',
      description: 'Delete a note.',
    }),
    action({
      code: 'A06',
      name: 'attach',
      title: 'Attach note to record',
      effect: 'write',
      description: 'Attach an existing note to another record.',
      input: z.object({ noteId: ref('notes'), recordType, recordId: z.string().min(1) }),
      handler({ noteId, recordType: t, recordId }, { db, actor }) {
        const n = db.must('notes', noteId);
        live(n);
        db.must(RECORD_TYPES[t], recordId, RECORD_TYPES[t]);
        if (n.recordRefs.some((r) => r.id === recordId))
          throw fail.conflict('Note is already attached to that record');
        return db.update('notes', n.id, { recordRefs: [...n.recordRefs, { type: t, id: recordId }] }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'detach',
      title: 'Detach note from record',
      effect: 'write',
      description: 'Detach a note from a record.',
      input: z.object({ noteId: ref('notes'), recordId: z.string().min(1) }),
      handler({ noteId, recordId }, { db, actor }) {
        const n = db.must('notes', noteId);
        if (!n.recordRefs.some((r) => r.id === recordId))
          throw fail.state('Note is not attached to that record');
        return db.update('notes', n.id, { recordRefs: n.recordRefs.filter((r) => r.id !== recordId) }, actor);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'pin',
      title: 'Pin note',
      collection: 'notes',
      idField: 'noteId',
      field: 'pinned',
      schema: z.literal(true).optional(),
      description: 'Pin a note to the top of its record.',
      guard: (n) => {
        live(n);
        if (n.pinned) throw fail.conflict('Note is already pinned');
      },
      transform: () => ({ pinned: true }),
    }),
    crud.setField({
      code: 'A09',
      name: 'unpin',
      title: 'Unpin note',
      collection: 'notes',
      idField: 'noteId',
      field: 'pinned',
      schema: z.literal(false).optional(),
      description: 'Unpin a note.',
      guard: (n) => {
        if (!n.pinned) throw fail.conflict('Note is not pinned');
      },
      transform: () => ({ pinned: false }),
    }),
    action({
      code: 'A10',
      name: 'revision_history',
      title: 'View note revision history',
      effect: 'read',
      description: 'List previous versions of a note.',
      input: z.object({ noteId: ref('notes') }),
      output: out.shape({
        noteId: z.string(),
        current: z.string(),
        revisions: z.array(z.object({ body: z.string(), at: z.string() })),
      }),
      handler({ noteId }, { db }) {
        const n = db.must('notes', noteId);
        return { noteId: n.id, current: n.body, revisions: [...n.revisions].reverse() };
      },
    }),
  ],
};
