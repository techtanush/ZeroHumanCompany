import { buildServer } from './server.js';
import { Kernel } from './kernel.js';
import { loadRouting } from '@zeroth/manifests';

export * from './kernel.js';
export * from './server.js';
export * from './event-store.js';
export * from './artifacts.js';
export * from './gates.js';
export * from './meter.js';
export * from './routing.js';
export * from './vault.js';
export * from './util.js';
export * from './settings.js';
export * from './insight.js';
export * from './scheduler.js';
export * from './integrations.js';
export * from './voice.js';
export * from './wallets.js';

/** Boot a kernel with routing rules loaded from packages/manifests. */
export async function bootKernel(): Promise<Kernel> {
  console.log('[kernel] boot: loading routing');
  let routing: any[] = [];
  try {
    routing = await loadRouting();
  } catch (e) {
    console.warn('[kernel] routing.yaml unavailable, starting with empty routing table:', String(e));
  }
  console.log(`[kernel] boot: routing ready (${routing.length} rules)`);
  console.log('[kernel] boot: opening db');
  const kernel = await Kernel.create({ routing, clock: process.env.ZEROTH_CLOCK !== 'off' });
  console.log(`[kernel] boot: db ready (${kernel.db.driver})`);
  kernel.gates.startSweeper();
  console.log('[kernel] boot: gate sweeper ready');
  return kernel;
}

export async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  console.log(`[kernel] boot: starting on port ${port}`);
  const kernel = await bootKernel();
  const app = buildServer({ kernel, logger: true });
  console.log('[kernel] boot: fastify ready, binding');
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[kernel] listening on :${port} (db=${kernel.db.driver})`);
}
