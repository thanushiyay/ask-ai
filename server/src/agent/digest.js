const PRIORITY = [
  'id',
  'name',
  'title',
  'number',
  'subject',
  'code',
  'status',
  'email',
  'phone',
  'source',
  'ownerId',
  'contactId',
  'contactName',
  'leadId',
  'relatedTo',
  'priority',
  'dueDate',
  'startAt',
  'createdAt',
  'balance',
  'total',
  'amount',
  'value',
  'daysOverdue',
  'lastReminderAt',
  'category',
  'sentAt',
  'role',
  'available',
  'availableNow',
  'openTasks',
  'count',
  'stageId',
  'channel',
  'hasInbound',
  'rating',
];

export function digestRecord(rec, maxFields = 10) {
  if (rec == null || typeof rec !== 'object') return rec;
  if (Array.isArray(rec)) return rec.slice(0, 5).map((r) => digestRecord(r, maxFields));
  const out = {};
  const keys = [
    ...PRIORITY.filter((k) => k in rec),
    ...Object.keys(rec).filter((k) => !PRIORITY.includes(k)),
  ];
  for (const k of keys) {
    if (Object.keys(out).length >= maxFields) break;
    const v = rec[k];
    if (v === null || v === undefined || v === '') continue;
    if (
      [
        'updatedAt',
        'versions',
        'revisions',
        'messages',
        'executions',
        'firings',
        'csv',
        'auditTrail',
        'commPrefs',
        'customFields',
        'relationships',
        'variants',
        'qualification',
      ].includes(k)
    )
      continue;
    if (typeof v === 'string') out[k] = v.length > 90 ? `${v.slice(0, 87)}...` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) out[k] = v.slice(0, 6);
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else out[k] = digestRecord(v, 4);
  }
  return out;
}

/** Digest any action/op result. Lists keep total + the first `max` items. */
export function digestResult(value, max = 12) {
  if (Array.isArray(value))
    return {
      count: value.length,
      items: value.slice(0, max).map((r) => digestRecord(r)),
      ...(value.length > max ? { truncated: value.length - max } : {}),
    };
  if (value && typeof value === 'object' && Array.isArray(value.items)) {
    const out = {
      total: value.total ?? value.items.length,
      items: value.items.slice(0, max).map((r) => digestRecord(r)),
    };
    if (value.items.length > max) out.truncated = value.items.length - max;
    if (value.failed?.length)
      out.failed = value.failed.slice(0, 8).map((f) => ({ item: digestRecord(f.item, 4), error: f.error }));
    if (value.item) out.item = digestRecord(value.item, 14);
    return out;
  }
  if (value && typeof value === 'object') {
    const out = digestRecord(value, 16);
    for (const [k, v] of Object.entries(value)) {
      if (
        Array.isArray(v) &&
        v.length &&
        typeof v[0] === 'object' &&
        !(k in out) &&
        Object.keys(out).length < 20
      )
        out[k] = v.slice(0, 8).map((r) => digestRecord(r, 6));
    }
    return out;
  }
  return value;
}

export const displayName = (r) =>
  r?.name ?? r?.title ?? r?.number ?? r?.subject ?? r?.code ?? r?.id ?? String(r);
