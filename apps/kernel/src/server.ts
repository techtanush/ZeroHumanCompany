import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Kernel } from './kernel.js';
import { KernelError, type StoredEvent } from './event-store.js';
import { nowIso, uuid } from './util.js';

export interface ServerOptions {
  kernel: Kernel;
  token?: string;
  logger?: boolean;
}

/**
 * Kernel HTTP surface: REST + SSE + webhook receivers.
 * Auth is a single shared bearer token (documented in 06-repo-layout §7) — the
 * whole system runs behind the founder's own machine for the hackathon.
 */
export function buildServer(opts: ServerOptions): FastifyInstance {
  const { kernel } = opts;
  const token = opts.token ?? process.env.KERNEL_SHARED_TOKEN ?? 'dev-only-token';
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err: unknown, req, reply) => {
    const ke = err instanceof KernelError ? err : null;
    const status = ke?.status ?? (err as any)?.statusCode ?? 500;
    reply.code(status).send({
      error: {
        code: ke?.code ?? 'internal_error',
        message: err instanceof Error ? err.message : String(err),
        trace_id: String(req.headers['x-trace-id'] ?? 'none'),
        retryable: ke?.retryable ?? status >= 500,
        details: ke?.details,
      },
    });
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/health') || req.url.startsWith('/v1/webhooks/')) return;
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${token}`) {
      reply.code(401).send({
        error: { code: 'unauthorized', message: 'missing or bad bearer token', trace_id: 'none', retryable: false },
      });
    }
  });

  app.get('/health', async () => ({
    status: 'healthy',
    driver: kernel.db.driver,
    ts: nowIso(),
  }));

  /* ── Ventures ─────────────────────────────────────────────────────────── */

  app.post('/v1/ventures', async (req) => {
    const b = req.body as any;
    const created = await kernel.createVenture({
      mode: b.mode,
      name: b.name ?? b.idea_seed?.normalized?.problem?.slice(0, 40),
      founder: b.founder_profile ?? { display_name: 'Founder' },
      autonomy_level: b.autonomy_level,
      spend_cap_usd: b.spend_cap_usd,
      terac_cap_usd: b.terac_cap_usd,
    });

    let first_work_order_id: string | null = null;
    if (b.idea_seed) {
      const artifact = await kernel.artifacts.create({
        venture_id: created.venture_id,
        type: 'IdeaSeed',
        body: { ...b.idea_seed, founder_profile: b.founder_profile },
        produced_by: 'founder',
        department_id: 'D01',
        quality: 'draft',
      });
      await kernel.events.append({
        venture_id: created.venture_id,
        type: 'artifact.created',
        actor_kind: 'founder',
        actor_id: created.founder_id,
        department_id: 'D01',
        payload: {
          artifact: { type: 'IdeaSeed', id: artifact.id, version: artifact.version, hash: artifact.body_hash },
        },
        trace_id: created.trace_id,
      });
      first_work_order_id = await kernel.issueWorkOrder({
        venture_id: created.venture_id,
        to: 'D01',
        intent: 'normalize_idea',
        budget_usd: 1.0,
        input_artifacts: [{ type: 'IdeaSeed', id: artifact.id, version: artifact.version, hash: artifact.body_hash }],
        trace_id: created.trace_id,
      });
    } else {
      first_work_order_id = await kernel.issueWorkOrder({
        venture_id: created.venture_id,
        to: 'D01',
        intent: 'originate_opportunities',
        budget_usd: 2.0,
        trace_id: created.trace_id,
      });
    }

    return {
      venture_id: created.venture_id,
      trace_id: created.trace_id,
      first_work_order_id,
      sse_url: `/v1/ventures/${created.venture_id}/stream`,
    };
  });

  app.get('/v1/ventures/:id', async (req) => {
    const { id } = req.params as { id: string };
    const v = await kernel.venture(id);
    if (!v) throw new KernelError('venture_not_found', `no venture ${id}`, false, 404);
    return v;
  });

  app.get('/v1/ventures/:id/timeline', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { after_seq?: string; limit?: string; types?: string };
    const events = await kernel.events.readStream(id, {
      after_seq: q.after_seq ? Number(q.after_seq) : 0,
      limit: q.limit ? Number(q.limit) : 200,
      types: q.types ? q.types.split(',') : undefined,
    });
    return { events, latest_seq: await kernel.events.latestSeq(id) };
  });

  app.get('/v1/ventures/:id/artifacts', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { type?: string; quality?: string };
    return { artifacts: await kernel.artifacts.list(id, q) };
  });

  app.get('/v1/artifacts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const a = await kernel.artifacts.get(id);
    if (!a) throw new KernelError('artifact_not_found', `no artifact ${id}`, false, 404);
    return a;
  });

  app.post('/v1/artifacts', async (req, reply) => {
    const b = req.body as any;
    const a = await kernel.artifacts.create(b);
    await kernel.events.append({
      venture_id: b.venture_id,
      type: a.quality === 'signed' ? 'artifact.signed' : 'artifact.created',
      actor_kind: 'agent',
      actor_id: b.produced_by,
      department_id: b.department_id,
      payload: {
        artifact: { type: a.type, id: a.id, version: a.version, hash: a.body_hash },
        ...(a.quality === 'signed' ? { quality: a.quality, cost_usd: a.cost_usd } : {}),
      },
      trace_id: await kernel.traceFor(b.venture_id),
      correlation_id: b.work_order_id,
    });
    reply.code(201);
    return a;
  });

  /* ── Work orders & events ─────────────────────────────────────────────── */

  app.post('/v1/work-orders', async (req, reply) => {
    const b = req.body as any;
    const id = await kernel.issueWorkOrder(b);
    reply.code(201);
    return { work_order_id: id };
  });

  app.get('/v1/ventures/:id/work-orders', async (req) => {
    const { id } = req.params as { id: string };
    const r = await kernel.db.query('SELECT * FROM work_orders WHERE venture_id = $1 ORDER BY created_at', [id]);
    return { work_orders: r.rows };
  });

  app.post('/v1/events', async (req, reply) => {
    const b = req.body as any;
    if (await kernel.isHalted(b.venture_id)) {
      throw new KernelError('kill_switch_engaged', 'venture is halted; no side effects permitted', false, 423);
    }
    const e = await kernel.events.append({
      venture_id: b.venture_id,
      type: b.type,
      actor_kind: b.actor_kind ?? 'agent',
      actor_id: b.actor_id,
      department_id: b.department_id,
      payload: b.payload ?? {},
      trace_id: b.trace_id ?? (await kernel.traceFor(b.venture_id)),
      causation_id: b.causation_id,
      correlation_id: b.correlation_id,
      idempotency_key: b.idempotency_key,
    });
    reply.code(201);
    return e;
  });

  /* ── Gates ────────────────────────────────────────────────────────────── */

  app.get('/v1/gates', async (req) => {
    const q = req.query as { venture_id: string; status?: string };
    return { gates: await kernel.gates.list(q.venture_id, q.status) };
  });

  app.post('/v1/gates', async (req, reply) => {
    const gate = await kernel.gates.open(req.body as any);
    reply.code(201);
    return gate;
  });

  app.post('/v1/gates/:id/decision', async (req) => {
    const { id } = req.params as { id: string };
    return kernel.gates.decide(id, req.body as any);
  });

  /* ── Money ────────────────────────────────────────────────────────────── */

  app.get('/v1/budgets/:venture_id', async (req) => {
    const { venture_id } = req.params as { venture_id: string };
    return { budgets: await kernel.meter.budgets(venture_id) };
  });

  app.post('/v1/kill-switch', async (req) => {
    const b = req.body as { venture_id: string; on: boolean; actor?: string };
    await kernel.killSwitch(b.venture_id, b.on, b.actor);
    return { venture_id: b.venture_id, kill_switch: b.on };
  });

  /* ── SSE ──────────────────────────────────────────────────────────────── */

  app.get('/v1/ventures/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lastId = Number(req.headers['last-event-id'] ?? (req.query as any).after_seq ?? 0);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (e: StoredEvent) => {
      reply.raw.write(`id: ${e.seq}\nevent: event\ndata: ${JSON.stringify({
        seq: e.seq, event: 'event', venture_id: e.venture_id, type: e.type,
        payload: { ...e.payload, actor_id: e.actor_id, department_id: e.department_id, ts: e.ts },
        trace_id: e.trace_id,
      })}\n\n`);
    };

    // Replay anything the client missed, then stream live.
    for (const e of await kernel.events.readStream(id, { after_seq: lastId, limit: 500 })) send(e);

    const off = kernel.events.onEvent((e) => {
      if (e.venture_id === id) send(e);
    });
    const hb = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: {"ts":"${nowIso()}"}\n\n`);
    }, 15_000);
    hb.unref?.();

    req.raw.on('close', () => {
      clearInterval(hb);
      off();
    });
    return reply;
  });

  /* ── Webhooks ─────────────────────────────────────────────────────────── */

  const vendors = ['stripe', 'composio', 'linq', 'terac', 'replay', 'render', 'whop', 'dodo'] as const;
  for (const vendor of vendors) {
    app.post(`/v1/webhooks/${vendor}`, async (req, reply) => {
      const raw = JSON.stringify(req.body ?? {});
      const secretEnv = `${vendor.toUpperCase()}_WEBHOOK_SECRET`;
      const secret = process.env[secretEnv];
      if (secret) {
        const sig = String(req.headers['x-signature'] ?? req.headers['stripe-signature'] ?? '');
        const expected = createHmac('sha256', secret).update(raw).digest('hex');
        const ok =
          sig.length === expected.length &&
          timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
        if (!ok) {
          reply.code(401);
          return { error: { code: 'bad_signature', message: 'signature mismatch', trace_id: 'none', retryable: false } };
        }
      }
      const body = (req.body ?? {}) as any;
      const venture_id = body.venture_id ?? body.metadata?.venture_id;
      if (!venture_id) {
        reply.code(202);
        return { accepted: false, reason: 'no venture_id in payload' };
      }
      const mapped = mapWebhook(vendor, body);
      await kernel.events.append({
        venture_id,
        type: mapped.type,
        actor_kind: 'webhook',
        actor_id: vendor,
        payload: mapped.payload,
        trace_id: await kernel.traceFor(venture_id),
        idempotency_key: `wh:${vendor}:${body.id ?? uuid()}`,
      });
      reply.code(202);
      return { accepted: true, type: mapped.type };
    });
  }

  return app;
}

/** Vendor payload -> internal event. Kept in one place so drivers stay dumb. */
export function mapWebhook(vendor: string, body: any): { type: string; payload: Record<string, unknown> } {
  switch (vendor) {
    case 'stripe': {
      const t = body.type as string | undefined;
      if (t === 'checkout.session.completed' || t === 'invoice.paid') {
        const amount = Number(body.data?.object?.amount_total ?? body.data?.object?.amount_paid ?? 0) / 100;
        return {
          type: 'money.revenue_received',
          payload: { amount_usd: amount, rail: 'stripe', external_id: String(body.data?.object?.id ?? body.id ?? '') },
        };
      }
      if (t === 'charge.refunded') {
        return { type: 'money.refunded', payload: { external_id: String(body.id ?? '') } };
      }
      return { type: 'human.notified', payload: { vendor, raw_type: t ?? 'unknown' } };
    }
    case 'render':
      return body.type === 'deploy_failed'
        ? { type: 'build.rolled_back', payload: { reason: 'render deploy failed' } }
        : { type: 'build.deployed', payload: {
            url: String(body.url ?? ''), commit_sha: String(body.commit ?? ''),
            environment: String(body.environment ?? 'production') } };
    case 'replay':
      return body.passed === false
        ? { type: 'build.qa_failed', payload: { report: String(body.report_url ?? '') } }
        : { type: 'build.qa_passed', payload: { report: String(body.report_url ?? '') } };
    case 'linq':
      return { type: 'human.replied', payload: { text: String(body.text ?? ''), from: String(body.from ?? '') } };
    case 'composio':
      return { type: 'sales.reply_received', payload: { from: String(body.from ?? ''), text: String(body.text ?? '') } };
    case 'terac':
      return { type: 'terac.work_delivered', payload: { hire_id: String(body.hire_id ?? '') } };
    case 'whop':
    case 'dodo':
      return { type: 'money.revenue_received', payload: {
        amount_usd: Number(body.amount ?? 0), rail: vendor, external_id: String(body.id ?? '') } };
    default:
      return { type: 'human.notified', payload: { vendor } };
  }
}
