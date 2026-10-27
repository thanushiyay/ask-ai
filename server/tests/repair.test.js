import { describe, expect, it } from 'vitest';
import { mergeRepairSteps } from '../src/agent/execution/repair.js';

const original = [
  { id: 's1', action: 'leads.search', args: { createdFrom: '2026-10-05' } },
  {
    id: 's2',
    action: 'conversations.search',
    args: { contactId: '$s1.items[*].contactId', hasInbound: true },
  },
  { id: 's3', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
  { id: 's4', action: 'users.list', args: { availableNow: true } },
];
const state = { status: { s1: 'completed', s2: 'failed', s3: 'skipped', s4: 'completed' } };

describe('merging repair steps', () => {
  it('reuses steps that already succeeded when the model re-emits the whole plan', () => {
    const proposed = [
      { id: 's10', action: 'leads.search', args: { createdFrom: '2026-10-05' } },
      {
        id: 's11',
        action: 'conversations.search',
        args: { contactIds: '$s10.items[*].contactId', hasInbound: true },
      },
      { id: 's12', op: 'exclude', from: '$s10.items', key: 'contactId', values: '$s11.items[*].contactId' },
      { id: 's13', action: 'users.list', args: { availableNow: true } },
    ];
    const added = mergeRepairSteps(original, state, proposed);
    expect(added.map((s) => s.id)).toEqual(['s11', 's12']);
    expect(added[0].args.contactIds).toBe('$s1.items[*].contactId');
    expect(added[1].from).toBe('$s1.items');
    expect(added.every((s) => s.repairs.join() === 's2,s3')).toBe(true);
  });

  it('keeps genuinely new steps and remaps their ordering constraints', () => {
    const proposed = [
      { id: 'r0', action: 'users.list', args: { availableNow: true } },
      { id: 'r1', action: 'tasks.create', args: { title: 'Call' }, after: ['r0'] },
    ];
    const added = mergeRepairSteps(original, state, proposed);
    expect(added).toHaveLength(1);
    expect(added[0].after).toEqual(['s4']);
  });

  it('renames a corrected step that reuses the failed step id, and follows references to it', () => {
    const proposed = [
      {
        id: 's2',
        action: 'conversations.search',
        args: { contactIds: '$s1.items[*].contactId', hasInbound: true },
      },
      { id: 's3', op: 'exclude', from: '$s1.items', key: 'contactId', values: '$s2.items[*].contactId' },
    ];
    const added = mergeRepairSteps(original, state, proposed);
    expect(added.map((s) => s.id)).toEqual(['r1', 'r2']);
    expect(added[1].values).toBe('$r1.items[*].contactId');
    expect(added[1].from).toBe('$s1.items');
  });
});
