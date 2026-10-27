import { describe, expect, it } from 'vitest';
import { splitInstruction } from '../src/agent/retrieval/text.js';
import { trimTranscript } from '../src/agent/baseline.js';
import { describeLlmError, LlmError, parseJson } from '../src/agent/llm.js';
import { OptimizedAgent } from '../src/agent/optimized.js';

describe('splitInstruction', () => {
  it('does not treat apostrophes inside words as quotes', () => {
    const { instruction, content } = splitInstruction("I can't find John's invoice, void it");
    expect(instruction).toContain("John's invoice");
    expect(content).toBe('');
  });

  it('does not treat clock times as a message colon', () => {
    const { instruction } = splitInstruction('Book a demo with Tom at 3:30 and email him a confirmation');
    expect(instruction).toContain('email him a confirmation');
  });

  it('still separates quoted and dictated message text', () => {
    expect(splitInstruction('Text Laura: your order is ready').content.trim()).toBe('your order is ready');
    expect(splitInstruction("Tag them 'vip customer' please").content).toBe('vip customer');
    expect(splitInstruction('Note “call back friday” on Sam').content).toBe('call back friday');
  });
});

describe('trimTranscript', () => {
  const turn = (i) => [
    { role: 'user', content: `u${i}` },
    { role: 'assistant', content: null, tool_calls: [{ id: `t${i}` }] },
    { role: 'tool', tool_call_id: `t${i}`, content: '{}' },
    { role: 'assistant', content: `a${i}` },
  ];

  it('keeps short transcripts unchanged', () => {
    const messages = turn(1);
    expect(trimTranscript(messages, 40)).toBe(messages);
  });

  it('caps long transcripts and always starts at a user message', () => {
    const messages = Array.from({ length: 30 }, (_, i) => turn(i)).flat();
    const trimmed = trimTranscript(messages, 10);
    expect(trimmed.length).toBeLessThanOrEqual(10);
    expect(trimmed[0].role).toBe('user');
    expect(trimmed.at(-1)).toBe(messages.at(-1));
  });
});

describe('model error handling', () => {
  it('explains common API failures in plain words', () => {
    const err = (status) => new LlmError('x', { status });
    expect(describeLlmError(err(401))).toMatch(/API key was rejected/);
    expect(describeLlmError(err(404))).toMatch(/model was not found/);
    expect(describeLlmError(err(429))).toMatch(/rate limit/);
    expect(describeLlmError(err(503))).toMatch(/try again/);
    expect(describeLlmError(new LlmError('stop', null, { aborted: true }))).toMatch(/stopped/);
  });

  it('parses JSON defensively', () => {
    expect(parseJson('')).toBeNull();
    expect(parseJson(undefined)).toBeNull();
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('{"a":')).toBeNull();
  });
});

describe('request labels', () => {
  const agent = Object.create(OptimizedAgent.prototype);

  it('answers to a clarification complete the original request', () => {
    expect(agent.requestFor({ kind: 'clarify', request: 'Text Sarah' }, 'Sarah Johnson')).toBe('Text Sarah');
  });

  it('a new message during a pending confirmation is recorded as a change to it', () => {
    expect(agent.requestFor({ kind: 'confirm', request: 'Send reminders' }, 'only the first two')).toMatch(
      /Send reminders[\s\S]*only the first two/,
    );
  });

  it('otherwise the message is the request', () => {
    expect(agent.requestFor(null, 'Create a task')).toBe('Create a task');
  });
});

describe('repository hygiene', () => {
  it('ships .env.example with a placeholder, never a real API key', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const key = example.match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim();
    expect(key).toBe('sk-...');
    expect(example).not.toMatch(/sk-(proj-)?[A-Za-z0-9_-]{20,}/);
  });
});
