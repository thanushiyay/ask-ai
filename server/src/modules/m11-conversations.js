import { z, ref, crud, action, fail, out, listResult } from '../core/kit.js';

export default {
  id: 'conversations',
  code: 'M11',
  title: 'Conversations',
  description: 'Manage conversation threads across channels.',
  keywords: [
    'conversation',
    'thread',
    'inbox',
    'message',
    'reply',
    'replied',
    'chat',
    'unanswered',
    'responded',
  ],
  actions: [
    crud.get({
      code: 'A01',
      name: 'get',
      title: 'Get conversation',
      collection: 'conversations',
      idField: 'conversationId',
      description: 'Get a conversation thread with all messages and internal comments.',
    }),
    crud.search({
      code: 'A02',
      name: 'search',
      title: 'Search conversations',
      collection: 'conversations',
      description:
        'Search conversation threads. Use contactIds to check many contacts at once. hasInbound=true means the contact has replied/sent at least one message; hasInbound=false means they never replied. awaitingReply=true means the last message is from the contact (we owe a reply).',
      text: ['subject'],
      filters: {
        contactId: ref('contacts'),
        channel: z.enum(['email', 'sms', 'chat']),
        status: z.enum(['open', 'closed']),
        ownerId: ref('users'),
        unread: z.boolean(),
        hasInbound: z.boolean(),
        awaitingReply: z.boolean(),
      },
      dates: { lastMessage: 'lastMessageAt', lastInbound: 'lastInboundAt' },
      extraInput: {
        contactIds: z
          .array(z.string())
          .optional()
          .meta({ description: 'Conversations for any of these contacts' }),
      },
      where: (c, a) => !a.contactIds || a.contactIds.includes(c.contactId),
    }),
    crud.setField({
      code: 'A03',
      name: 'assign_owner',
      title: 'Assign conversation owner',
      collection: 'conversations',
      idField: 'conversationId',
      field: 'ownerId',
      schema: ref('users'),
      description: 'Assign a conversation to a user.',
      guard: (c, a, { db }) => {
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    crud.transition({
      code: 'A04',
      name: 'mark_read',
      title: 'Mark conversation read',
      collection: 'conversations',
      idField: 'conversationId',
      field: 'unread',
      from: [true],
      to: false,
      description: 'Mark a conversation as read.',
      label: 'Conversation (unread flag)',
    }),
    crud.transition({
      code: 'A05',
      name: 'mark_unread',
      title: 'Mark conversation unread',
      collection: 'conversations',
      idField: 'conversationId',
      field: 'unread',
      from: [false],
      to: true,
      description: 'Mark a conversation as unread.',
      label: 'Conversation (unread flag)',
    }),
    crud.transition({
      code: 'A06',
      name: 'close',
      title: 'Close conversation',
      collection: 'conversations',
      idField: 'conversationId',
      from: ['open'],
      to: 'closed',
      description: 'Close a conversation thread.',
    }),
    crud.transition({
      code: 'A07',
      name: 'reopen',
      title: 'Reopen conversation',
      collection: 'conversations',
      idField: 'conversationId',
      from: ['closed'],
      to: 'open',
      description: 'Reopen a closed conversation.',
    }),
    action({
      code: 'A08',
      name: 'add_comment',
      title: 'Add internal comment',
      effect: 'write',
      description: 'Add an internal (team-only, not sent to the customer) comment to a conversation.',
      input: z.object({ conversationId: ref('conversations'), body: z.string().min(1) }),
      handler({ conversationId, body }, { db, actor, clock }) {
        const c = db.must('conversations', conversationId);
        return db.update(
          'conversations',
          c.id,
          {
            comments: [
              ...c.comments,
              { id: `cmt_${c.comments.length + 1}`, body, at: clock.nowIso(), by: actor },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'summarize',
      title: 'Summarize conversation history',
      effect: 'read',
      description:
        'Summarize a conversation: message counts, who spoke last, open questions and the latest messages.',
      input: z.object({ conversationId: ref('conversations') }),
      output: out.shape({
        conversationId: z.string(),
        summary: z.string(),
        stats: z.record(z.string(), z.any()),
      }),
      handler({ conversationId }, { db }) {
        const c = db.must('conversations', conversationId);
        const contact = db.get('contacts', c.contactId);
        const inbound = c.messages.filter((m) => m.direction === 'inbound');
        const questions = inbound.filter((m) => m.body.includes('?')).map((m) => m.body);
        const last = c.messages.at(-1);
        const summary =
          `${c.messages.length} messages with ${contact?.name ?? 'contact'} over ${c.channel}. ${inbound.length ? `${contact?.firstName ?? 'They'} sent ${inbound.length}.` : 'The contact has never replied.'} ${last ? `Last message (${last.direction}) on ${last.at.slice(0, 10)}: "${last.body.slice(0, 120)}".` : ''} ${questions.length ? `Open questions: ${questions.join(' | ')}` : ''} ${c.awaitingReply ? 'A reply from the team is pending.' : ''}`
            .replace(/\s+/g, ' ')
            .trim();
        return {
          conversationId: c.id,
          summary,
          stats: {
            messages: c.messages.length,
            inbound: inbound.length,
            outbound: c.messages.length - inbound.length,
            awaitingReply: c.awaitingReply,
            comments: c.comments.length,
          },
        };
      },
    }),
    action({
      code: 'A10',
      name: 'list_unanswered',
      title: 'List unanswered conversations',
      effect: 'read',
      description:
        'List open conversations where the customer wrote last and the team has not replied yet, oldest first.',
      input: z.object({
        ownerId: ref('users').optional(),
        olderThanHours: z.number().min(0).optional(),
        channel: z.enum(['email', 'sms', 'chat']).optional(),
      }),
      output: out.list,
      handler({ ownerId, olderThanHours, channel }, { db, clock }) {
        const rows = db
          .find(
            'conversations',
            (c) =>
              c.status === 'open' &&
              c.awaitingReply &&
              (!ownerId || c.ownerId === ownerId) &&
              (!channel || c.channel === channel) &&
              (olderThanHours == null ||
                clock.now() - new Date(c.lastInboundAt) >= olderThanHours * 3600_000),
          )
          .sort((a, b) => a.lastInboundAt.localeCompare(b.lastInboundAt));
        return listResult(rows, 100);
      },
    }),
  ],
};
