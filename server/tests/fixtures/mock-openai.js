// Test-only OpenAI-compatible stub that returns scripted plans.
import express from 'express';

export function startMockOpenAI(script) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  const calls = [];
  app.post('/v1/chat/completions', (req, res) => {
    const { messages, stream, tools } = req.body;
    const sys = messages[0]?.content ?? '';
    const user = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const request = (user.split('## User request\n')[1] ?? user).trim();
    let content = '';
    let toolCalls = null;
    if (sys.includes('planning brain')) {
      const entry = script.plans.find((p) => request.includes(p.match));
      content = JSON.stringify(
        entry
          ? typeof entry.plan === 'function'
            ? entry.plan(user)
            : entry.plan
          : { message: 'I cannot help with that.', kind: 'unsupported', steps: [] },
      );
    } else if (tools) {
      toolCalls = script.baseline?.(messages) ?? null;
      content = toolCalls ? '' : 'Done.';
    } else content = script.summary ?? 'Summary of what happened.';
    calls.push({ kind: sys.includes('planning brain') ? 'plan' : tools ? 'baseline' : 'summary', request });
    const usage = {
      prompt_tokens: 1200,
      completion_tokens: 80,
      prompt_tokens_details: { cached_tokens: 1024 },
    };
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk = (delta, extra = {}) =>
        res.write(
          `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`,
        );
      for (let i = 0; i < content.length; i += 40) chunk({ content: content.slice(i, i + 40) });
      res.write(
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [], usage })}\n\n`,
      );
      res.end('data: [DONE]\n\n');
      return;
    }
    res.json({
      id: 'x',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
          finish_reason: 'stop',
        },
      ],
      usage,
    });
  });
  app.post('/v1/embeddings', (req, res) => {
    const input = [].concat(req.body.input);
    res.json({
      data: input.map((t, i) => ({
        index: i,
        embedding: Array.from({ length: 8 }, (_, j) => ((t.length * (j + 1)) % 7) / 7),
      })),
      usage: { prompt_tokens: input.length * 10 },
    });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close(), calls }),
    );
  });
}
