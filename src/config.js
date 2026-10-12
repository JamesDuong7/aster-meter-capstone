import { readFileSync } from 'node:fs';

export const PLANS = Object.freeze({
  free: { apiCalls: 1000, tokens: 100_000 },
  pro: { apiCalls: 100_000, tokens: 10_000_000 }
});

// Prices are integer US cents per million tokens. API calls use microcents.
export const PRICING = Object.freeze({
  apiCallMicrocents: 500_000,
  inputCentsPerMillion: 200,
  cachedInputCentsPerMillion: 50,
  outputCentsPerMillion: 800
});

export function loadEnv(path = '.env') {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
