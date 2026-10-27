export const STOP = new Set(
  'a an and are as at be by for from has have i in into is it its me my of on or our please so that the their them then they this to us was we were will with you your can could would should want need help also all any some just let lets get make do does did im'.split(
    ' ',
  ),
);
/** General business vocabulary mapped to the platform's terms; not tied to any example prompt. */
export const SYNONYMS = {
  text: ['sms'],
  texts: ['sms'],
  txt: ['sms'],
  mail: ['email'],
  emails: ['email'],
  bill: ['invoice'],
  bills: ['invoice'],
  deal: ['opportunity'],
  deals: ['opportunity'],
  rep: ['user', 'sales'],
  reps: ['user', 'sales'],
  salesperson: ['user', 'sales'],
  meeting: ['appointment'],
  meetings: ['appointment'],
  booked: ['appointment', 'book'],
  booking: ['appointment', 'book'],
  customer: ['contact'],
  customers: ['contact'],
  client: ['contact'],
  clients: ['contact'],
  people: ['contact'],
  prospect: ['lead'],
  prospects: ['lead'],
  todo: ['task'],
  reminder: ['task', 'remind'],
  remind: ['reminder'],
  replied: ['reply', 'inbound', 'conversation'],
  reply: ['conversation', 'inbound'],
  respond: ['reply'],
  responded: ['reply', 'inbound'],
  unpaid: ['overdue', 'invoice', 'balance'],
  owe: ['invoice', 'balance'],
  late: ['overdue'],
  discount: ['coupon'],
  promo: ['coupon'],
  free: ['available', 'availability'],
  busy: ['availability', 'conflict'],
  vacation: ['block', 'availability'],
  ooo: ['block', 'availability'],
  automate: ['workflow', 'trigger'],
  automatically: ['workflow', 'trigger'],
  whenever: ['trigger', 'workflow'],
  stats: ['report', 'performance'],
  revenue: ['report', 'payment'],
  pay: ['payment', 'invoice'],
  paid: ['payment', 'invoice'],
  money: ['payment', 'invoice', 'revenue'],
  demo: ['appointment'],
  signup: ['form', 'lead'],
  webinar: ['event'],
  stock: ['inventory'],
  seats: ['quantity'],
};

// Deliberately light stemmer; it only has to be consistent (invoices, invoice -> invoic).
export function stem(w) {
  if (w.length <= 3) return w;
  let x = w;
  if (x.endsWith('ies') && x.length > 4) x = `${x.slice(0, -3)}y`;
  else if (x.endsWith('s') && !x.endsWith('ss') && !x.endsWith('us')) x = x.slice(0, -1);
  if (x.endsWith('ing') && x.length > 5) x = x.slice(0, -3);
  else if (x.endsWith('ed') && x.length > 4) x = x.slice(0, -2);
  if (x.endsWith('y') && x.length > 3) x = x.slice(0, -1);
  if (x.endsWith('e') && x.length > 3) x = x.slice(0, -1);
  return x;
}
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[_.]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

// Message content (quoted text, "saying …", text after a colon) is down-weighted so it does not drive tool choice.
// A quote only opens at the start or after whitespace/bracket and only closes before whitespace or
// punctuation, so apostrophes inside words ("can't", "John's") are never mistaken for quotes.
const QUOTED = /(^|[\s([{])(["'“‘])([^"“”]{3,}?)(["'”’])(?=$|[\s.,!?;:)\]}])/g;
// "message:" style colons, but not clock times such as 3:30 or 10:00.
const CONTENT_COLON = /(?<!\d):|:(?!\d)/;

export function splitInstruction(query) {
  const content = [];
  let instr = String(query).replace(QUOTED, (_, lead, _open, inner) => {
    content.push(inner);
    return `${lead} `;
  });
  instr = instr.replace(
    /\b(saying|that says|to say|with the message|message:)\s+(.{12,})$/i,
    (_, k, rest) => {
      content.push(rest);
      return ` ${k} `;
    },
  );
  const colon = instr.search(CONTENT_COLON);
  if (colon > 8 && colon < instr.length - 4) {
    content.push(instr.slice(colon + 1));
    instr = instr.slice(0, colon);
  }
  return { instruction: instr, content: content.join(' ') };
}
