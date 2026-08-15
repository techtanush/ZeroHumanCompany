import { bearer, hasEnv, postJson } from './common.js';

const env = 'TERAC_API_KEY';
const defaultBaseUrl = 'https://api.terac.ai';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.TERAC_BASE_URL ?? defaultBaseUrl;
  // Terac sponsor API shape must be confirmed at the booth, so the base URL is configurable.
  return postJson({ vendor: 'terac', url: `${baseUrl}/v1/requisitions`, apiKey: key, headers: bearer(key), body: args });
}
