import { PRICING } from './config.js';

export function tokenTotal(v) {
  return v.input_tokens + v.cached_input_tokens + v.output_tokens + v.reasoning_tokens;
}

export function costMicrocents(v) {
  return v.api_calls * PRICING.apiCallMicrocents
    + v.input_tokens * PRICING.inputCentsPerMillion
    + v.cached_input_tokens * PRICING.cachedInputCentsPerMillion
    + (v.output_tokens + v.reasoning_tokens) * PRICING.outputCentsPerMillion;
}

export function money(microcents) {
  return {
    currency: 'USD',
    microcents,
    centsRounded: Math.floor((microcents + 500_000) / 1_000_000),
    dollars: (microcents / 100_000_000).toFixed(6)
  };
}
