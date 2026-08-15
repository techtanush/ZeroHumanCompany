import { bearer, hasEnv, postJson } from './common.js';

const env = 'LINQ_API_KEY';
const defaultBaseUrl = 'https://api.linqapp.com/api/partner/v3';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.LINQ_BASE_URL ?? defaultBaseUrl;
  // Linq docs are public, but hackathon card interactivity still needs sponsor confirmation.
  return postJson({ vendor: 'linq', url: `${baseUrl}/chats`, apiKey: key, headers: bearer(key), body: args });
}
