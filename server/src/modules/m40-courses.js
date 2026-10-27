import { z, ref, crud, action, fail } from '../core/kit.js';

const live = (c) => {
  if (c.status === 'archived') throw fail.state(`Course ${c.title} is archived`);
};

export default {
  id: 'courses',
  code: 'M40',
  title: 'Courses',
  description: 'Configure learning programs and their structure.',
  keywords: ['course', 'training', 'program', 'curriculum', 'class', 'learning', 'academy', 'instructor'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create course',
      collection: 'courses',
      description: 'Create a draft course.',
      fields: {
        title: z.string().min(1),
        description: z.string().optional(),
        instructorId: ref('users').optional(),
      },
      validate: (a, { db }) => {
        if (a.instructorId) db.must('users', a.instructorId);
      },
      defaults: () => ({
        description: '',
        sections: [],
        instructorId: null,
        prerequisites: [],
        status: 'draft',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get course details',
      collection: 'courses',
      idField: 'courseId',
      description: 'Get a course with sections, lessons and enrollment count.',
      enrich: (c, { db }) => ({
        lessonCount: db.find('lessons', (l) => l.courseId === c.id).length,
        enrollmentCount: db.find('enrollments', (e) => e.courseId === c.id && e.status === 'active').length,
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search courses',
      collection: 'courses',
      description: 'Search courses by title/description, status or instructor.',
      text: ['title', 'description'],
      filters: { status: z.enum(['draft', 'published', 'archived']), instructorId: ref('users') },
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update course details',
      collection: 'courses',
      idField: 'courseId',
      description: "Update a course's title or description.",
      fields: { title: z.string().min(1), description: z.string() },
      guard: live,
    }),
    action({
      code: 'A05',
      name: 'add_section',
      title: 'Add course section',
      effect: 'write',
      description: 'Add a section (module/chapter) to a course.',
      input: z.object({ courseId: ref('courses'), title: z.string().min(1) }),
      handler({ courseId, title }, { db, actor }) {
        const c = db.must('courses', courseId);
        live(c);
        if (c.sections.some((s) => s.title.toLowerCase() === title.toLowerCase()))
          throw fail.conflict(`Section "${title}" exists`);
        return db.update(
          'courses',
          c.id,
          {
            sections: [
              ...c.sections,
              { id: `csec_${db.nextId('_child').split('_').pop()}`, title, order: c.sections.length + 1 },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A06',
      name: 'reorder_sections',
      title: 'Reorder course sections',
      effect: 'write',
      description: 'Reorder course sections by listing every section ID in the new order.',
      input: z.object({ courseId: ref('courses'), sectionIds: z.array(z.string()).min(1) }),
      handler({ courseId, sectionIds }, { db, actor }) {
        const c = db.must('courses', courseId);
        live(c);
        if (
          [...sectionIds].sort().join() !==
          c.sections
            .map((x) => x.id)
            .sort()
            .join()
        )
          throw fail.validation('sectionIds must include every section exactly once', {
            sections: c.sections.map((x) => ({ id: x.id, title: x.title })),
          });
        return db.update(
          'courses',
          c.id,
          { sections: sectionIds.map((id, i) => ({ ...c.sections.find((x) => x.id === id), order: i + 1 })) },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'assign_instructor',
      title: 'Assign course instructor',
      collection: 'courses',
      idField: 'courseId',
      field: 'instructorId',
      schema: ref('users'),
      description: 'Set the instructor of a course.',
      guard: (c, a, { db }) => {
        live(c);
        const u = db.must('users', a.instructorId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    action({
      code: 'A08',
      name: 'set_prerequisites',
      title: 'Set course prerequisites',
      effect: 'write',
      description: 'Set which courses must be completed before this one (no self or circular prerequisites).',
      input: z.object({ courseId: ref('courses'), prerequisiteIds: z.array(ref('courses')) }),
      handler({ courseId, prerequisiteIds }, { db, actor }) {
        const c = db.must('courses', courseId);
        live(c);
        if (prerequisiteIds.includes(c.id)) throw fail.validation('A course cannot be its own prerequisite');
        for (const id of prerequisiteIds) {
          const p = db.must('courses', id);
          if (p.prerequisites.includes(c.id)) throw fail.validation(`Circular prerequisite with ${p.title}`);
        }
        return db.update('courses', c.id, { prerequisites: [...new Set(prerequisiteIds)] }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish course',
      effect: 'external',
      description: 'Publish a course to learners. Needs an instructor and at least one published lesson.',
      input: z.object({ courseId: ref('courses') }),
      handler({ courseId }, { db, actor }) {
        const c = db.must('courses', courseId);
        live(c);
        if (c.status === 'published') throw fail.conflict('Course is already published');
        const problems = [
          !c.instructorId && 'no instructor',
          !db.findOne('lessons', (l) => l.courseId === c.id && l.published) && 'no published lessons',
        ].filter(Boolean);
        if (problems.length)
          throw fail.state(`Course "${c.title}" cannot be published: ${problems.join(', ')}`, { problems });
        return db.update('courses', c.id, { status: 'published' }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'archive',
      title: 'Archive course',
      effect: 'destructive',
      description: 'Archive a course. Fails while learners have active enrollments.',
      input: z.object({ courseId: ref('courses') }),
      handler({ courseId }, { db, actor }) {
        const c = db.must('courses', courseId);
        live(c);
        const n = db.find('enrollments', (e) => e.courseId === c.id && e.status === 'active').length;
        if (n) throw fail.state(`${n} learners are actively enrolled in ${c.title}`);
        return db.update('courses', c.id, { status: 'archived' }, actor);
      },
    }),
  ],
};
