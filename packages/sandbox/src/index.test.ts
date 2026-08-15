import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSandboxDriver } from './index.js';

describe('sandbox drivers', () => {
  it('local sandbox exec really runs a command with captured stdout and stderr', async () => {
    const driver = createSandboxDriver('local');
    const lease = await driver.lease({});
    try {
      const result = await driver.exec(lease.id, 'printf hello > out.txt && cat out.txt && printf warn >&2');
      expect(result).toEqual({ stdout: 'hello', stderr: 'warn', exit_code: 0 });
    } finally {
      await driver.dispose(lease.id);
    }
  });

  it('local sandbox pause, resume, fork, and dispose work on disk', async () => {
    const driver = createSandboxDriver('local');
    const lease = await driver.lease({});
    try {
      await writeFile(join(lease.cwd, 'parent.txt'), 'parent');
      await driver.pause(lease.id);
      await expect(driver.exec(lease.id, 'echo blocked')).rejects.toThrow('paused');
      await driver.resume(lease.id);

      const fork = await driver.fork(lease.id);
      try {
        await expect(access(join(fork.cwd, 'parent.txt'))).resolves.toBeUndefined();
        await driver.exec(fork.id, 'printf child > child.txt');
        await expect(access(join(lease.cwd, 'child.txt'))).rejects.toThrow();
      } finally {
        await driver.dispose(fork.id);
        await expect(access(fork.cwd)).rejects.toThrow();
      }
    } finally {
      const cwd = lease.cwd;
      await driver.dispose(lease.id);
      await expect(access(cwd)).rejects.toThrow();
    }
  });

  it('superserve falls back to local when api key is missing', async () => {
    const old = process.env.SUPERSERVE_API_KEY;
    delete process.env.SUPERSERVE_API_KEY;
    const driver = createSandboxDriver('superserve');
    const lease = await driver.lease({});
    try {
      expect(lease.id).toMatch(/^local_/);
      const result = await driver.exec(lease.id, 'echo fallback');
      expect(result.stdout).toBe('fallback\n');
    } finally {
      await driver.dispose(lease.id);
      process.env.SUPERSERVE_API_KEY = old;
    }
  });
});
