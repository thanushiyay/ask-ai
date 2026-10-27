import { z, ref, crud, action, fail, child } from '../core/kit.js';

const member = (c, contactId) => {
  if (!c.memberIds.includes(contactId)) throw fail.policy('Contact is not a member of this community');
};

export default {
  id: 'communities',
  code: 'M43',
  title: 'Communities',
  description: 'Operate discussion spaces and moderate content.',
  keywords: ['community', 'forum', 'group', 'discussion', 'channel', 'post', 'moderation', 'spam', 'members'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create community',
      collection: 'communities',
      description: 'Create a discussion community with a #general channel.',
      fields: { name: z.string().min(1), description: z.string().optional() },
      validate: (a, { db }) => {
        if (db.findOne('communities', (c) => c.name.toLowerCase() === a.name.toLowerCase()))
          throw fail.conflict(`Community "${a.name}" exists`);
      },
      defaults: () => ({
        description: '',
        guidelines: '',
        channels: [{ id: 'ch_general_new', name: 'general' }],
        memberIds: [],
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get community details',
      collection: 'communities',
      idField: 'communityId',
      description: 'Get a community with channels, member count and recent posts.',
      enrich: (c, { db }) => ({
        memberCount: c.memberIds.length,
        postCount: db.find('community_posts', (p) => p.communityId === c.id && p.status === 'visible').length,
        reportedPosts: db
          .find('community_posts', (p) => p.communityId === c.id && p.reported && p.status === 'visible')
          .map((p) => p.id),
      }),
    }),
    crud.setField({
      code: 'A03',
      name: 'update_guidelines',
      title: 'Update community guidelines',
      collection: 'communities',
      idField: 'communityId',
      field: 'guidelines',
      schema: z.string().min(1).max(5000),
      description: 'Replace the community rules/guidelines text.',
    }),
    action({
      code: 'A04',
      name: 'create_channel',
      title: 'Create discussion channel',
      effect: 'write',
      description: 'Add a discussion channel to a community.',
      input: z.object({
        communityId: ref('communities'),
        name: z
          .string()
          .regex(/^[a-z0-9-]{2,30}$/)
          .meta({ description: 'lowercase-with-dashes' }),
      }),
      handler({ communityId, name }, { db, actor }) {
        const c = db.must('communities', communityId);
        if (c.channels.some((x) => x.name === name)) throw fail.conflict(`#${name} already exists`);
        return db.update(
          'communities',
          c.id,
          { channels: [...c.channels, { id: `ch_${db.nextId('_child').split('_').pop()}`, name }] },
          actor,
        );
      },
    }),
    action({
      code: 'A05',
      name: 'join',
      title: 'Join community',
      effect: 'write',
      description: 'Add a contact as a community member.',
      input: z.object({ communityId: ref('communities'), contactId: ref('contacts') }),
      handler({ communityId, contactId }, { db, actor }) {
        const c = db.must('communities', communityId);
        db.must('contacts', contactId);
        if (c.memberIds.includes(contactId)) throw fail.conflict('Already a member');
        return db.update('communities', c.id, { memberIds: [...c.memberIds, contactId] }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'leave',
      title: 'Leave community',
      effect: 'write',
      description: 'Remove a contact from a community.',
      input: z.object({ communityId: ref('communities'), contactId: ref('contacts') }),
      handler({ communityId, contactId }, { db, actor }) {
        const c = db.must('communities', communityId);
        member(c, contactId);
        return db.update(
          'communities',
          c.id,
          { memberIds: c.memberIds.filter((x) => x !== contactId) },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'create_post',
      title: 'Create community post',
      effect: 'external',
      description: 'Publish a post in a community channel as a member.',
      input: z.object({
        communityId: ref('communities'),
        channelId: z.string().min(1),
        authorContactId: ref('contacts'),
        body: z.string().min(1).max(5000),
      }),
      handler({ communityId, channelId, authorContactId, body }, { db, actor }) {
        const c = db.must('communities', communityId);
        child(c.channels, channelId, 'channel');
        member(c, authorContactId);
        return db.insert(
          'community_posts',
          {
            communityId: c.id,
            channelId,
            authorContactId,
            body,
            replies: [],
            pinned: false,
            reported: false,
            reportReason: null,
            status: 'visible',
          },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'reply_to_post',
      title: 'Reply to community post',
      effect: 'external',
      description: 'Reply to a community post as a member.',
      input: z.object({
        postId: ref('community_posts'),
        authorContactId: ref('contacts'),
        body: z.string().min(1),
      }),
      handler({ postId, authorContactId, body }, { db, actor, clock }) {
        const p = db.must('community_posts', postId);
        if (p.status !== 'visible') throw fail.state('Post was removed');
        member(db.must('communities', p.communityId), authorContactId);
        return db.update(
          'community_posts',
          p.id,
          {
            replies: [
              ...p.replies,
              { id: `rep_${p.replies.length + 1}`, authorContactId, body, at: clock.nowIso() },
            ],
          },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A09',
      name: 'pin_post',
      title: 'Pin community post',
      collection: 'community_posts',
      idField: 'postId',
      field: 'pinned',
      schema: z.literal(true).optional(),
      description: 'Pin a post to the top of its channel.',
      guard: (p) => {
        if (p.status !== 'visible') throw fail.state('Post was removed');
        if (p.pinned) throw fail.conflict('Post is already pinned');
      },
      transform: () => ({ pinned: true }),
    }),
    action({
      code: 'A10',
      name: 'remove_reported_post',
      title: 'Remove reported post',
      effect: 'destructive',
      description: 'Remove a post that members reported (moderation).',
      input: z.object({ postId: ref('community_posts'), reason: z.string().optional() }),
      handler({ postId, reason }, { db, actor, clock }) {
        const p = db.must('community_posts', postId);
        if (p.status !== 'visible') throw fail.conflict('Post was already removed');
        if (!p.reported) throw fail.policy('Only reported posts can be removed with this action');
        return db.update(
          'community_posts',
          p.id,
          { status: 'removed', removedAt: clock.nowIso(), removalReason: reason ?? p.reportReason },
          actor,
        );
      },
    }),
  ],
};
