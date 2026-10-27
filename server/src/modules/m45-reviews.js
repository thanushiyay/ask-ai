import { z, ref, crud, action, fail, out } from '../core/kit.js';
import { assertCanMessage } from './_shared.js';

export default {
  id: 'reviews',
  code: 'M45',
  title: 'Reviews',
  description: 'Collect and respond to customer reviews.',
  keywords: ['review', 'rating', 'testimonial', 'reputation', 'stars', 'feedback', 'google review'],
  actions: [
    action({
      code: 'A01',
      name: 'create_request',
      title: 'Create review request',
      effect: 'write',
      description: 'Prepare (not send) a review request to a contact via email or SMS.',
      input: z.object({
        contactId: ref('contacts'),
        channel: z.enum(['email', 'sms']),
        message: z.string().optional(),
      }),
      handler({ contactId, channel, message }, { db, actor }) {
        const c = db.must('contacts', contactId);
        if (
          db.findOne(
            'review_requests',
            (r) => r.contactId === c.id && ['draft', 'sent'].includes(r.status) && r.channel === channel,
          )
        )
          throw fail.conflict(`${c.name} already has an open ${channel} review request`);
        return db.insert(
          'review_requests',
          {
            contactId: c.id,
            channel,
            templateId: null,
            message: message ?? `Hi ${c.firstName}, would you leave us a quick review?`,
            status: 'draft',
            sentAt: null,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A02',
      name: 'send_request',
      title: 'Send review request',
      effect: 'external',
      description: 'Send a drafted review request to the customer.',
      input: z.object({ reviewRequestId: ref('review_requests') }),
      handler({ reviewRequestId }, { db, actor, clock }) {
        const r = db.must('review_requests', reviewRequestId);
        if (r.status !== 'draft') throw fail.state(`Review request is ${r.status}`);
        assertCanMessage(db.must('contacts', r.contactId), r.channel);
        return db.update('review_requests', r.id, { status: 'sent', sentAt: clock.nowIso() }, actor);
      },
    }),
    crud.transition({
      code: 'A03',
      name: 'cancel_request',
      title: 'Cancel unsent review request',
      collection: 'review_requests',
      idField: 'reviewRequestId',
      from: ['draft'],
      to: 'cancelled',
      effect: 'destructive',
      description: 'Cancel a review request that has not been sent.',
    }),
    crud.search({
      code: 'A04',
      name: 'list_requests',
      title: 'List review requests',
      collection: 'review_requests',
      description: 'List review requests by contact, channel or status.',
      text: ['message'],
      filters: {
        contactId: ref('contacts'),
        channel: z.enum(['email', 'sms']),
        status: z.enum(['draft', 'sent', 'cancelled']),
      },
    }),
    action({
      code: 'A05',
      name: 'record_review',
      title: 'Record simulated customer review',
      effect: 'write',
      description: 'Record a review a customer left (simulated) with rating 1-5.',
      input: z.object({
        contactId: ref('contacts'),
        rating: z.number().int().min(1).max(5),
        text: z.string().optional(),
        platform: z.enum(['google', 'facebook', 'trustpilot', 'yelp']).optional(),
      }),
      handler({ contactId, rating, text, platform }, { db, actor, clock }) {
        db.must('contacts', contactId);
        return db.insert(
          'reviews',
          {
            contactId,
            rating,
            text: text ?? '',
            platform: platform ?? 'google',
            response: null,
            publishedAt: clock.nowIso(),
          },
          actor,
        );
      },
    }),
    crud.search({
      code: 'A06',
      name: 'search',
      title: 'Search reviews',
      collection: 'reviews',
      description: 'Search reviews by text, platform, rating range, or whether they have a response.',
      text: ['text'],
      filters: { platform: z.enum(['google', 'facebook', 'trustpilot', 'yelp']), contactId: ref('contacts') },
      extraInput: {
        minRating: z.number().int().min(1).max(5).optional(),
        maxRating: z.number().int().min(1).max(5).optional(),
        unanswered: z.boolean().optional().meta({ description: 'Only reviews without a published response' }),
      },
      where: (r, a) =>
        (a.minRating == null || r.rating >= a.minRating) &&
        (a.maxRating == null || r.rating <= a.maxRating) &&
        (!a.unanswered || r.response?.status !== 'published'),
    }),
    crud.get({
      code: 'A07',
      name: 'get',
      title: 'Get review details',
      collection: 'reviews',
      idField: 'reviewId',
      description: 'Get one review with any response.',
    }),
    action({
      code: 'A08',
      name: 'draft_response',
      title: 'Draft review response',
      effect: 'write',
      description: 'Draft a public reply to a review (not yet published).',
      input: z.object({ reviewId: ref('reviews'), body: z.string().min(1).max(2000) }),
      handler({ reviewId, body }, { db, actor }) {
        const r = db.must('reviews', reviewId);
        if (r.response?.status === 'published')
          throw fail.state('This review already has a published response');
        return db.update('reviews', r.id, { response: { body, status: 'draft' } }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'publish_response',
      title: 'Publish review response',
      effect: 'external',
      description: 'Publish the drafted reply to a review publicly.',
      input: z.object({ reviewId: ref('reviews') }),
      handler({ reviewId }, { db, actor, clock }) {
        const r = db.must('reviews', reviewId);
        if (!r.response) throw fail.state('No drafted response; draft one first');
        if (r.response.status === 'published') throw fail.conflict('Response is already published');
        return db.update(
          'reviews',
          r.id,
          { response: { ...r.response, status: 'published', publishedAt: clock.nowIso() } },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'rating_summary',
      title: 'Get review rating summary',
      effect: 'read',
      description: 'Average rating, count, star distribution and response rate (optionally per platform).',
      input: z.object({ platform: z.enum(['google', 'facebook', 'trustpilot', 'yelp']).optional() }),
      output: out.shape({ count: z.number(), average: z.number().nullable() }),
      handler({ platform }, { db }) {
        const rs = db.find('reviews', (r) => !platform || r.platform === platform);
        const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        rs.forEach((r) => dist[r.rating]++);
        return {
          platform: platform ?? 'all',
          count: rs.length,
          average: rs.length
            ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 100) / 100
            : null,
          distribution: dist,
          responded: rs.filter((r) => r.response?.status === 'published').length,
          needsAttention: rs
            .filter((r) => r.rating <= 2 && r.response?.status !== 'published')
            .map((r) => r.id),
        };
      },
    }),
  ],
};
