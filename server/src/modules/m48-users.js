import { z, ref, crud, action, fail, out, listResult, norm } from '../core/kit.js';
import { isAvailableNow } from './_scheduling.js';

const ROLES = ['admin', 'sales_rep', 'support', 'marketing', 'instructor', 'viewer'];
const PERMS = {
  admin: ['*'],
  sales_rep: [
    'contacts:*',
    'leads:*',
    'opportunities:*',
    'tasks:*',
    'appointments:*',
    'email:send',
    'sms:send',
  ],
  support: ['contacts:read', 'tickets:*', 'conversations:*', 'tasks:*'],
  marketing: ['campaigns:*', 'templates:*', 'workflows:*', 'landing_pages:*', 'blogs:*', 'smart_lists:*'],
  instructor: ['courses:*', 'lessons:*', 'enrollments:read', 'communities:*'],
  viewer: ['*:read'],
};
const permsFor = (u) => [...new Set(u.roles.flatMap((r) => PERMS[r] ?? []))];

export default {
  id: 'users',
  code: 'M48',
  title: 'Users',
  description: 'Manage platform user accounts and access.',
  keywords: [
    'user',
    'team member',
    'staff',
    'employee',
    'sales rep',
    'rep',
    'agent',
    'role',
    'permission',
    'seat',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'invite',
      title: 'Invite user',
      effect: 'external',
      description: 'Invite a new teammate by email with a role.',
      input: z.object({ name: z.string().min(1), email: z.string().email(), role: z.enum(ROLES) }),
      handler({ name, email, role }, { db, actor }) {
        if (db.findOne('users', (u) => u.email.toLowerCase() === email.toLowerCase()))
          throw fail.conflict(`A user with ${email} already exists`);
        return db.insert(
          'users',
          { name, email, role, roles: [role], status: 'invited', title: null, timezone: 'UTC' },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get user profile',
      collection: 'users',
      idField: 'userId',
      description: "Get a user's profile, roles and status.",
      enrich: (u, { db, clock }) => ({ availableNow: isAvailableNow(db, clock, u) }),
    }),
    action({
      code: 'A03',
      name: 'list',
      title: 'List users',
      effect: 'read',
      description:
        'List users filtered by role (e.g. sales_rep), status, team, or availableNow=true (active and not out of office). Use to find available sales reps.',
      input: z.object({
        query: z.string().optional(),
        role: z.enum(ROLES).optional(),
        status: z.enum(['active', 'invited', 'deactivated']).optional(),
        teamId: ref('teams').optional(),
        availableNow: z.boolean().optional(),
      }),
      output: out.list,
      handler(a, { db, clock }) {
        const team = a.teamId ? db.must('teams', a.teamId) : null;
        const rows = db
          .find(
            'users',
            (u) =>
              (!a.query || norm(u.name).includes(norm(a.query)) || norm(u.email).includes(norm(a.query))) &&
              (!a.role || u.roles.includes(a.role)) &&
              (!a.status || u.status === a.status) &&
              (!team || team.memberIds.includes(u.id)) &&
              (a.availableNow == null || isAvailableNow(db, clock, u) === a.availableNow),
          )
          .map((u) => ({ ...u, availableNow: isAvailableNow(db, clock, u) }));
        return listResult(rows, 200);
      },
    }),
    crud.update({
      code: 'A04',
      name: 'update_profile',
      title: 'Update user profile',
      collection: 'users',
      idField: 'userId',
      description: "Update a user's name, title or timezone.",
      fields: { name: z.string().min(1), title: z.string(), timezone: z.string() },
    }),
    action({
      code: 'A05',
      name: 'assign_role',
      title: 'Assign user role',
      effect: 'write',
      description: 'Grant an additional role to a user.',
      input: z.object({ userId: ref('users'), role: z.enum(ROLES) }),
      handler({ userId, role }, { db, actor }) {
        const u = db.must('users', userId);
        if (u.roles.includes(role)) throw fail.conflict(`${u.name} already has role ${role}`);
        return db.update('users', u.id, { roles: [...u.roles, role] }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'revoke_role',
      title: 'Revoke user role',
      effect: 'destructive',
      description:
        'Remove a role from a user (a user keeps at least one role; the last admin cannot lose admin).',
      input: z.object({ userId: ref('users'), role: z.enum(ROLES) }),
      handler({ userId, role }, { db, actor }) {
        const u = db.must('users', userId);
        if (!u.roles.includes(role)) throw fail.state(`${u.name} does not have role ${role}`);
        if (u.roles.length === 1) throw fail.state('A user must keep at least one role');
        if (
          role === 'admin' &&
          db.find('users', (x) => x.status === 'active' && x.roles.includes('admin')).length === 1
        )
          throw fail.policy('Cannot remove the last admin');
        return db.update(
          'users',
          u.id,
          { roles: u.roles.filter((r) => r !== role), role: u.roles.filter((r) => r !== role)[0] },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'deactivate',
      title: 'Deactivate user',
      effect: 'destructive',
      description:
        'Deactivate a user account. Reports how many open tasks/leads they still own so they can be reassigned.',
      input: z.object({ userId: ref('users') }),
      handler({ userId }, { db, actor }) {
        const u = db.must('users', userId);
        if (u.status === 'deactivated') throw fail.conflict(`${u.name} is already deactivated`);
        if (
          u.roles.includes('admin') &&
          db.find('users', (x) => x.status === 'active' && x.roles.includes('admin')).length === 1
        )
          throw fail.policy('Cannot deactivate the last admin');
        const openTasks = db.find('tasks', (t) => t.ownerId === u.id && t.status === 'open').length;
        const openLeads = db.find(
          'leads',
          (l) => l.ownerId === u.id && ['new', 'contacted', 'qualified'].includes(l.status),
        ).length;
        return {
          ...db.update('users', u.id, { status: 'deactivated' }, actor),
          needsReassignment: { openTasks, openLeads },
        };
      },
    }),
    crud.transition({
      code: 'A08',
      name: 'reactivate',
      title: 'Reactivate user',
      collection: 'users',
      idField: 'userId',
      from: ['deactivated'],
      to: 'active',
      description: 'Reactivate a deactivated user.',
    }),
    action({
      code: 'A09',
      name: 'list_permissions',
      title: 'List user permissions',
      effect: 'read',
      description: 'Effective permissions a user has through their roles.',
      input: z.object({ userId: ref('users') }),
      output: out.shape({ userId: z.string(), permissions: z.array(z.string()) }),
      handler({ userId }, { db }) {
        const u = db.must('users', userId);
        return { userId: u.id, roles: u.roles, permissions: permsFor(u) };
      },
    }),
    action({
      code: 'A10',
      name: 'audit_activity',
      title: 'View user audit activity',
      effect: 'read',
      description: 'Recent audited actions by a user and changes to records they own.',
      input: z.object({ userId: ref('users'), limit: z.number().int().min(1).max(200).optional() }),
      output: out.shape({ userId: z.string(), events: z.array(z.any()) }),
      handler({ userId, limit = 50 }, { db }) {
        const u = db.must('users', userId);
        const owned = new Set(
          ['tasks', 'leads', 'contacts', 'opportunities', 'tickets'].flatMap((c) =>
            db.find(c, (r) => r.ownerId === u.id).map((r) => r.id),
          ),
        );
        const events = [...(u.auditTrail ?? []), ...db.log.filter((e) => e.actor === u.id || owned.has(e.id))]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit);
        return { userId: u.id, name: u.name, events };
      },
    }),
  ],
};
