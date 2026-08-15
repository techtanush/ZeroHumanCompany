import { bearer, hasEnv, postJson } from './common.js';

const env = 'BAND_API_KEY';
const defaultBaseUrl = 'https://api.band.dev';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.BAND_BASE_URL ?? defaultBaseUrl;
  const workspaceId = process.env.BAND_WORKSPACE_ID;
  const body = workspaceId ? { workspace_id: workspaceId, ...((args as Record<string, unknown>) ?? {}) } : args;
  // Band's mesh REST shape is sponsor-facing and must be confirmed at the booth.
  return postJson({ vendor: 'band', url: `${baseUrl}/v1/rooms/messages`, apiKey: key, headers: bearer(key), body });
}
