import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Kernel } from './kernel.js';
import { KernelError, type StoredEvent } from './event-store.js';
import { sendFounderText } from './founder-channel.js';
import { nowIso, uuid } from './util.js';
import { integrationStatus, probe, sendLinqText, setIntegrationVar, INTEGRATIONS } from './integrations.js';
import { VOICE_CONSENT_TEXT_V1 } from './voice.js';
import { resolveDepartments } from './insight.js';

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

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const raw = String(body || '{}');
      done(null, { __rawBody: raw, __parsedBody: JSON.parse(raw) });
    } catch (error) {
      done(error as Error);
    }
  });

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
    const b = unwrapBody(req.body);
    const created = await kernel.createVenture({
      mode: b.mode,
      name: b.name ?? b.idea_seed?.normalized?.problem?.slice(0, 40),
      founder: b.founder_profile ?? { display_name: 'Founder' },
      autonomy_level: b.autonomy_level,
      spend_cap_usd: b.spend_cap_usd,
      terac_cap_usd: b.terac_cap_usd,
    });

    // Founder-chosen settings (workspace folder, meeting schedule, voice consent, acks) travel with the venture.
    if (b.settings && typeof b.settings === 'object') {
      await kernel.settings.update(created.venture_id, b.settings, created.founder_id);
    }
    if (b.workspace_root || b.agency_workspace_path) {
      await kernel.settings.update(created.venture_id, { workspace: { workspace_root: b.workspace_root ?? b.agency_workspace_path, source: b.workspace_source ?? 'typed', granted_at: nowIso() } }, created.founder_id);
    }
    if (b.founder_profile?.phone_e164 && !process.env.FOUNDER_PHONE) {
      await setIntegrationVar('FOUNDER_PHONE', String(b.founder_profile.phone_e164)).catch(() => undefined);
    }

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

  app.post('/v1/ventures/:id/daily-briefing', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await kernel.venture(id);
    if (!v) throw new KernelError('venture_not_found', `no venture ${id}`, false, 404);
    const b = unwrapBody(req.body);
    const event = await kernel.events.append({
      venture_id: id,
      type: 'ops.daily_briefing_started',
      actor_kind: b.actor_kind ?? 'system',
      actor_id: b.actor_id ?? 'system.daily-briefing',
      department_id: 'D13',
      payload: {
        meeting_date: b.meeting_date ?? new Date().toISOString().slice(0, 10),
        timezone: b.timezone ?? 'America/Los_Angeles',
        band_room: b.band_room ?? 'executive-briefing',
        lookback_hours: b.lookback_hours ?? 24,
      },
      trace_id: await kernel.traceFor(id),
      idempotency_key: b.idempotency_key,
    });
    reply.code(201);
    return { event };
  });

  app.post('/v1/ventures/:id/transfer-onboarding-to-phone', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await kernel.venture(id);
    if (!v) throw new KernelError('venture_not_found', `no venture ${id}`, false, 404);
    const b = unwrapBody(req.body);
    const text = String(b.text ?? "Let's continue the onboarding process here. Reply with your next answer, or type STOP to pause.");
    const result = await sendFounderText({
      text,
      to: typeof b.phone_e164 === 'string' ? b.phone_e164 : undefined,
      metadata: { venture_id: id, kind: 'onboarding_transfer', step: b.step ?? 'current' },
    });
    const event = await kernel.events.append({
      venture_id: id,
      type: 'human.notified',
      actor_kind: 'system',
      actor_id: 'kernel.founder-channel',
      payload: {
        channel: 'linq',
        purpose: 'onboarding_transfer',
        delivered: result.delivered,
        message_id: result.message_id,
        degraded: result.degraded,
      },
      trace_id: await kernel.traceFor(id),
      idempotency_key: b.idempotency_key ?? `onboarding_transfer:${id}:${b.step ?? 'current'}`,
    });
    reply.code(202);
    return { event, delivery: result };
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
    const b = unwrapBody(req.body);
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
    const b = unwrapBody(req.body);
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
    const b = unwrapBody(req.body);
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
    const gate = await kernel.gates.open(unwrapBody(req.body));
    reply.code(201);
    return gate;
  });

  app.post('/v1/gates/:id/decision', async (req) => {
    const { id } = req.params as { id: string };
    return kernel.gates.decide(id, unwrapBody(req.body));
  });

  /* ── Money ────────────────────────────────────────────────────────────── */

  app.get('/v1/budgets/:venture_id', async (req) => {
    const { venture_id } = req.params as { venture_id: string };
    return { budgets: await kernel.meter.budgets(venture_id) };
  });

  app.post('/v1/kill-switch', async (req) => {
    const b = unwrapBody(req.body) as { venture_id: string; on: boolean; actor?: string };
    await kernel.killSwitch(b.venture_id, b.on, b.actor);
    return { venture_id: b.venture_id, kill_switch: b.on };
  });

  /* ── SSE ──────────────────────────────────────────────────────────────── */

  app.get('/v1/ventures/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    let lastId = Number(req.headers['last-event-id'] ?? (req.query as any).after_seq ?? 0);
    // A fresh client (no cursor) gets the most recent 500, not the oldest 500.
    if (!lastId) lastId = Math.max(0, (await kernel.events.latestSeq(id)) - 500);

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

  /* ── Settings, insight, meetings, voice, wallets, integrations ───────────── */

  app.get('/v1/ventures/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    return { settings: await kernel.settings.get(id) };
  });
  app.put('/v1/ventures/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    return { settings: await kernel.settings.update(id, unwrapBody(req.body) as Record<string, unknown>) };
  });
  app.post('/v1/ventures/:id/workspace', async (req) => {
    const { id } = req.params as { id: string };
    const b = unwrapBody(req.body) as { workspace_root?: string; agency_workspace_path?: string; source?: string };
    const root = b.workspace_root ?? b.agency_workspace_path;
    if (!root) throw new KernelError('bad_request', 'workspace_root is required', false, 400);
    const settings = await kernel.settings.update(id, { workspace: { workspace_root: root, source: b.source ?? 'typed', granted_at: nowIso() } });
    return { settings, workspace_root: settings.workspace.workspace_root };
  });

  app.get('/v1/ventures/:id/departments/:dept/facts', async (req) => {
    const { id, dept } = req.params as { id: string; dept: string };
    const depts = resolveDepartments(dept);
    return { department_ids: depts, facts: await kernel.insight.facts(id, depts) };
  });
  app.post('/v1/ventures/:id/departments/:dept/ask', async (req) => {
    const { id, dept } = req.params as { id: string; dept: string };
    const b = unwrapBody(req.body) as { question?: string; actor?: string };
    if (!b.question?.trim()) throw new KernelError('bad_request', 'question is required', false, 400);
    const trace_id = await kernel.traceFor(id);
    return kernel.insight.ask(id, dept, b.question.trim(), { trace_id, actor: b.actor });
  });
  app.get('/v1/ventures/:id/agents', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { department?: string };
    return { agents: await kernel.insight.agents(id, q.department) };
  });
  app.get('/v1/ventures/:id/goals', async (req) => {
    const { id } = req.params as { id: string };
    return kernel.insight.goals(id);
  });
  app.get('/v1/ventures/:id/briefing/latest', async (req) => {
    const { id } = req.params as { id: string };
    return { briefing: await kernel.insight.latestBriefing(id) };
  });

  app.post('/v1/ventures/:id/meetings/:kind/start', async (req, reply) => {
    const { id, kind } = req.params as { id: string; kind: string };
    const allowed = ['executive', 'all_hands', 'improvement', 'workday_start', 'workday_end'];
    if (!allowed.includes(kind)) throw new KernelError('bad_request', `kind must be one of ${allowed.join(', ')}`, false, 400);
    const r = await kernel.clock.fire(id, kind as any, { scheduled: false });
    reply.code(201);
    return r;
  });
  app.post('/v1/ventures/:id/meetings/:kind/end', async (req) => {
    const { id, kind } = req.params as { id: string; kind: string };
    await kernel.clock.endMeeting(id, kind as any);
    return { ended: true };
  });
  app.post('/v1/ventures/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = unwrapBody(req.body) as { room?: string; author?: string; text?: string; department_id?: string };
    if (!b.text?.trim()) throw new KernelError('bad_request', 'text is required', false, 400);
    const e = await kernel.events.append({
      venture_id: id, type: 'dept.chat_posted', actor_kind: 'founder', actor_id: b.author ?? 'founder',
      department_id: b.department_id as any,
      payload: { room: b.room ?? 'general', author: b.author ?? 'founder', text: b.text.trim(), transport: 'local' },
      trace_id: await kernel.traceFor(id),
    });
    reply.code(201);
    return { event: e };
  });

  app.get('/v1/voice/consent-text', async () => ({ version: 'v1', text: VOICE_CONSENT_TEXT_V1 }));
  app.post('/v1/ventures/:id/voice/consent', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await kernel.voice.consent(id, unwrapBody(req.body) as any);
    reply.code(201);
    return r;
  });
  app.post('/v1/ventures/:id/voice/clone', { bodyLimit: 30 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await kernel.voice.clone(id, unwrapBody(req.body) as any);
    reply.code(201);
    return r;
  });
  app.post('/v1/ventures/:id/voice/revoke', async (req) => {
    const { id } = req.params as { id: string };
    return kernel.voice.revoke(id, unwrapBody(req.body)?.reason);
  });

  app.get('/v1/ventures/:id/wallets', async (req) => {
    const { id } = req.params as { id: string };
    return kernel.wallets.list(id);
  });
  app.post('/v1/ventures/:id/wallets/topup', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = unwrapBody(req.body) as { amount_usd?: number; success_url?: string; cancel_url?: string };
    const amount = Number(b.amount_usd ?? 0);
    if (!(amount > 0 && amount <= 10_000)) throw new KernelError('bad_request', 'amount_usd must be between 0 and 10000', false, 400);
    const origin = String(req.headers.origin ?? 'http://localhost:5173');
    const r = await kernel.wallets.createTopUp(id, amount, b.success_url ?? `${origin}/?topup=success`, b.cancel_url ?? `${origin}/?topup=cancel`);
    reply.code(201);
    return r;
  });

  app.get('/v1/integrations', async () => ({ integrations: integrationStatus(), tools_driver: process.env.ZEROTH_TOOLS === 'real' ? 'real' : 'mock', llm_driver: process.env.ANTHROPIC_API_KEY && process.env.ZEROTH_LLM !== 'mock' ? 'anthropic' : 'mock' }));
  app.get('/v1/integrations/catalog', async () => ({ integrations: INTEGRATIONS.map((i) => ({ ...i, vars: i.vars.map((v) => ({ ...v, secret: v.secret !== false })) })) }));
  app.post('/v1/integrations/:id/probe', async (req) => {
    const { id } = req.params as { id: string };
    return { id, ...(await probe(id)) };
  });
  app.put('/v1/integrations/vars/:env', async (req) => {
    const { env } = req.params as { env: string };
    const b = unwrapBody(req.body) as { value?: string };
    try {
      const r = await setIntegrationVar(env, String(b.value ?? ''));
      return { env: r.env, configured: r.configured };
    } catch (e) {
      throw new KernelError('bad_request', e instanceof Error ? e.message : String(e), false, 400);
    }
  });
  app.post('/v1/integrations/linq/test-message', async (req) => {
    const b = unwrapBody(req.body) as { to?: string; text?: string; venture_id?: string };
    const to = b.to ?? process.env.FOUNDER_PHONE ?? '';
    const r = await sendLinqText(to, b.text ?? 'HELLO from Zeroth 👋 — your AI company can reach you here. Reply YES to confirm.', { kind: 'onboarding_test', venture_id: b.venture_id });
    if (b.venture_id) {
      await kernel.settings.update(b.venture_id, { linq_test_message: { sent_at: nowIso(), delivered: r.ok, degraded: r.degraded } }).catch(() => undefined);
      await kernel.events.append({ venture_id: b.venture_id, type: 'human.notified', actor_kind: 'system', actor_id: 'kernel.integrations', payload: { channel: 'linq', kind: 'onboarding_test', delivered: r.ok, degraded: r.degraded }, trace_id: await kernel.traceFor(b.venture_id) }).catch(() => undefined);
    }
    return { to, ...r };
  });
  app.post('/v1/integrations/linq/confirm', async (req) => {
    const b = unwrapBody(req.body) as { venture_id?: string; confirmed?: boolean };
    if (!b.venture_id) throw new KernelError('bad_request', 'venture_id required', false, 400);
    const cur = await kernel.settings.get(b.venture_id);
    const settings = await kernel.settings.update(b.venture_id, { linq_test_message: { ...(cur.linq_test_message ?? { sent_at: nowIso(), delivered: false }), confirmed_by_founder: Boolean(b.confirmed) } });
    return { settings };
  });

  /* ── Webhooks ─────────────────────────────────────────────────────────── */

  const vendors = ['stripe', 'composio', 'linq', 'terac', 'replay', 'render', 'whop', 'dodo'] as const;
  for (const vendor of vendors) {
    app.post(`/v1/webhooks/${vendor}`, async (req, reply) => {
      const raw = rawBody(req.body);
      const secretEnv = `${vendor.toUpperCase()}_WEBHOOK_SECRET`;
      const secret = process.env[secretEnv];
      if (secret) {
        const sig = String(req.headers['x-signature'] ?? req.headers['stripe-signature'] ?? '');
        const ok = vendor === 'stripe' ? verifyStripeSignature(raw, sig, secret) : verifyGenericSignature(raw, sig, secret);
        if (!ok) {
          reply.code(401);
          return { error: { code: 'bad_signature', message: 'signature mismatch', trace_id: 'none', retryable: false } };
        }
      }
      const body = unwrapBody(req.body);
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
      if (mapped.type === 'money.wallet_funded') {
        await kernel.wallets.fund(venture_id, Number((mapped.payload as any).amount_usd ?? 0), 'stripe', `${String((mapped.payload as any).external_id ?? '')}:apply`).catch(() => undefined);
      }
      if (vendor === 'linq') {
        const decision = await parseLinqGateDecision(kernel, body);
        if (decision) {
          try {
            await kernel.gates.decide(decision.gate_id, decision);
          } catch (error) {
            if (!String(error).includes('gate_already_decided')) throw error;
          }
        }
      }
      reply.code(202);
      return { accepted: true, type: mapped.type };
    });
  }

  return app;
}

function unwrapBody(body: unknown): any {
  if (body && typeof body === 'object' && '__parsedBody' in body) return (body as any).__parsedBody;
  return (body ?? {}) as any;
}

function rawBody(body: unknown): string {
  if (body && typeof body === 'object' && '__rawBody' in body) return String((body as any).__rawBody);
  return JSON.stringify(body ?? {});
}

function verifyGenericSignature(raw: string, sig: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function verifyStripeSignature(raw: string, sig: string, secret: string): boolean {
  const parts = Object.fromEntries(sig.split(',').map((part) => {
    const [key, ...rest] = part.split('=');
    return [key, rest.join('=')];
  }));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}

/** Vendor payload -> internal event. Kept in one place so drivers stay dumb. */
export function mapWebhook(vendor: string, body: any): { type: string; payload: Record<string, unknown> } {
  switch (vendor) {
    case 'stripe': {
      const t = body.type as string | undefined;
      if (t === 'checkout.session.completed' && body.data?.object?.metadata?.kind === 'wallet_topup') {
        const amount = Number(body.data?.object?.amount_total ?? 0) / 100;
        return { type: 'money.wallet_funded', payload: { amount_usd: amount, rail: 'stripe', external_id: String(body.data?.object?.id ?? body.id ?? '') } };
      }
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
      return { type: 'human.replied', payload: { text: String(body.text ?? body.message?.text ?? ''), from: String(body.from ?? ''), gate_id: body.gate_id ?? body.metadata?.gate_id } };
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

async function parseLinqGateDecision(kernel: Kernel, body: any): Promise<({ gate_id: string; option_id: string; decided_by: string; decision: 'approve' | 'reject' | 'redirect'; note: string }) | null> {
  const gate_id = String(body.gate_id ?? body.metadata?.gate_id ?? '');
  if (!gate_id) return null;
  const gate = await kernel.gates.get(gate_id);
  if (!gate || gate.status !== 'pending') return null;

  const raw = String(body.text ?? body.message?.text ?? body.reaction ?? '').trim();
  const normalized = raw.toLowerCase();
  // A delivery receipt / empty echo must never decide a gate; and when we know the
  // founder's number, only that number may decide over the phone channel.
  if (!normalized) return null;
  const from = String(body.from ?? body.sender ?? body.message?.from ?? '').replace(/[^\d+]/g, '');
  if (process.env.FOUNDER_PHONE && from && from !== process.env.FOUNDER_PHONE.replace(/[^\d+]/g, '')) return null;
  const decided_by = String(body.from ?? 'linq-founder');
  const rejectWords = new Set(['no', 'n', 'reject', 'stop', 'deny', '👎']);
  const approveWords = new Set(['yes', 'y', 'approve', 'approved', 'ok', 'okay', '👍']);

  if (rejectWords.has(normalized)) {
    return { gate_id, option_id: gate.options[0]?.id ?? 'reject', decided_by, decision: 'reject', note: raw };
  }

  const exactOption = gate.options.find((option) => option.id.toLowerCase() === normalized);
  const labelOption = gate.options.find((option) => option.label.toLowerCase().startsWith(normalized));
  const option = exactOption ?? labelOption;
  if (option) return { gate_id, option_id: option.id, decided_by, decision: 'approve', note: raw };

  if (approveWords.has(normalized)) {
    const option_id = gate.suggested_option_id ?? gate.options[0]?.id;
    if (option_id) return { gate_id, option_id, decided_by, decision: 'approve', note: raw };
  }

  return null;
}
