import { z, ref, crud, action, fail, child, out } from '../core/kit.js';

const Q_TYPES = ['text', 'scale', 'single_choice', 'multiple_choice', 'yes_no'];
const notClosed = (s) => {
  if (s.status === 'closed') throw fail.state(`Survey ${s.name} is closed`);
};

export default {
  id: 'surveys',
  code: 'M19',
  title: 'Surveys',
  description: 'Collect feedback with branching questionnaires.',
  keywords: ['survey', 'questionnaire', 'feedback', 'nps', 'poll', 'question', 'responses'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create survey',
      collection: 'surveys',
      description: 'Create a draft survey.',
      fields: { name: z.string().min(1) },
      defaults: () => ({ questions: [], status: 'draft' }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get survey definition',
      collection: 'surveys',
      idField: 'surveyId',
      description: 'Get a survey with its questions and branching rules.',
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List surveys',
      collection: 'surveys',
      description: 'List surveys by name or status.',
      text: ['name'],
      filters: { status: z.enum(['draft', 'open', 'closed']) },
    }),
    action({
      code: 'A04',
      name: 'add_question',
      title: 'Add survey question',
      effect: 'write',
      description: 'Add a question (text, scale, single/multiple choice, yes/no) to a survey.',
      input: z.object({
        surveyId: ref('surveys'),
        text: z.string().min(1),
        type: z.enum(Q_TYPES),
        options: z.array(z.string()).optional(),
      }),
      handler({ surveyId, text, type, options }, { db, actor }) {
        const s = db.must('surveys', surveyId);
        notClosed(s);
        if (['single_choice', 'multiple_choice'].includes(type) && (options?.length ?? 0) < 2)
          throw fail.validation('Choice questions need at least two options');
        return db.update(
          'surveys',
          s.id,
          {
            questions: [
              ...s.questions,
              {
                id: `q_${db.nextId('_child').split('_').pop()}`,
                text,
                type,
                options: options ?? [],
                order: s.questions.length + 1,
                branching: [],
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A05',
      name: 'update_question',
      title: 'Update survey question',
      effect: 'write',
      description: 'Change the text, type or options of a survey question.',
      input: z.object({
        surveyId: ref('surveys'),
        questionId: z.string().min(1),
        text: z.string().optional(),
        type: z.enum(Q_TYPES).optional(),
        options: z.array(z.string()).optional(),
      }),
      handler({ surveyId, questionId, ...p }, { db, actor }) {
        const s = db.must('surveys', surveyId);
        notClosed(s);
        const q = child(s.questions, questionId, 'question');
        Object.entries(p).forEach(([k, v]) => v !== undefined && (q[k] = v));
        return db.update('surveys', s.id, { questions: s.questions }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'set_branching',
      title: 'Set question branching rules',
      effect: 'write',
      description: 'Set skip logic: if the answer to a question matches a value, jump to another question.',
      input: z.object({
        surveyId: ref('surveys'),
        questionId: z.string().min(1),
        rules: z.array(z.object({ ifAnswer: z.union([z.string(), z.number()]), gotoQuestionId: z.string() })),
      }),
      handler({ surveyId, questionId, rules }, { db, actor }) {
        const s = db.must('surveys', surveyId);
        notClosed(s);
        const q = child(s.questions, questionId, 'question');
        for (const r of rules) {
          const target = child(s.questions, r.gotoQuestionId, 'question');
          if (target.order <= q.order) throw fail.validation(`Branch to ${target.id} would loop backwards`);
        }
        q.branching = rules;
        return db.update('surveys', s.id, { questions: s.questions }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'publish',
      title: 'Publish survey',
      effect: 'external',
      description: 'Open a survey for responses. Needs at least one question.',
      input: z.object({ surveyId: ref('surveys') }),
      handler({ surveyId }, { db, actor }) {
        const s = db.must('surveys', surveyId);
        if (s.status !== 'draft') throw fail.state(`Survey ${s.name} is ${s.status}`);
        if (!s.questions.length) throw fail.state(`Survey ${s.name} has no questions`);
        return db.update('surveys', s.id, { status: 'open' }, actor);
      },
    }),
    crud.transition({
      code: 'A08',
      name: 'close',
      title: 'Close survey',
      collection: 'surveys',
      idField: 'surveyId',
      from: ['open'],
      to: 'closed',
      description: 'Stop accepting survey responses.',
    }),
    action({
      code: 'A09',
      name: 'submit_response',
      title: 'Submit simulated survey response',
      effect: 'write',
      description: 'Simulate a response (answers keyed by question ID).',
      input: z.object({
        surveyId: ref('surveys'),
        contactId: ref('contacts').optional(),
        answers: z.record(z.string(), z.any()),
      }),
      handler({ surveyId, contactId, answers }, { db, actor }) {
        const s = db.must('surveys', surveyId);
        if (s.status !== 'open') throw fail.state(`Survey ${s.name} is ${s.status}, not open`);
        if (contactId) db.must('contacts', contactId);
        for (const [qid, v] of Object.entries(answers)) {
          const q = child(s.questions, qid, 'question');
          if (q.type === 'scale' && (typeof v !== 'number' || v < 0 || v > 10))
            throw fail.validation(`Answer to "${q.text}" must be 0-10`);
          if (q.type === 'single_choice' && !q.options.includes(v))
            throw fail.validation(`Answer to "${q.text}" must be one of ${q.options.join(', ')}`);
        }
        return db.insert(
          'survey_responses',
          { surveyId: s.id, contactId: contactId ?? null, answers },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'response_summary',
      title: 'Get survey response summary',
      effect: 'read',
      description:
        'Aggregate survey responses: count, per-question averages/distributions, and NPS where applicable.',
      input: z.object({ surveyId: ref('surveys') }),
      output: out.shape({ surveyId: z.string(), responses: z.number(), questions: z.array(z.any()) }),
      handler({ surveyId }, { db }) {
        const s = db.must('surveys', surveyId);
        const rs = db.find('survey_responses', (r) => r.surveyId === s.id);
        const questions = s.questions.map((q) => {
          const vals = rs.map((r) => r.answers[q.id]).filter((v) => v !== undefined);
          if (q.type === 'scale') {
            const nums = vals.map(Number);
            const promoters = nums.filter((n) => n >= 9).length;
            const detractors = nums.filter((n) => n <= 6).length;
            return {
              id: q.id,
              text: q.text,
              answered: nums.length,
              average: nums.length
                ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
                : null,
              nps: nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null,
            };
          }
          const dist = {};
          vals.forEach((v) => (dist[v] = (dist[v] ?? 0) + 1));
          return { id: q.id, text: q.text, answered: vals.length, distribution: dist };
        });
        return { surveyId: s.id, name: s.name, responses: rs.length, questions };
      },
    }),
  ],
};
