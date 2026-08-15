import { hasEnv, postJson } from './common.js';

const env = 'APIFY_TOKEN';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const input = args as { actor_id: string; input?: unknown };
  return postJson({ vendor: 'apify', url: `https://api.apify.com/v2/acts/${encodeURIComponent(input.actor_id)}/runs?token=${encodeURIComponent(key)}`, apiKey: key, body: input.input ?? {} });
}
