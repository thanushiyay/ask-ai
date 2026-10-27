import { z, ref, crud, action, fail, out } from '../core/kit.js';
import { isAvailableNow } from './_scheduling.js';

const live = (t) => {
  if (t.status !== 'active') throw fail.state(`Team ${t.name} is archived`);
};

export default {
  id: 'teams',
  code: 'M49',
  title: 'Teams',
  description: 'Organize users and shared work allocation.',
  keywords: [
    'team',
    'group',
    'department',
    'workload',
    'capacity',
    'round robin',
    'assignment',
    'distribute',
    'who is free',
    'available reps',
  ],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create team',
      collection: 'teams',
      description: 'Create a team, optionally with members.',
      fields: { name: z.string().min(1), memberIds: z.array(ref('users')).optional() },
      validate: (a, { db }) => {
        if (db.findOne('teams', (t) => t.name.toLowerCase() === a.name.toLowerCase()))
          throw fail.conflict(`Team "${a.name}" exists`);
        (a.memberIds ?? []).forEach((id) => db.must('users', id));
      },
      defaults: () => ({
        memberIds: [],
        managerId: null,
        assignmentStrategy: 'round_robin',
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get team details',
      collection: 'teams',
      idField: 'teamId',
      description: 'Get a team with its members.',
      enrich: (t, { db }) => ({
        members: t.memberIds
          .map((id) => db.get('users', id))
          .filter(Boolean)
          .map((u) => ({ id: u.id, name: u.name, role: u.role, status: u.status })),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List teams',
      collection: 'teams',
      description: 'List teams.',
      text: ['name'],
      hide: (t) => t.status !== 'active',
    }),
    crud.setField({
      code: 'A04',
      name: 'rename',
      title: 'Rename team',
      collection: 'teams',
      idField: 'teamId',
      field: 'name',
      schema: z.string().min(1),
      description: 'Rename a team.',
      guard: live,
    }),
    action({
      code: 'A05',
      name: 'add_member',
      title: 'Add team member',
      effect: 'write',
      description: 'Add a user to a team.',
      input: z.object({ teamId: ref('teams'), userId: ref('users') }),
      handler({ teamId, userId }, { db, actor }) {
        const t = db.must('teams', teamId);
        live(t);
        db.must('users', userId);
        if (t.memberIds.includes(userId)) throw fail.conflict('Already a member');
        return db.update('teams', t.id, { memberIds: [...t.memberIds, userId] }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'remove_member',
      title: 'Remove team member',
      effect: 'write',
      description: 'Remove a user from a team (not the manager).',
      input: z.object({ teamId: ref('teams'), userId: ref('users') }),
      handler({ teamId, userId }, { db, actor }) {
        const t = db.must('teams', teamId);
        live(t);
        if (!t.memberIds.includes(userId)) throw fail.state('User is not on this team');
        if (t.managerId === userId) throw fail.state('Assign a different manager before removing this user');
        return db.update('teams', t.id, { memberIds: t.memberIds.filter((x) => x !== userId) }, actor);
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'assign_manager',
      title: 'Assign team manager',
      collection: 'teams',
      idField: 'teamId',
      field: 'managerId',
      schema: ref('users'),
      description: 'Make a user the team manager (added as a member if needed).',
      guard: (t, a, { db }) => {
        live(t);
        const u = db.must('users', a.managerId);
        if (u.status !== 'active') throw fail.state(`${u.name} is ${u.status}`);
      },
      transform: (a, t) => ({
        managerId: a.managerId,
        memberIds: [...new Set([...t.memberIds, a.managerId])],
      }),
    }),
    crud.setField({
      code: 'A08',
      name: 'set_assignment_strategy',
      title: 'Set team assignment strategy',
      collection: 'teams',
      idField: 'teamId',
      field: 'assignmentStrategy',
      schema: z.enum(['round_robin', 'least_busy', 'manual']),
      description: 'How new work is distributed across the team.',
      guard: live,
    }),
    action({
      code: 'A09',
      name: 'workload',
      title: 'Get team workload',
      effect: 'read',
      description:
        'Per-member workload (open tasks, open leads, upcoming appointments) and availability right now — use to pick available reps and balance assignments.',
      input: z.object({
        teamId: ref('teams').optional().meta({ description: 'Defaults to the Sales team' }),
      }),
      output: out.shape({
        teamId: z.string(),
        members: z.array(
          z
            .object({
              userId: z.string(),
              name: z.string(),
              available: z.boolean(),
              openTasks: z.number(),
              openLeads: z.number(),
              upcomingAppointments: z.number(),
            })
            .loose(),
        ),
      }),
      handler({ teamId }, { db, clock }) {
        const t = teamId ? db.must('teams', teamId) : db.findOne('teams', (x) => x.name === 'Sales');
        if (!t) throw fail.notFound('team', teamId ?? 'Sales');
        const members = t.memberIds
          .map((id) => db.get('users', id))
          .filter(Boolean)
          .map((u) => ({
            userId: u.id,
            name: u.name,
            status: u.status,
            available: isAvailableNow(db, clock, u),
            openTasks: db.find('tasks', (x) => x.ownerId === u.id && x.status === 'open').length,
            openLeads: db.find(
              'leads',
              (x) => x.ownerId === u.id && ['new', 'contacted', 'qualified'].includes(x.status),
            ).length,
            upcomingAppointments: db.find(
              'appointments',
              (x) => x.hostId === u.id && x.status === 'booked' && new Date(x.startAt) > clock.now(),
            ).length,
          }))
          .sort((a, b) => a.openTasks + a.openLeads - (b.openTasks + b.openLeads));
        return {
          teamId: t.id,
          name: t.name,
          strategy: t.assignmentStrategy,
          members,
          availableMemberIds: members.filter((m) => m.available).map((m) => m.userId),
        };
      },
    }),
    action({
      code: 'A10',
      name: 'archive',
      title: 'Archive team',
      effect: 'destructive',
      description: 'Archive a team (members are not affected).',
      input: z.object({ teamId: ref('teams') }),
      handler({ teamId }, { db, actor }) {
        const t = db.must('teams', teamId);
        live(t);
        return db.update('teams', t.id, { status: 'archived' }, actor);
      },
    }),
  ],
};
