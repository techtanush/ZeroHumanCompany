import { hasEnv, postJson } from './common.js';

const env = 'GITHUB_TOKEN';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const input = args as { owner?: string; repo?: string; branch?: string; message?: string; content_base64?: string; path?: string };
  const owner = input.owner ?? process.env.GITHUB_ORG;
  if (!owner || !input.repo || !input.path || !input.content_base64) throw new Error('github.push requires owner/repo/path/content_base64');

  // The public interface says push, but the safe REST primitive here is create/update file contents.
  return postJson({
    vendor: 'github',
    url: `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(input.repo)}/contents/${encodeURIComponent(input.path)}`,
    apiKey: key,
    method: 'PUT',
    headers: { authorization: `token ${key}`, accept: 'application/vnd.github+json', 'user-agent': 'zeroth-tool-plane' },
    body: { message: input.message ?? 'Automated Zeroth update', content: input.content_base64, branch: input.branch ?? 'main' },
  });
}
