import { describe, expect, it } from 'vitest';
import { createSandboxDriver } from './index.js';

describe('sandbox drivers', () => {
  it('local sandbox exec really runs a command', async () => {
    const driver = createSandboxDriver('local');
    const lease = await driver.lease({});
    try {
      const result = await driver.exec(lease.id, 'printf hello > out.txt && cat out.txt');
      expect(result).toEqual({ stdout: 'hello', stderr: '', exit_code: 0 });
    } finally {
      await driver.dispose(lease.id);
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
