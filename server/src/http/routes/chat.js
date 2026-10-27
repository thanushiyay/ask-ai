import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSession } from '../../agent/session.js';
import { openEventStream } from '../sse.js';

export const MAX_MESSAGE_LENGTH = 4000;

const ChatBody = z.object({
  sessionId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w-]+$/, 'sessionId may only contain letters, numbers, "-" and "_"')
    .default(() => randomUUID()),
  message: z
    .string()
    .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`)
    .default(''),
  agent: z.enum(['optimized', 'baseline']).default('optimized'),
  confirm: z.boolean().default(false),
  cancel: z.boolean().default(false),
});

function pendingSummary(pending) {
  if (!pending) return null;
  return {
    kind: pending.kind,
    preview: pending.preview ?? null,
    question: pending.question ?? null,
    options: pending.options ?? [],
  };
}

export function chatRoutes({ agents, state }) {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = ChatBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res
        .status(400)
        .json({ error: issue?.message ?? 'Invalid request', issues: parsed.error.issues });
    }
    const body = parsed.data;
    const agent = agents[body.agent];
    const session = getSession(body.sessionId);
    if (session.busy) {
      return res.status(409).json({
        error: 'Still finishing the previous request in this conversation — try again in a moment.',
      });
    }

    // Closing the tab or pressing Stop aborts planning; execution that already started is finished.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    const stream = openEventStream(res);
    const requestId = randomUUID();
    stream.send('start', { requestId, sessionId: body.sessionId, agent: agent.name });

    session.busy = true;
    try {
      const { reply, outcome, trace } = await agent.handle({
        session,
        world: state.world,
        message: body.message,
        confirm: body.confirm,
        cancel: body.cancel,
        requestId,
        signal: controller.signal,
        onEvent: (event) => stream.send(event.type, event),
      });
      const summary = trace.finish(outcome);
      state.recordTrace({ ...trace.toJSON(), reply });
      stream.send('done', { ...summary, reply, pending: pendingSummary(session.pending) });
    } catch (error) {
      console.error('Chat request failed:', error);
      stream.send('error', { message: 'Something went wrong on the server. Nothing further was changed.' });
    } finally {
      session.busy = false;
      stream.close();
    }
  });

  return router;
}
