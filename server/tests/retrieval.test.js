import { beforeAll, describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { ToolIndex, splitInstruction, stem, tokenize } from '../src/agent/retrieval/index.js';

describe('text normalisation', () => {
  it('stems word variants to the same root', () => {
    expect(stem('invoices')).toBe(stem('invoice'));
    expect(stem('replies')).toBe(stem('reply'));
    expect(stem('created')).toBe(stem('create'));
  });

  it('drops stop words and splits identifiers', () => {
    expect(tokenize('Please send the invoices.send_reminder')).toEqual([
      'send',
      'invoic',
      'send',
      'reminder',
    ]);
  });

  it('separates message content from the instruction', () => {
    const { instruction, content } = splitInstruction(
      'Add a note to Sarah: she wants a discount on the plan',
    );
    expect(instruction).not.toMatch(/discount/);
    expect(content).toMatch(/discount/);
  });
});

describe('tool retrieval', () => {
  let index;
  beforeAll(async () => {
    index = new ToolIndex(await loadRegistry());
  });

  const search = (q) => index.search(q, { mode: 'bm25' });

  it('finds the action for a direct request', async () => {
    expect((await search('send reminders for overdue invoices')).ids).toContain('invoices.send_reminder');
  });

  it('maps everyday words through synonyms', async () => {
    expect((await search('text Laura that her order is ready')).ids).toContain('sms.send');
  });

  it('tolerates typos', async () => {
    expect((await search('list overdue invoces')).ids).toContain('invoices.list_overdue');
  });

  it('always includes entity lookups and stays well under the full catalog', async () => {
    const { ids } = await search('create a follow-up task');
    expect(ids).toEqual(expect.arrayContaining(['contacts.search', 'users.list', 'tasks.create']));
    expect(ids.length).toBeLessThan(80);
  });
});
