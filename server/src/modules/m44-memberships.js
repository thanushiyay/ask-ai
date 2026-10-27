import { z, s, ref, crud, action, fail, out } from '../core/kit.js';

const ENT_COLLECTION = { course: 'courses', community: 'communities' };
const activeGrant = (m, clock) =>
  m.status === 'active' && (!m.expiresAt || new Date(m.expiresAt) > clock.now());

export default {
  id: 'memberships',
  code: 'M44',
  title: 'Memberships',
  description: 'Manage access packages spanning courses and communities.',
  keywords: ['membership', 'member', 'access', 'plan', 'entitlement', 'package', 'tier', 'premium access'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create_plan',
      title: 'Create membership plan',
      collection: 'membership_plans',
      description: 'Create a membership plan (an access package).',
      fields: { name: z.string().min(1), description: z.string().optional() },
      validate: (a, { db }) => {
        if (db.findOne('membership_plans', (p) => p.name.toLowerCase() === a.name.toLowerCase()))
          throw fail.conflict(`Plan "${a.name}" exists`);
      },
      defaults: () => ({ description: '', entitlements: [], status: 'active' }),
    }),
    crud.get({
      code: 'A02',
      name: 'get_plan',
      title: 'Get membership plan',
      collection: 'membership_plans',
      idField: 'planId',
      description: 'Get a plan with entitlements and member count.',
      enrich: (p, { db }) => ({
        activeMembers: db.find('memberships', (m) => m.planId === p.id && m.status === 'active').length,
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'list_plans',
      title: 'List membership plans',
      collection: 'membership_plans',
      description: 'List membership plans.',
      text: ['name', 'description'],
    }),
    crud.setField({
      code: 'A04',
      name: 'update_plan_description',
      title: 'Update plan description',
      collection: 'membership_plans',
      idField: 'planId',
      field: 'description',
      schema: z.string().min(1),
      description: "Update a plan's description.",
    }),
    action({
      code: 'A05',
      name: 'add_entitlement',
      title: 'Add plan entitlement',
      effect: 'write',
      description: 'Give a plan access to a course or community.',
      input: z.object({
        planId: ref('membership_plans'),
        type: z.enum(['course', 'community']),
        resourceId: z.string().min(1),
      }),
      handler({ planId, type, resourceId }, { db, actor }) {
        const p = db.must('membership_plans', planId);
        db.must(ENT_COLLECTION[type], resourceId, ENT_COLLECTION[type]);
        if (p.entitlements.some((e) => e.id === resourceId))
          throw fail.conflict('Plan already includes that resource');
        return db.update(
          'membership_plans',
          p.id,
          { entitlements: [...p.entitlements, { type, id: resourceId }] },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'remove_entitlement',
      title: 'Remove plan entitlement',
      effect: 'destructive',
      description: 'Remove a course/community from a plan (members lose that access).',
      input: z.object({ planId: ref('membership_plans'), resourceId: z.string().min(1) }),
      handler({ planId, resourceId }, { db, actor }) {
        const p = db.must('membership_plans', planId);
        if (!p.entitlements.some((e) => e.id === resourceId))
          throw fail.state('Plan does not include that resource');
        return db.update(
          'membership_plans',
          p.id,
          { entitlements: p.entitlements.filter((e) => e.id !== resourceId) },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'grant',
      title: 'Grant membership to contact',
      effect: 'write',
      description: 'Give a contact a membership plan, optionally until an expiry date.',
      input: z.object({
        planId: ref('membership_plans'),
        contactId: ref('contacts'),
        expiresAt: s.datetime('Expiry').optional(),
      }),
      handler({ planId, contactId, expiresAt }, { db, actor, clock }) {
        db.must('membership_plans', planId);
        db.must('contacts', contactId);
        if (
          db.findOne(
            'memberships',
            (m) => m.planId === planId && m.contactId === contactId && activeGrant(m, clock),
          )
        )
          throw fail.conflict('Contact already has this membership');
        if (expiresAt && new Date(expiresAt) <= clock.now())
          throw fail.validation('Expiry must be in the future');
        return db.insert(
          'memberships',
          { planId, contactId, status: 'active', expiresAt: expiresAt ?? null },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_expiry',
      title: 'Set membership expiry',
      collection: 'memberships',
      idField: 'membershipId',
      field: 'expiresAt',
      schema: s.datetime('Expiry').nullable(),
      description: 'Change when a membership expires (null = never).',
      guard: (m) => {
        if (m.status !== 'active') throw fail.state(`Membership is ${m.status}`);
      },
    }),
    crud.transition({
      code: 'A09',
      name: 'revoke',
      title: 'Revoke membership',
      collection: 'memberships',
      idField: 'membershipId',
      from: ['active'],
      to: 'revoked',
      effect: 'destructive',
      description: "Revoke a contact's membership immediately.",
    }),
    action({
      code: 'A10',
      name: 'check_access',
      title: 'Check member access',
      effect: 'read',
      description: 'Check whether a contact can access a course or community, and through which plan.',
      input: z.object({ contactId: ref('contacts'), resourceId: z.string().min(1) }),
      output: out.shape({ contactId: z.string(), hasAccess: z.boolean() }),
      handler({ contactId, resourceId }, { db, clock }) {
        db.must('contacts', contactId);
        const via = db
          .find('memberships', (m) => m.contactId === contactId && activeGrant(m, clock))
          .filter((m) => db.get('membership_plans', m.planId)?.entitlements.some((e) => e.id === resourceId));
        const direct = db.findOne(
          'enrollments',
          (e) =>
            e.contactId === contactId &&
            e.courseId === resourceId &&
            ['active', 'completed'].includes(e.status),
        );
        return {
          contactId,
          resourceId,
          hasAccess: Boolean(via.length || direct),
          viaPlans: via.map((m) => m.planId),
          viaEnrollment: direct?.id ?? null,
        };
      },
    }),
  ],
};
