import { bearer, hasEnv, postJson } from './common.js';

const env = 'RENDER_API_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const input = args as { service_id?: string; clearCache?: boolean };
  const serviceId = input.service_id ?? process.env.RENDER_SERVICE_ID;
  if (!serviceId) throw new Error('Missing render service_id');

  return postJson({ vendor: 'render', url: `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`, apiKey: key, headers: bearer(key), body: { clearCache: input.clearCache ?? 'do_not_clear' } });
}
