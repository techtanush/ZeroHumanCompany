import { bearer, hasEnv, postJson } from './common.js';

const env = 'PIONEER_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const body = process.env.PIONEER_MODEL_LEAD_SCORE ? { model: process.env.PIONEER_MODEL_LEAD_SCORE, input: args } : args;
  return postJson({ vendor: 'pioneer', url: 'https://api.pioneer.ai/v1/classify', apiKey: key, headers: bearer(key), body });
}
