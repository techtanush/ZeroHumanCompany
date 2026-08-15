import Fastify from 'fastify';
import { z } from 'zod';
import { runPanel } from './index.js';

const PanelRequest = z.object({
  region: z.string().default('CA'),
  questions: z.array(z.string()).min(1),
  seed: z.number().int().optional(),
  archetypes: z.number().int().min(4).optional(),
});

export function buildServer() {
  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));
  app.post('/panel', async (request, reply) => {
    const parsed = PanelRequest.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return runPanel(parsed.data);
  });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.SIMPOP_PORT ?? '8080', 10);
  await buildServer().listen({ port, host: '0.0.0.0' });
}
