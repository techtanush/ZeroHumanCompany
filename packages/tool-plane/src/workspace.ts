import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolCtx } from './index.js';

/**
 * workspace.* — the agency's hands inside the ONE folder the founder granted.
 * Every path is resolved against ctx.workspace_root and rejected if it escapes.
 * Same implementation for mock and real drivers: this is the founder's own disk.
 */

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', '.pgdata', 'coverage']);

/** Commands the build agents may run inside the workspace. */
const ALLOWED_BINARIES = new Set([
  'ls', 'cat', 'pwd', 'echo', 'mkdir', 'cp', 'mv', 'touch', 'head', 'tail', 'wc', 'grep', 'find', 'sed', 'diff',
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'tsc', 'vite', 'next', 'vitest', 'jest', 'eslint', 'prettier',
  'python', 'python3', 'pip', 'pip3', 'pytest', 'uv', 'go', 'cargo', 'rustc', 'make',
  'git',
]);
const DENY_PATTERNS = [/\brm\s+-rf\s+\/(?!\S)/, /\bsudo\b/, /\bcurl\b.*\|\s*(ba)?sh/, /\bshutdown\b/, /\breboot\b/, /\bmkfs\b/, /\bdd\s+if=/];

export class WorkspaceError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceError'; }
}

export function resolveInside(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new WorkspaceError(`path escapes the granted workspace: ${rel}`);
  }
  return abs;
}

function requireRoot(ctx: ToolCtx): string {
  const root = ctx.workspace_root;
  if (!root) throw new WorkspaceError('no workspace granted: the founder must choose a folder in onboarding first');
  if (!path.isAbsolute(root)) throw new WorkspaceError(`workspace_root must be absolute, got ${root}`);
  return root;
}

async function listTree(root: string, rel: string, depth: number): Promise<unknown[]> {
  const abs = resolveInside(root, rel);
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
  const out: unknown[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env.example') continue;
    if (IGNORED_DIRS.has(e.name)) { out.push({ name: e.name, kind: 'dir', skipped: true }); continue; }
    if (e.isDirectory()) {
      out.push({ name: e.name, kind: 'dir', children: depth > 1 ? await listTree(root, path.join(rel, e.name), depth - 1) : undefined });
    } else {
      const s = await stat(path.join(abs, e.name)).catch(() => null);
      out.push({ name: e.name, kind: 'file', bytes: s?.size ?? 0 });
    }
  }
  return out;
}

export function checkCommand(command: string): void {
  for (const re of DENY_PATTERNS) if (re.test(command)) throw new WorkspaceError(`command refused by workspace policy: ${command}`);
  // First token of every pipeline segment must be an allowed binary.
  const segments = command.split(/&&|\|\||\||;/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const first = seg.replace(/^[A-Z_]+=\S+\s+/g, '').split(/\s+/)[0] ?? '';
    const bin = path.basename(first);
    if (!ALLOWED_BINARIES.has(bin)) throw new WorkspaceError(`binary not allowed in workspace.exec: ${bin}`);
  }
}

async function exec(root: string, command: string, timeout_s: number): Promise<unknown> {
  checkCommand(command);
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd: root, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    let stdout = '', stderr = '';
    const cap = (s: string) => (s.length > 40_000 ? s.slice(-40_000) : s);
    child.stdout.on('data', (d) => { stdout = cap(stdout + d.toString()); });
    child.stderr.on('data', (d) => { stderr = cap(stderr + d.toString()); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout_s * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ command, exit_code: code, signal, stdout, stderr, timed_out: signal === 'SIGKILL' });
    });
    child.on('error', (err) => { clearTimeout(timer); resolve({ command, exit_code: -1, stdout, stderr: String(err) }); });
  });
}

export async function workspaceTool(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<unknown> {
  const root = requireRoot(ctx);
  const args = (rawArgs ?? {}) as Record<string, any>;
  switch (name) {
    case 'workspace.list':
      return { root, path: args.path ?? '.', entries: await listTree(root, args.path ?? '.', args.depth ?? 2) };
    case 'workspace.read_file': {
      const abs = resolveInside(root, args.path);
      const buf = await readFile(abs);
      const max = args.max_bytes ?? 60_000;
      return { path: args.path, bytes: buf.length, truncated: buf.length > max, content: buf.subarray(0, max).toString('utf8') };
    }
    case 'workspace.write_file': {
      const abs = resolveInside(root, args.path);
      if (args.mkdirs !== false) await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, String(args.content ?? ''), 'utf8');
      return { path: args.path, bytes: Buffer.byteLength(String(args.content ?? '')), written: true };
    }
    case 'workspace.exec':
      return exec(root, String(args.command), Number(args.timeout_s ?? 120));
    default:
      throw new WorkspaceError(`unknown workspace tool ${name}`);
  }
}
