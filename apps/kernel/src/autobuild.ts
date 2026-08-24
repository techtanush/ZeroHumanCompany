import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Kernel } from './kernel.js';
import { composioConnectedAccountId, composioExecuteTool } from './integrations.js';

/**
 * D07's zero-touch build: the founder's raw idea, OpenAI's own model, and
 * whichever of our vendor keys the generated product actually needs — turned
 * into a small, real, running product with zero human steps in between.
 *
 * Deliberately scoped to something OpenAI can generate *correctly* in one
 * shot: at most a few files, no build step, no npm install (nothing here can
 * assume a package registry is reachable at serve time). A static frontend
 * plus, only when the idea needs one, a single Node-builtins-only server.
 */

interface GeneratedProduct {
  files: Record<string, string>;
  needs_env: string[];
  summary: string;
  start_file: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function fallbackProduct(idea: string): GeneratedProduct {
  return {
    summary: `Placeholder landing page for: ${idea}`.slice(0, 200),
    needs_env: [],
    start_file: 'index.html',
    files: {
      'index.html': `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(idea).slice(0, 60)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0e14;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:560px;padding:32px;border:1px solid #2a2f3a;border-radius:12px}</style></head>
<body><div class="card"><h1>Coming soon</h1><p>${escapeHtml(idea)}</p><p style="opacity:.6">The code generator was unavailable, so this is a placeholder.</p></div></body></html>`,
    },
  };
}

/** OpenAI writes the product. Falls back to a placeholder page rather than failing the pipeline outright. */
async function generateProduct(idea: string): Promise<GeneratedProduct> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallbackProduct(idea);
  const system = [
    'You are a senior full-stack engineer. Given a one-line product idea, generate a SMALL, REAL, WORKING web app that demonstrates the idea end to end.',
    'Hard constraints: at most 4 files, no build step, nothing may require `npm install` (only Node.js builtins are available at run time).',
    'If the idea is presentable as a pure frontend, output exactly one file, "index.html", with inline <style> and <script>.',
    'If it genuinely needs a backend (auth, payments, persistence), output exactly two files: "index.html" and "server.js" — server.js MUST be a plain Node http server using ONLY Node built-ins (http, url, querystring, node:fs) — no express, no other packages — and MUST listen on `process.env.PORT`.',
    'If a real third-party API would be needed to make a feature real (payments -> Stripe, chat -> an LLM, voice -> ElevenLabs), name the exact env var in "needs_env" (e.g. "STRIPE_SECRET_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY") and read it from process.env in server.js — never hardcode a key, and never invent a var name outside that short, well-known set.',
    'Respond ONLY with JSON: {"summary": "one sentence describing what this build actually does", "files": {"path": "full file content as a string"}, "needs_env": ["ENV_VAR", ...], "start_file": "index.html or server.js"}',
  ].join('\n');
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_BUILD ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: `Idea: ${idea}` }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as any;
    const text = j.choices?.[0]?.message?.content;
    if (!text) throw new Error('empty completion');
    const parsed = JSON.parse(text);
    if (!parsed.files || typeof parsed.files !== 'object' || !Object.keys(parsed.files).length) throw new Error('no files in response');
    const files: Record<string, string> = {};
    for (const [p, content] of Object.entries(parsed.files)) files[String(p)] = String(content);
    const start_file = parsed.start_file && files[parsed.start_file] ? parsed.start_file : Object.keys(files)[0];
    return {
      files,
      needs_env: Array.isArray(parsed.needs_env) ? parsed.needs_env.map(String) : [],
      summary: String(parsed.summary ?? idea).slice(0, 300),
      start_file,
    };
  } catch (e) {
    console.error('[autobuild] generateProduct failed, using fallback scaffold', e instanceof Error ? e.message : String(e));
    return fallbackProduct(idea);
  }
}

/** Map of env vars a generated product might declare it needs -> our own real (test-mode where applicable) values. Only vars we actually have configured are ever injected. */
function resolveBackendEnv(needs: string[]): { used: string[]; env: Record<string, string> } {
  const KEY_MAP: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    TERAC_API_KEY: process.env.TERAC_API_KEY,
    LINQ_API_KEY: process.env.LINQ_API_KEY,
  };
  const env: Record<string, string> = {};
  const used: string[] = [];
  for (const name of needs) {
    const v = KEY_MAP[name];
    if (v) { env[name] = v; used.push(name); }
  }
  return { used, env };
}

function slugifyRepoName(idea: string, venture_id: string): string {
  const base = idea.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'venture';
  return `${base}-${venture_id.slice(0, 8)}`;
}

/**
 * Pushes the generated files to a brand-new GitHub repo. Prefers the
 * founder's own GitHub, connected via Composio during onboarding (their code
 * lands in *their* GitHub, as asked) — executed through Composio's GitHub
 * toolkit so we never see or handle their OAuth token directly. Falls back to
 * the company's own GITHUB_TOKEN/GITHUB_ORG if the founder hasn't connected
 * one yet, and is honest in the result about which happened.
 */
async function createGithubRepoAndPush(identity: string, repoName: string, files: Record<string, string>): Promise<
  { ok: true; repo_url: string; owner: 'founder' | 'company' } | { ok: false; detail: string }
> {
  const connectedAccountId = await composioConnectedAccountId(identity, 'github');
  if (connectedAccountId) {
    const created = await composioExecuteTool(connectedAccountId, 'GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER', {
      name: repoName,
      private: false,
      auto_init: false,
      description: 'Auto-built by Zeroth D07 from the founder\'s idea.',
    });
    if (!created.ok) return { ok: false, detail: `GitHub repo creation failed: ${created.detail} — ${created.degraded}` };
    const repoData = created.data as any;
    const owner = repoData?.owner?.login ?? repoData?.full_name?.split('/')?.[0];
    const repo_url = repoData?.html_url ?? (owner ? `https://github.com/${owner}/${repoName}` : null);
    if (!owner || !repo_url) return { ok: false, detail: 'GitHub repo created but response had no owner/url' };
    for (const [filePath, content] of Object.entries(files)) {
      const put = await composioExecuteTool(connectedAccountId, 'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', {
        owner, repo: repoName, path: filePath,
        message: `Add ${filePath}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
      });
      if (!put.ok) return { ok: false, detail: `Pushed repo but failed on ${filePath}: ${put.detail} — ${put.degraded}` };
    }
    return { ok: true, repo_url, owner: 'founder' };
  }

  // No founder GitHub connected — fall back to the company's own token, if configured.
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token) return { ok: false, detail: 'connect GitHub during onboarding (or set GITHUB_TOKEN) to get a repo for this build' };
  const createUrl = org ? `https://api.github.com/orgs/${org}/repos` : 'https://api.github.com/user/repos';
  const res = await fetch(createUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({ name: repoName, private: false, description: 'Auto-built by Zeroth D07 from the founder\'s idea.' }),
  });
  if (!res.ok) return { ok: false, detail: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const repo = (await res.json()) as any;
  for (const [filePath, content] of Object.entries(files)) {
    const put = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ message: `Add ${filePath}`, content: Buffer.from(content, 'utf8').toString('base64') }),
    });
    if (!put.ok) return { ok: false, detail: `Pushed repo but failed on ${filePath}: GitHub ${put.status}` };
  }
  return { ok: true, repo_url: repo.html_url, owner: 'company' };
}

/** One local preview server per venture; re-running auto-build for the same venture replaces it instead of leaking ports. */
const runningServers = new Map<string, Server | ChildProcess>();

function stopExisting(venture_id: string): void {
  const existing = runningServers.get(venture_id);
  if (!existing) return;
  if ('kill' in existing) existing.kill();
  else existing.close();
  runningServers.delete(venture_id);
}

/**
 * Serves the generated product on 127.0.0.1 on an ephemeral port. This is a
 * genuine `localhost` URL only reachable from whatever machine runs this
 * kernel process — exactly right when the founder runs Zeroth on their own
 * laptop (`pnpm dev:kernel`); on a cloud deploy the link is real but only
 * reachable from that instance, which the notification says plainly.
 */
async function serveLocally(venture_id: string, files: Record<string, string>, startFile: string, env: Record<string, string>): Promise<{ port: number; local_url: string }> {
  stopExisting(venture_id);
  const dir = path.join(os.tmpdir(), 'zeroth-autobuild', venture_id);
  await mkdir(dir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  if (startFile.endsWith('.js')) {
    const port = await findFreePort();
    const child = spawn(process.execPath, [startFile], {
      cwd: dir,
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: 'pipe',
    });
    child.on('error', (e) => console.error('[autobuild] preview server crashed', e.message));
    runningServers.set(venture_id, child);
    return { port, local_url: `http://localhost:${port}` };
  }

  // Pure static: serve every generated file with a tiny built-in server, no framework needed.
  const port = await findFreePort();
  const server = createServer(async (req, res) => {
    const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = reqPath === '/' ? startFile : reqPath.replace(/^\//, '');
    try {
      const full = path.join(dir, rel);
      if (!full.startsWith(dir)) throw new Error('path escape');
      const body = await readFile(full);
      const ext = path.extname(full);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] ?? 'text/plain';
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  runningServers.set(venture_id, server);
  return { port, local_url: `http://localhost:${port}` };
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
    srv.on('error', reject);
  });
}

/**
 * The whole pipeline, fire-and-forget from venture creation: idea → code →
 * repo → running preview. Every stage writes `settings.autobuild`, which is
 * what drives the persistent HQ notification — a partial failure (e.g. no
 * GitHub connected) still leaves whatever succeeded visible rather than
 * losing the run silently.
 */
export async function runAutoBuild(kernel: Kernel, venture_id: string, ideaRaw: string): Promise<void> {
  const set = (patch: Record<string, unknown>) =>
    kernel.settings.update(venture_id, { autobuild: { ...patch, updated_at: new Date().toISOString() } }, 'system').catch(() => undefined);

  await set({ status: 'generating' });
  const product = await generateProduct(ideaRaw);
  await set({ status: 'pushing', idea_summary: product.summary });

  const identitySettings = await kernel.settings.get(venture_id);
  const identity = identitySettings.composio_identity || `zeroth-${venture_id}`;
  const { used, env } = resolveBackendEnv(product.needs_env);
  const repoName = slugifyRepoName(ideaRaw, venture_id);
  const pushed = await createGithubRepoAndPush(identity, repoName, product.files).catch((e) => ({ ok: false as const, detail: e instanceof Error ? e.message : String(e) }));

  await set({
    status: 'serving',
    idea_summary: product.summary,
    used_env: used,
    ...(pushed.ok ? { repo_url: pushed.repo_url, repo_owner: pushed.owner } : { error: pushed.detail }),
  });

  try {
    const { local_url } = await serveLocally(venture_id, product.files, product.start_file, env);
    await set({
      status: 'ready',
      idea_summary: product.summary,
      used_env: used,
      local_url,
      ...(pushed.ok ? { repo_url: pushed.repo_url, repo_owner: pushed.owner } : { error: pushed.detail }),
    });
  } catch (e) {
    await set({
      status: 'failed',
      idea_summary: product.summary,
      used_env: used,
      ...(pushed.ok ? { repo_url: pushed.repo_url, repo_owner: pushed.owner } : {}),
      error: `local preview failed to start: ${e instanceof Error ? e.message : String(e)}${pushed.ok ? '' : ` (repo also failed: ${pushed.detail})`}`,
    });
  }
}
