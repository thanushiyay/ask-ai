import direct from './direct.js';
import { multiStep, conditional } from './workflows.js';
import { indirect, followUp, ambiguous, unsupported, failure } from './conversational.js';

export const scenarios = [
  ...direct,
  ...multiStep,
  ...conditional,
  ...indirect,
  ...followUp,
  ...ambiguous,
  ...unsupported,
  ...failure,
];

export const CATEGORIES = [
  'direct',
  'indirect',
  'multi_step',
  'conditional',
  'follow_up',
  'ambiguous',
  'unsupported',
  'failure',
];
/** Latency groups reported separately, as the assignment asks. */
export const latencyGroup = (s) =>
  s.category === 'direct'
    ? 'direct'
    : ['multi_step', 'conditional', 'follow_up'].includes(s.category)
      ? 'complex'
      : 'other';

const ids = new Set();
for (const s of scenarios) {
  if (ids.has(s.id)) throw new Error(`duplicate scenario ${s.id}`);
  ids.add(s.id);
  if (!CATEGORIES.includes(s.category)) throw new Error(`${s.id}: bad category`);
}
