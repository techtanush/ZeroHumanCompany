import { bootKernel } from '@zeroth/kernel';
import { Orchestrator } from './worker.js';

const kernel = await bootKernel();
const o = new Orchestrator({ kernel });
await o.init();
console.log('[orchestrator] started');
await o.start();
