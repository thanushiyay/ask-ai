// USD per 1M tokens (OpenAI list prices at time of writing). Override with PRICING_JSON.
const DEFAULT = {
  'gpt-4.1': { input: 2.0, cachedInput: 0.5, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 }, // retired 2026-10-23
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10.0 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, cachedInput: 0.13, output: 0 },
};

let table = DEFAULT;
try {
  if (process.env.PRICING_JSON) table = { ...DEFAULT, ...JSON.parse(process.env.PRICING_JSON) };
} catch {
  /* keep defaults */
}

export function priceFor(model) {
  if (table[model]) return table[model];
  const base = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  return table[base] ?? { input: 0, cachedInput: 0, output: 0, unknown: true };
}

/** Cost of one call. Cached prompt tokens are billed at the cached rate. */
export function costOf(model, { inputTokens = 0, cachedTokens = 0, outputTokens = 0 }) {
  const p = priceFor(model);
  return (
    ((inputTokens - cachedTokens) * p.input + cachedTokens * p.cachedInput + outputTokens * p.output) / 1e6
  );
}

export const pricingTable = () => table;
