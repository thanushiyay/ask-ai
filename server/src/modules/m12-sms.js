import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { appendMessage, render, contactVars, smsSegments, assertCanMessage } from './_shared.js';

const bodyFor = (db, { body, templateId, contactId }) => {
  if (body) return body;
  if (!templateId) {
    const templates = db
      .find('templates', (t) => t.channel === 'sms' && t.status === 'active')
      .map((t) => `${t.id} "${t.name}"`)
      .join(', ');
    throw fail.validation(`Provide body or templateId (SMS templates: ${templates})`);
  }
  const t = db.must('templates', templateId);
  if (t.channel !== 'sms') throw fail.validation(`Template ${t.name} is an ${t.channel} template`);
  const r = render(t.body, contactVars(db, contactId));
  if (r.missing.length) throw fail.validation(`Missing template variables: ${r.missing.join(', ')}`);
  return r.text;
};

function deliver(db, sms, { actor, clock }) {
  const c = db.must('contacts', sms.contactId);
  assertCanMessage(c, 'sms');
  const at = clock.nowIso();
  appendMessage(db, { contactId: c.id, channel: 'sms', direction: 'outbound', body: sms.body, at }, actor);
  return db.update(
    'sms',
    sms.id,
    { status: 'sent', sentAt: at, deliveryStatus: 'delivered', to: c.phone },
    actor,
  );
}

export default {
  id: 'sms',
  code: 'M12',
  title: 'SMS',
  description: 'Prepare, send, and track text messages.',
  keywords: ['sms', 'text message', 'text', 'mobile message', 'opt out', 'stop'],
  actions: [
    action({
      code: 'A01',
      name: 'draft',
      title: 'Draft SMS',
      effect: 'write',
      description:
        'Create a draft text message to a contact from a body or an SMS template. Nothing is sent.',
      input: z.object({
        contactId: ref('contacts'),
        body: z.string().min(1).max(1600).optional(),
        templateId: ref('templates').optional(),
      }),
      handler(a, { db, actor }) {
        const c = db.must('contacts', a.contactId);
        const body = bodyFor(db, a);
        return db.insert(
          'sms',
          {
            contactId: c.id,
            to: c.phone,
            body,
            status: 'draft',
            direction: 'outbound',
            segments: smsSegments(body).segments,
            scheduledAt: null,
            sentAt: null,
            deliveryStatus: null,
            failureReason: null,
            templateId: a.templateId ?? null,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A02',
      name: 'preview_segmentation',
      title: 'Preview SMS segmentation',
      effect: 'read',
      description: 'Show how many SMS segments a message body will use and its encoding.',
      input: z.object({ body: z.string().min(1) }),
      output: out.shape({ segments: z.number(), encoding: z.string() }),
      handler: ({ body }) => smsSegments(body),
    }),
    action({
      code: 'A03',
      name: 'send',
      title: 'Send SMS',
      effect: 'external',
      description:
        'Send a text message now: either an existing draft (smsId) or a new message (contactId + body/templateId). Respects opt-outs.',
      input: z.object({
        smsId: ref('sms').optional(),
        contactId: ref('contacts').optional(),
        body: z.string().min(1).max(1600).optional(),
        templateId: ref('templates').optional(),
      }),
      handler(a, ctx) {
        const { db, actor } = ctx;
        let sms;
        if (a.smsId) {
          sms = db.must('sms', a.smsId);
          if (!['draft', 'scheduled'].includes(sms.status))
            throw fail.state(`SMS ${sms.id} is already ${sms.status}`);
        } else {
          if (!a.contactId) throw fail.validation('Provide smsId or contactId');
          const c = db.must('contacts', a.contactId);
          assertCanMessage(c, 'sms');
          const body = bodyFor(db, a);
          sms = db.insert(
            'sms',
            {
              contactId: c.id,
              to: c.phone,
              body,
              status: 'draft',
              direction: 'outbound',
              segments: smsSegments(body).segments,
              scheduledAt: null,
              sentAt: null,
              deliveryStatus: null,
              failureReason: null,
              templateId: a.templateId ?? null,
            },
            actor,
          );
        }
        return deliver(db, sms, ctx);
      },
    }),
    action({
      code: 'A04',
      name: 'schedule',
      title: 'Schedule SMS',
      effect: 'external',
      description: 'Schedule a draft SMS (or a new message) for a future time.',
      input: z.object({
        smsId: ref('sms').optional(),
        contactId: ref('contacts').optional(),
        body: z.string().optional(),
        sendAt: s.datetime('When to send (future ISO date-time)'),
      }),
      handler(a, { db, actor, clock }) {
        if (new Date(a.sendAt) <= clock.now()) throw fail.validation('sendAt must be in the future');
        let sms = a.smsId ? db.must('sms', a.smsId) : null;
        if (sms && sms.status !== 'draft') throw fail.state(`SMS ${sms.id} is ${sms.status}`);
        if (!sms) {
          if (!a.contactId || !a.body) throw fail.validation('Provide smsId, or contactId and body');
          const c = db.must('contacts', a.contactId);
          sms = db.insert(
            'sms',
            {
              contactId: c.id,
              to: c.phone,
              body: a.body,
              status: 'draft',
              direction: 'outbound',
              segments: smsSegments(a.body).segments,
              scheduledAt: null,
              sentAt: null,
              deliveryStatus: null,
              failureReason: null,
            },
            actor,
          );
        }
        assertCanMessage(db.must('contacts', sms.contactId), 'sms');
        return db.update('sms', sms.id, { status: 'scheduled', scheduledAt: a.sendAt }, actor);
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'cancel_scheduled',
      title: 'Cancel scheduled SMS',
      collection: 'sms',
      idField: 'smsId',
      from: ['scheduled'],
      to: 'cancelled',
      effect: 'destructive',
      description: 'Cancel a scheduled text message before it is sent.',
    }),
    crud.get({
      code: 'A06',
      name: 'get',
      title: 'Get SMS details',
      collection: 'sms',
      idField: 'smsId',
      description: 'Get one SMS message by ID.',
    }),
    crud.search({
      code: 'A07',
      name: 'search',
      title: 'Search SMS messages',
      collection: 'sms',
      description: 'Search SMS messages by body text, contact, status, direction or sent date range.',
      text: ['body'],
      filters: {
        contactId: ref('contacts'),
        status: z.enum(['draft', 'scheduled', 'sent', 'cancelled', 'received']),
        direction: z.enum(['inbound', 'outbound']),
      },
      dates: { sent: 'sentAt', created: 'createdAt' },
    }),
    action({
      code: 'A08',
      name: 'delivery_status',
      title: 'Get SMS delivery status',
      effect: 'read',
      description: 'Get the carrier delivery status of a sent SMS.',
      input: z.object({ smsId: ref('sms') }),
      output: out.shape({ smsId: z.string(), status: z.string(), deliveryStatus: z.string().nullable() }),
      handler({ smsId }, { db }) {
        const m = db.must('sms', smsId);
        return {
          smsId: m.id,
          status: m.status,
          deliveryStatus: m.deliveryStatus ?? null,
          failureReason: m.failureReason ?? null,
          sentAt: m.sentAt,
        };
      },
    }),
    action({
      code: 'A09',
      name: 'receive_inbound',
      title: 'Receive simulated inbound SMS',
      effect: 'write',
      description:
        'Simulate an incoming text from a contact (adds it to their conversation). "STOP" opts them out.',
      input: z.object({ contactId: ref('contacts'), body: z.string().min(1) }),
      handler({ contactId, body }, { db, actor, clock }) {
        const c = db.must('contacts', contactId);
        const at = clock.nowIso();
        const conv = appendMessage(
          db,
          { contactId: c.id, channel: 'sms', direction: 'inbound', body, at },
          actor,
        );
        if (/^\s*(stop|unsubscribe)\s*$/i.test(body))
          db.update('contacts', c.id, { commPrefs: { ...c.commPrefs, sms: 'opted_out' } }, actor);
        return db.insert(
          'sms',
          {
            contactId: c.id,
            to: null,
            from: c.phone,
            body,
            status: 'received',
            direction: 'inbound',
            segments: smsSegments(body).segments,
            sentAt: at,
            deliveryStatus: 'delivered',
            conversationId: conv.id,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'record_opt_out',
      title: 'Record SMS opt-out',
      effect: 'write',
      description:
        'Record that a contact opted out of SMS; future texts to them are blocked and scheduled ones cancelled.',
      input: z.object({ contactId: ref('contacts') }),
      handler({ contactId }, { db, actor }) {
        const c = db.must('contacts', contactId);
        if (c.commPrefs.sms === 'opted_out') throw fail.conflict(`${c.name} is already opted out of SMS`);
        const cancelled = db.find('sms', (m) => m.contactId === c.id && m.status === 'scheduled');
        cancelled.forEach((m) => db.update('sms', m.id, { status: 'cancelled' }, actor));
        return {
          ...db.update('contacts', c.id, { commPrefs: { ...c.commPrefs, sms: 'opted_out' } }, actor),
          cancelledScheduled: cancelled.length,
        };
      },
    }),
  ],
};
