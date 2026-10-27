import { z, s, ref, crud, action, fail, out } from '../core/kit.js';

const progressOf = (db, e) => {
  const lessons = db.find('lessons', (l) => l.courseId === e.courseId && l.published);
  const done = lessons.filter((l) => e.completedLessonIds.includes(l.id)).length;
  return {
    completed: done,
    total: lessons.length,
    percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
  };
};

export default {
  id: 'enrollments',
  code: 'M42',
  title: 'Enrollments',
  description: 'Manage learner access and learning progress.',
  keywords: [
    'enroll',
    'enrollment',
    'learner',
    'student',
    'progress',
    'certificate',
    'course access',
    'completion',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'enroll',
      title: 'Enroll learner in course',
      effect: 'write',
      description: 'Enroll a contact in a published course (checks prerequisites).',
      input: z.object({
        contactId: ref('contacts'),
        courseId: ref('courses'),
        expiresAt: s.datetime('Access expiry').optional(),
      }),
      handler({ contactId, courseId, expiresAt }, { db, actor }) {
        db.must('contacts', contactId);
        const c = db.must('courses', courseId);
        if (c.status !== 'published') throw fail.state(`Course ${c.title} is ${c.status}`);
        if (
          db.findOne(
            'enrollments',
            (e) => e.contactId === contactId && e.courseId === courseId && e.status !== 'revoked',
          )
        )
          throw fail.conflict('Contact is already enrolled');
        const missing = c.prerequisites.filter(
          (p) =>
            !db.findOne(
              'enrollments',
              (e) => e.contactId === contactId && e.courseId === p && e.status === 'completed',
            ),
        );
        if (missing.length)
          throw fail.state(
            `Prerequisites not completed: ${missing.map((id) => db.get('courses', id)?.title).join(', ')}`,
          );
        return db.insert(
          'enrollments',
          {
            contactId,
            courseId,
            status: 'active',
            expiresAt: expiresAt ?? null,
            completedLessonIds: [],
            certificateId: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get enrollment details',
      collection: 'enrollments',
      idField: 'enrollmentId',
      description: 'Get one enrollment with progress.',
      enrich: (e, { db }) => ({ progress: progressOf(db, e) }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search enrollments',
      collection: 'enrollments',
      description: 'Search enrollments by contact, course or status.',
      text: [],
      filters: {
        contactId: ref('contacts'),
        courseId: ref('courses'),
        status: z.enum(['active', 'suspended', 'revoked', 'completed']),
      },
    }),
    crud.setField({
      code: 'A04',
      name: 'set_expiry',
      title: 'Set enrollment expiry',
      collection: 'enrollments',
      idField: 'enrollmentId',
      field: 'expiresAt',
      schema: s.datetime('Access expiry').nullable(),
      description: 'Set when course access expires (null = never).',
      guard: (e) => {
        if (e.status === 'revoked') throw fail.state('Enrollment is revoked');
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'suspend',
      title: 'Suspend enrollment',
      collection: 'enrollments',
      idField: 'enrollmentId',
      from: ['active'],
      to: 'suspended',
      extraInput: { reason: z.string().optional() },
      description: "Temporarily suspend a learner's access.",
      patch: (a) => ({ suspendReason: a.reason ?? null }),
    }),
    crud.transition({
      code: 'A06',
      name: 'resume',
      title: 'Resume enrollment',
      collection: 'enrollments',
      idField: 'enrollmentId',
      from: ['suspended'],
      to: 'active',
      description: 'Restore a suspended enrollment.',
    }),
    crud.transition({
      code: 'A07',
      name: 'revoke',
      title: 'Revoke enrollment',
      collection: 'enrollments',
      idField: 'enrollmentId',
      from: ['active', 'suspended'],
      to: 'revoked',
      effect: 'destructive',
      description: "Permanently remove a learner's access to a course.",
    }),
    action({
      code: 'A08',
      name: 'record_lesson_completion',
      title: 'Record lesson completion',
      effect: 'write',
      description:
        'Mark a lesson complete for an enrolled learner; completing every lesson completes the enrollment.',
      input: z.object({ enrollmentId: ref('enrollments'), lessonId: ref('lessons') }),
      handler({ enrollmentId, lessonId }, { db, actor }) {
        const e = db.must('enrollments', enrollmentId);
        if (e.status !== 'active') throw fail.state(`Enrollment is ${e.status}`);
        const l = db.must('lessons', lessonId);
        if (l.courseId !== e.courseId) throw fail.validation('Lesson is from a different course');
        if (!l.published) throw fail.state('Lesson is not published');
        if (e.completedLessonIds.includes(l.id)) throw fail.conflict('Lesson already completed');
        const next = { ...e, completedLessonIds: [...e.completedLessonIds, l.id] };
        const p = progressOf(db, next);
        return {
          ...db.update(
            'enrollments',
            e.id,
            {
              completedLessonIds: next.completedLessonIds,
              status: p.completed === p.total ? 'completed' : 'active',
            },
            actor,
          ),
          progress: p,
        };
      },
    }),
    action({
      code: 'A09',
      name: 'progress',
      title: 'Get learner progress',
      effect: 'read',
      description: 'Lessons completed vs total for an enrollment.',
      input: z.object({ enrollmentId: ref('enrollments') }),
      output: out.shape({ enrollmentId: z.string(), percent: z.number() }),
      handler({ enrollmentId }, { db }) {
        const e = db.must('enrollments', enrollmentId);
        return { enrollmentId: e.id, status: e.status, ...progressOf(db, e) };
      },
    }),
    action({
      code: 'A10',
      name: 'issue_certificate',
      title: 'Issue course completion certificate',
      effect: 'external',
      description: 'Issue a completion certificate for a completed enrollment (emailed to the learner).',
      input: z.object({ enrollmentId: ref('enrollments') }),
      handler({ enrollmentId }, { db, actor, clock }) {
        const e = db.must('enrollments', enrollmentId);
        if (e.certificateId) throw fail.conflict('A certificate was already issued');
        const p = progressOf(db, e);
        if (e.status !== 'completed' && p.completed < p.total)
          throw fail.state(`Learner has completed ${p.completed}/${p.total} lessons`);
        const cert = db.insert(
          'certificates',
          {
            enrollmentId: e.id,
            contactId: e.contactId,
            courseId: e.courseId,
            issuedAt: clock.nowIso(),
            url: `https://learn.northwind.example/cert/${e.id}`,
          },
          actor,
        );
        db.update('enrollments', e.id, { certificateId: cert.id, status: 'completed' }, actor);
        return cert;
      },
    }),
  ],
};
