import { bearer, hasEnv, postJson } from './common.js';

const env = 'SOLARI_API_KEY';
const defaultBaseUrl = 'https://api.solari.com';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.SOLARI_BASE_URL ?? defaultBaseUrl;
  // Solari's hosted API is sponsor-provided and must be confirmed at the booth.
  return postJson({ vendor: 'solari', url: `${baseUrl}/v1/browse`, apiKey: key, headers: bearer(key), body: args });
}
