import { appNow } from '../core/clock.js';
import { createWorld } from '../core/world.js';
import { resetSessions } from '../agent/session.js';

const MAX_TRACES = 200;

export function createAppState() {
  const state = {
    world: createWorld({ now: appNow() }),
    traces: [],
    recordTrace(trace) {
      state.traces.unshift(trace);
      state.traces.length = Math.min(state.traces.length, MAX_TRACES);
    },
    reset() {
      state.world = createWorld({ now: appNow() });
      state.traces.length = 0;
      resetSessions();
    },
  };
  return state;
}
