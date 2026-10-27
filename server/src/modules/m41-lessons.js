import { z, s, ref, crud, action, fail } from '../core/kit.js';

export default {
  id: 'lessons',
  code: 'M41',
  title: 'Lessons',
  description: 'Manage lesson content and completion conditions.',
  keywords: ['lesson', 'module', 'chapter', 'video lesson', 'unit', 'drip', 'completion criteria'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create lesson',
      effect: 'write',
      description: 'Create an unpublished lesson in a course section.',
      input: z.object({
        courseId: ref('courses'),
        sectionId: z.string().optional().meta({ description: 'Defaults to the first section' }),
        title: z.string().min(1),
        content: z.string().optional(),
      }),
      handler({ courseId, sectionId, title, content }, { db, actor }) {
        const c = db.must('courses', courseId);
        if (c.status === 'archived') throw fail.state(`Course ${c.title} is archived`);
        const sec = sectionId ? c.sections.find((x) => x.id === sectionId) : c.sections[0];
        if (!sec)
          throw fail.state(
            sectionId
              ? `Section ${sectionId} is not in ${c.title}`
              : `Course ${c.title} has no sections; add one first`,
          );
        const order = db.find('lessons', (l) => l.courseId === c.id).length + 1;
        return db.insert(
          'lessons',
          {
            courseId: c.id,
            sectionId: sec.id,
            title,
            content: content ?? '',
            mediaIds: [],
            releaseAt: null,
            completionCriteria: { type: 'view', minPercent: 80 },
            published: false,
            order,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get lesson details',
      collection: 'lessons',
      idField: 'lessonId',
      description: 'Get one lesson.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search lessons',
      collection: 'lessons',
      description: 'Search lessons by title/content, course, section or published state.',
      text: ['title', 'content'],
      filters: { courseId: ref('courses'), sectionId: z.string(), published: z.boolean() },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_content',
      title: 'Update lesson content',
      collection: 'lessons',
      idField: 'lessonId',
      field: 'content',
      schema: z.string().min(1),
      description: "Replace a lesson's content.",
    }),
    action({
      code: 'A05',
      name: 'attach_media',
      title: 'Attach lesson media',
      effect: 'write',
      description: 'Attach a media asset (video, PDF...) to a lesson.',
      input: z.object({ lessonId: ref('lessons'), assetId: ref('media_assets') }),
      handler({ lessonId, assetId }, { db, actor }) {
        const l = db.must('lessons', lessonId);
        const a = db.must('media_assets', assetId);
        if (a.status !== 'active') throw fail.state(`Asset ${a.name} was deleted`);
        if (l.mediaIds.includes(a.id)) throw fail.conflict('Asset already attached');
        return db.update('lessons', l.id, { mediaIds: [...l.mediaIds, a.id] }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'move_to_section',
      title: 'Move lesson to course section',
      effect: 'write',
      description: 'Move a lesson to another section of the same course.',
      input: z.object({ lessonId: ref('lessons'), sectionId: z.string().min(1) }),
      handler({ lessonId, sectionId }, { db, actor }) {
        const l = db.must('lessons', lessonId);
        const c = db.must('courses', l.courseId);
        if (!c.sections.some((x) => x.id === sectionId))
          throw fail.notFound('section', `${sectionId} in course ${c.title}`);
        if (l.sectionId === sectionId) throw fail.conflict('Lesson is already in that section');
        return db.update('lessons', l.id, { sectionId }, actor);
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'set_release_schedule',
      title: 'Set lesson release schedule',
      collection: 'lessons',
      idField: 'lessonId',
      field: 'releaseAt',
      schema: s.datetime('When the lesson unlocks').nullable(),
      description: 'Drip a lesson: unlock it at a date (null = immediately).',
    }),
    crud.setField({
      code: 'A08',
      name: 'set_completion_criteria',
      title: 'Set lesson completion criteria',
      collection: 'lessons',
      idField: 'lessonId',
      field: 'completionCriteria',
      schema: z.object({
        type: z.enum(['view', 'quiz', 'assignment']),
        minPercent: z.number().min(1).max(100).optional(),
        passScore: z.number().min(1).max(100).optional(),
      }),
      description: 'Define what completes a lesson (watch %, quiz pass score, assignment).',
      guard: (l, a) => {
        const c = a.completionCriteria;
        if (c.type === 'quiz' && !c.passScore) throw fail.validation('Quiz criteria need a passScore');
      },
    }),
    action({
      code: 'A09',
      name: 'publish',
      title: 'Publish lesson',
      effect: 'external',
      description: 'Publish a lesson to enrolled learners. Needs content.',
      input: z.object({ lessonId: ref('lessons') }),
      handler({ lessonId }, { db, actor }) {
        const l = db.must('lessons', lessonId);
        if (l.published) throw fail.conflict('Lesson is already published');
        if (!l.content && !l.mediaIds.length) throw fail.state(`Lesson "${l.title}" has no content or media`);
        return db.update('lessons', l.id, { published: true }, actor);
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'unpublish',
      title: 'Unpublish lesson',
      collection: 'lessons',
      idField: 'lessonId',
      field: 'published',
      from: [true],
      to: false,
      effect: 'external',
      description: 'Hide a lesson from learners.',
      label: 'Lesson (published flag)',
    }),
  ],
};
