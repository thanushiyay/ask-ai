import { ToolIndex } from './retrieval/index.js';
import { OptimizedAgent } from './optimized.js';
import { BaselineAgent } from './baseline.js';

export function createAgents(registry) {
  const index = new ToolIndex(registry);
  return {
    index,
    optimized: new OptimizedAgent({ registry, index }),
    baseline: new BaselineAgent({ registry }),
  };
}
