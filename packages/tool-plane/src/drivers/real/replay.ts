import { bearer, hasEnv, postJson } from './common.js';

const env = 'REPLAY_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  return postJson({ vendor: 'replay', url: 'https://api.replay.io/v1/test-runs', apiKey: key, headers: bearer(key), body: args });
}
