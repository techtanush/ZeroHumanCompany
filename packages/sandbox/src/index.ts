import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface SandboxSpec {
  image?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout_ms?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface SandboxDriver {
  lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  fork(id: string): Promise<{ id: string; cwd: string }>;
  exec(id: string, cmd: string): Promise<ExecResult>;
  dispose(id: string): Promise<void>;
}

type Lease = {
  cwd: string;
  paused: boolean;
  ownedDir: boolean;
  env: Record<string, string>;
  timeoutMs: number;
};

export class LocalSandboxDriver implements SandboxDriver {
  private readonly leases = new Map<string, Lease>();

  async lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }> {
    const ownedDir = !spec.cwd;
    const cwd = spec.cwd ? resolve(spec.cwd) : await mkdtemp(join(tmpdir(), 'zeroth-sandbox-'));
    const id = `local_${randomUUID()}`;

    this.leases.set(id, {
      cwd,
      paused: false,
      ownedDir,
      env: spec.env ?? {},
      timeoutMs: spec.timeout_ms ?? 30_000,
    });

    return { id, cwd };
  }

  async pause(id: string): Promise<void> {
    this.must(id).paused = true;
  }

  async resume(id: string): Promise<void> {
    this.must(id).paused = false;
  }

  async fork(id: string): Promise<{ id: string; cwd: string }> {
    const source = this.must(id);
    const cwd = await mkdtemp(join(tmpdir(), 'zeroth-sandbox-fork-'));

    // A fork is an isolated snapshot so experiments cannot mutate the parent sandbox.
    await cp(source.cwd, cwd, { recursive: true, force: true, errorOnExist: false });

    const forkId = `local_${randomUUID()}`;
    this.leases.set(forkId, { ...source, cwd, paused: false, ownedDir: true });
    return { id: forkId, cwd };
  }

  async exec(id: string, cmd: string): Promise<ExecResult> {
    const lease = this.must(id);
    if (lease.paused) throw new Error(`Sandbox paused: ${id}`);

    return new Promise((resolveResult) => {
      execFile(
        'sh',
        ['-lc', cmd],
        {
          cwd: lease.cwd,
          env: { ...process.env, ...lease.env },
          timeout: lease.timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code = typeof (error as { code?: unknown } | null)?.code === 'number' ? ((error as { code: number }).code) : error ? 1 : 0;
          resolveResult({ stdout, stderr, exit_code: code });
        },
      );
    });
  }

  async dispose(id: string): Promise<void> {
    const lease = this.must(id);
    this.leases.delete(id);
    if (lease.ownedDir) await rm(lease.cwd, { recursive: true, force: true });
  }

  private must(id: string): Lease {
    const lease = this.leases.get(id);
    if (!lease) throw new Error(`Unknown sandbox: ${id}`);
    return lease;
  }
}

export class SuperserveSandboxDriver implements SandboxDriver {
  private readonly local = new LocalSandboxDriver();
  private readonly baseUrl = process.env.SUPERSERVE_BASE_URL ?? 'https://api.superserve.dev';

  private get key(): string | undefined {
    return process.env.SUPERSERVE_API_KEY;
  }

  async lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }> {
    if (!this.key) return this.local.lease(spec);
    return this.request('/v1/sandboxes', { spec });
  }

  async pause(id: string): Promise<void> {
    if (!this.key) return this.local.pause(id);
    await this.request(`/v1/sandboxes/${encodeURIComponent(id)}/pause`, {});
  }

  async resume(id: string): Promise<void> {
    if (!this.key) return this.local.resume(id);
    await this.request(`/v1/sandboxes/${encodeURIComponent(id)}/resume`, {});
  }

  async fork(id: string): Promise<{ id: string; cwd: string }> {
    if (!this.key) return this.local.fork(id);
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}/fork`, {});
  }

  async exec(id: string, cmd: string): Promise<ExecResult> {
    if (!this.key) return this.local.exec(id, cmd);
    return this.request(`/v1/sandboxes/${encodeURIComponent(id)}/exec`, { cmd });
  }

  async dispose(id: string): Promise<void> {
    if (!this.key) return this.local.dispose(id);
    await this.request(`/v1/sandboxes/${encodeURIComponent(id)}`, {}, 'DELETE');
  }

  private async request<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
    const key = this.key!;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`superserve ${response.status}: ${text.replaceAll(key, '[redacted]').slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export function createSandboxDriver(kind: 'local' | 'superserve'): SandboxDriver {
  return kind === 'local' ? new LocalSandboxDriver() : new SuperserveSandboxDriver();
}
