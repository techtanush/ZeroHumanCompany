import { bearer, hasEnv, postJson } from './common.js';

const env = 'COMPOSIO_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const entityId = process.env.COMPOSIO_ENTITY_ID;
  const body = entityId ? { entity_id: entityId, arguments: args } : { arguments: args };
  return postJson({ vendor: 'composio', url: 'https://backend.composio.dev/api/v1/actions/GMAIL_SEND_EMAIL/execute', apiKey: key, headers: bearer(key), body });
}
