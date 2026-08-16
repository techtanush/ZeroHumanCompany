import { createServer } from 'node:http';
import { bootKernel } from '@zeroth/kernel';
import { Orchestrator } from './worker.js';

const kernel = await bootKernel();
const o = new Orchestrator({ kernel });
await o.init();

// Render only supports web services on the free plan, and it kills anything
// that never binds a port. A tiny health endpoint keeps the worker alive there
// and doubles as a liveness probe ("is the queue actually being drained?").
const port = Number(process.env.PORT ?? 0);
if (port > 0) {
  let started = false;
  createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: started ? 'draining' : 'starting', role: 'orchestrator', ts: new Date().toISOString() }));
      return;
    }
    res.writeHead(404).end();
  }).listen(port, '0.0.0.0', () => console.log(`[orchestrator] health on :${port}`));
  started = true;
}

console.log('[orchestrator] started');
await o.start();
