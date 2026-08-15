import { bearer, hasEnv, postJson } from './common.js';

const env = 'SOLARI_API_KEY';
const defaultBaseUrl = 'https://api.solari.com';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  return runTool('solari.browse', args);
}

export async function runTool(toolName: string, args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const baseUrl = process.env.SOLARI_BASE_URL ?? defaultBaseUrl;
  // Solari's hosted API is sponsor-provided; the path is isolated here for easy booth-time correction.
  const path = toolName === 'solari.act'
    ? '/v1/act'
    : toolName === 'solari.extract'
      ? '/v1/extract'
      : toolName === 'solari.screenshot'
        ? '/v1/screenshot'
        : '/v1/browse';
  return postJson({ vendor: 'solari', url: `${baseUrl}${path}`, apiKey: key, headers: bearer(key), body: args });
}
