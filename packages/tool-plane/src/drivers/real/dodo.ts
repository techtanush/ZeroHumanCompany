import { bearer, hasEnv, postJson } from './common.js';

const env = 'DODO_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  return postJson({ vendor: 'dodo', url: 'https://api.dodopayments.com/v1/checkouts', apiKey: key, headers: bearer(key), body: args });
}
