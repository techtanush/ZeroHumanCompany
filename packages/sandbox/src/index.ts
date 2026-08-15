import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export interface SandboxSpec { image?: string; cwd?: string; env?: Record<string, string> }
export interface ExecResult { stdout: string; stderr: string; exit_code: number }
export interface SandboxDriver { lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }>; pause(id: string): Promise<void>; resume(id: string): Promise<void>; fork(id: string): Promise<{ id: string; cwd: string }>; exec(id: string, cmd: string): Promise<ExecResult>; dispose(id: string): Promise<void> }

class LocalSandboxDriver implements SandboxDriver {
  private readonly leases = new Map<string, { cwd: string; paused: boolean }>();
  async lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }> { const cwd = await mkdtemp(join(tmpdir(), 'zeroth-sandbox-')); const id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`; this.leases.set(id, { cwd: spec.cwd ?? cwd, paused: false }); return { id, cwd: spec.cwd ?? cwd }; }
  async pause(id: string): Promise<void> { this.must(id).paused = true; }
  async resume(id: string): Promise<void> { this.must(id).paused = false; }
  async fork(id: string): Promise<{ id: string; cwd: string }> { const src = this.must(id); const cwd = await mkdtemp(join(tmpdir(), 'zeroth-sandbox-fork-')); await cp(src.cwd, cwd, { recursive: true, force: true }); const fork_id = `local_${Date.now()}_${Math.random().toString(36).slice(2)}`; this.leases.set(fork_id, { cwd, paused: false }); return { id: fork_id, cwd }; }
  async exec(id: string, cmd: string): Promise<ExecResult> { const lease = this.must(id); if (lease.paused) throw new Error(`Sandbox paused: ${id}`); try { const { stdout, stderr } = await execFileAsync('sh', ['-lc', cmd], { cwd: lease.cwd, env: process.env, timeout: 30_000 }); return { stdout, stderr, exit_code: 0 }; } catch (error) { const err = error as { stdout?: string; stderr?: string; code?: number }; return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exit_code: typeof err.code === 'number' ? err.code : 1 }; } }
  async dispose(id: string): Promise<void> { const lease = this.must(id); this.leases.delete(id); if (lease.cwd.startsWith(tmpdir())) await rm(lease.cwd, { recursive: true, force: true }); }
  private must(id: string): { cwd: string; paused: boolean } { const lease = this.leases.get(id); if (!lease) throw new Error(`Unknown sandbox: ${id}`); return lease; }
}

class SuperserveSandboxDriver implements SandboxDriver {
  private readonly local = new LocalSandboxDriver();
  private readonly base_url = process.env.SUPERSERVE_BASE_URL ?? 'https://api.superserve.dev';
  private get key(): string | undefined { return process.env.SUPERSERVE_API_KEY; }
  private degraded(): boolean { return !this.key; }
  async lease(spec: SandboxSpec): Promise<{ id: string; cwd: string }> { if (this.degraded()) return this.local.lease(spec); return this.post('/v1/sandboxes', spec); }
  async pause(id: string): Promise<void> { if (this.degraded()) return this.local.pause(id); await this.post(`/v1/sandboxes/${id}/pause`, {}); }
  async resume(id: string): Promise<void> { if (this.degraded()) return this.local.resume(id); await this.post(`/v1/sandboxes/${id}/resume`, {}); }
  async fork(id: string): Promise<{ id: string; cwd: string }> { if (this.degraded()) return this.local.fork(id); return this.post(`/v1/sandboxes/${id}/fork`, {}); }
  async exec(id: string, cmd: string): Promise<ExecResult> { if (this.degraded()) return this.local.exec(id, cmd); return this.post(`/v1/sandboxes/${id}/exec`, { cmd }); }
  async dispose(id: string): Promise<void> { if (this.degraded()) return this.local.dispose(id); await this.post(`/v1/sandboxes/${id}`, {}, 'DELETE'); }
  private async post<T>(path: string, body: unknown, method = 'POST'): Promise<T> { const res = await fetch(`${this.base_url}${path}`, { method, headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const text = await res.text(); if (!res.ok) throw new Error(`superserve ${res.status}: ${text.slice(0,300)}`); return (text ? JSON.parse(text) : undefined) as T; }
}
export function createSandboxDriver(kind: 'local' | 'superserve'): SandboxDriver { return kind === 'local' ? new LocalSandboxDriver() : new SuperserveSandboxDriver(); }
export { LocalSandboxDriver, SuperserveSandboxDriver };
