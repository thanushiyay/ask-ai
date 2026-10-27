import { fail } from '../core/kit.js';

/** Append a message to the contact's conversation for a channel (creating it if needed). */
export function appendMessage(db, { contactId, channel, direction, body, at }, actor) {
  let conv = db.findOne(
    'conversations',
    (c) => c.contactId === contactId && c.channel === channel && c.status !== 'closed',
  );
  const contact = db.get('contacts', contactId);
  if (!conv) {
    conv = db.insert(
      'conversations',
      {
        contactId,
        channel,
        status: 'open',
        ownerId: contact?.ownerId ?? null,
        unread: false,
        messages: [],
        comments: [],
        lastMessageAt: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        hasInbound: false,
        awaitingReply: false,
        subject: `Conversation with ${contact?.name ?? contactId}`,
      },
      actor,
    );
  }
  const msg = { id: `msg_${db.nextId('_msg').split('_').pop()}`, direction, body, at, channel };
  conv.messages.push(msg);
  const patch = { lastMessageAt: at, awaitingReply: direction === 'inbound' };
  if (direction === 'inbound') Object.assign(patch, { lastInboundAt: at, hasInbound: true, unread: true });
  else patch.lastOutboundAt = at;
  db.update('conversations', conv.id, patch, actor);
  return conv;
}

/** Render {{var}} placeholders. Missing variables are reported, not silently blanked. */
export function render(text, vars) {
  const missing = new Set();
  const outText = (text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    if (vars[k] === undefined || vars[k] === null) {
      missing.add(k);
      return `{{${k}}}`;
    }
    return String(vars[k]);
  });
  return { text: outText, missing: [...missing] };
}

/** Variables available when rendering for a contact (and optional invoice / appointment). */
export function contactVars(db, contactId, extra = {}) {
  const c = contactId ? db.get('contacts', contactId) : null;
  const vars = c
    ? { first_name: c.firstName, last_name: c.lastName, full_name: c.name, email: c.email, phone: c.phone }
    : {};
  if (extra.invoiceId) {
    const inv = db.must('invoices', extra.invoiceId);
    Object.assign(vars, {
      invoice_number: inv.number,
      amount_due: `$${inv.balance.toFixed(2)}`,
      due_date: inv.dueDate?.slice(0, 10),
      invoice_total: `$${inv.total.toFixed(2)}`,
    });
  }
  vars.review_link = 'https://reviews.northwind.example/r';
  return { ...vars, ...(extra.variables ?? {}) };
}

export function smsSegments(body) {
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(body);
  const per = gsm ? (body.length > 160 ? 153 : 160) : body.length > 70 ? 67 : 70;
  return {
    encoding: gsm ? 'GSM-7' : 'UCS-2',
    characters: body.length,
    segments: Math.max(1, Math.ceil(body.length / per)),
    perSegment: per,
  };
}

export function assertCanMessage(contact, channel) {
  if (contact.status === 'archived') throw fail.policy(`${contact.name} is archived`);
  if (contact.commPrefs?.doNotContact) throw fail.policy(`${contact.name} is marked do-not-contact`);
  if (channel === 'sms') {
    if (!contact.phone) throw fail.validation(`${contact.name} has no phone number`);
    if (contact.commPrefs?.sms === 'opted_out') throw fail.policy(`${contact.name} has opted out of SMS`);
  }
  if (channel === 'email') {
    if (!contact.email) throw fail.validation(`${contact.name} has no email address`);
    if (contact.commPrefs?.email === 'unsubscribed')
      throw fail.policy(`${contact.name} has unsubscribed from email`);
  }
}

/** Resolve a module/record type name to its collection. */
export const COLLECTION_FOR = {
  contacts: 'contacts',
  leads: 'leads',
  companies: 'companies',
  opportunities: 'opportunities',
  tickets: 'tickets',
};
