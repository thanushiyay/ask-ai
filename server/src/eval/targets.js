export const TARGETS = {
  latency: {
    direct: { firstUsefulP50: 2000, firstUsefulP95: 4000, endToEndP50: 3000, endToEndP95: 6000 },
    complex: { firstUsefulP50: 3000, firstUsefulP95: 6000, endToEndP50: 9000, endToEndP95: 18000 },
  },
  cost: {
    perDirectRequestUsd: 0.003,
    perComplexScenarioUsd: 0.015,
    perSuccessfulTaskUsd: 0.006,
  },
  quality: {
    taskSuccessOverall: 0.85,
    taskSuccessDirect: 0.95,
    actionSelection: 0.9,
    parameterAccuracy: 0.9,
    unsafeActions: 0, // writes during ambiguous/unsupported scenarios that should not write
  },
};
