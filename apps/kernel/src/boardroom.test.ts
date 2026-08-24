import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '@zeroth/db';
import { Kernel } from './kernel.js';
import { buildServer } from './server.js';
import { dueKinds, localClock } from './scheduler.js';
import { factsAnswer, resolveDepartments } from './insight.js';

/**
 * Boardroom-facing surface: settings/workspace, department Q&A, agents,
 * goals, meetings, voice consent, wallets, integrations. All in mock mode
 * (zero keys) — the same code path the founder's laptop runs before keys land.
 */

// This file's whole premise is "mock mode — zero keys" (see file comment above).
// That must hold regardless of what the invoking shell happens to have exported
// (e.g. a founder who ran `source .env` before `pnpm test`), not just in a
// pristine CI environment — otherwise the department-Q&A test flakes between
// 'facts' and 'llm' depending on ambient state instead of test intent.
const LLM_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY'] as const;
const savedLlmKeys: Partial<Record<(typeof LLM_KEYS)[number], string>> = {};
beforeEach(() => {
  for (const k of LLM_KEYS) { if (process.env[k] !== undefined) { savedLlmKeys[k] = process.env[k]; delete process.env[k]; } }
});
afterEach(() => {
  for (const k of LLM_KEYS) { if (savedLlmKeys[k] !== undefined) process.env[k] = savedLlmKeys[k]; }
});

const openKernels: Kernel[] = [];
async function freshKernel() {
  const db: Db = await openDb({ dataDir: 'memory' });
  const kernel = await Kernel.create({ db, routing: [], signingKey: 'test-key' });
  openKernels.push(kernel);
  return kernel;
}
afterEach(async () => {
  await Promise.all(openKernels.splice(0).map((k) => k.close()));
  delete process.env.ZEROTH_ENV_FILE;
});

const auth = { authorization: 'Bearer t' };

async function createVenture(app: any, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST', url: '/v1/ventures', headers: auth,
    payload: {
      mode: 'founder_led',
      founder_profile: { display_name: 'Ada', email: `ada-${Math.random()}@x.com`, phone_e164: '+16502231633', timezone: 'America/Los_Angeles' },
      idea_seed: { raw_statement: 'Recall reminders for dental clinics', normalized: { problem: 'missed recalls', who_hurts: 'dental clinics', current_workaround: 'spreadsheets', proposed_solution: 'auto reminders', business_model_guess: 'saas', category: 'health' } },
      spend_cap_usd: 40,
      ...extra,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { venture_id: string; first_work_order_id: string };
}

describe('venture settings & workspace', () => {
  it('persists founder settings from venture creation and returns them merged with defaults', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const dir = await mkdtemp(path.join(tmpdir(), 'zeroth-ws-'));
    const v = await createVenture(app, {
      settings: { meetings: { timezone: 'America/New_York', exec_meeting_time: '08:30', all_hands_time: '09:15', work_start: '09:00', work_end: '18:00' } },
      workspace_root: dir,
    });
    const s = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/settings`, headers: auth })).json().settings;
    expect(s.workspace.workspace_root).toBe(dir);
    expect(s.workspace.agency_workspace_path).toBe(dir);
    expect(s.meetings.timezone).toBe('America/New_York');
    expect(s.meetings.exec_meeting_time).toBe('08:30');
    expect(s.meetings.improvement_time).toBe('17:30'); // default filled in
    expect(s.voice.status).toBe('none');

    // Work orders issued for this venture carry the workspace, so D07 knows where to build.
    const wos = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/work-orders`, headers: auth })).json().work_orders;
    const params = typeof wos[0].params === 'string' ? JSON.parse(wos[0].params) : wos[0].params;
    expect(params.workspace_root).toBe(dir);
  });

  it('rejects an invalid meeting time and accepts a workspace grant via POST /workspace', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    const bad = await app.inject({ method: 'PUT', url: `/v1/ventures/${v.venture_id}/settings`, headers: auth, payload: { meetings: { exec_meeting_time: '25:99' } } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const ok = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/workspace`, headers: auth, payload: { agency_workspace_path: '/tmp/zeroth-demo', source: 'picker' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().workspace_root).toBe('/tmp/zeroth-demo');
    const timeline = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/timeline?types=venture.settings_updated`, headers: auth })).json();
    expect(timeline.events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('department Q&A, agents, goals', () => {
  it('answers from facts in mock mode and records the exchange', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    const res = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/departments/research/ask`, headers: auth, payload: { question: 'What are you doing right now?' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('facts');
    expect(body.department_ids).toEqual(['D01', 'D02', 'D03']);
    expect(body.answer).toMatch(/normalize_idea/);
    const evs = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/timeline?types=dept.question_answered`, headers: auth })).json();
    expect(evs.events).toHaveLength(1);
    // Executive room = whole company
    const exec = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/departments/exec/ask`, headers: auth, payload: { question: 'What is the vision?' } });
    expect(exec.json().department_ids).toHaveLength(13);
  });

  it('exposes agents and goals views', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    await k.events.append({ venture_id: v.venture_id, type: 'agent.started', actor_kind: 'agent', actor_id: 'intake.head', department_id: 'D01', payload: { agent_id: 'intake.head', intent: 'normalize_idea' }, trace_id: 't', correlation_id: v.first_work_order_id });
    await k.events.append({ venture_id: v.venture_id, type: 'agent.tool_used', actor_kind: 'agent', actor_id: 'intake.head', department_id: 'D01', payload: { agent_id: 'intake.head', tool_name: 'calc' }, trace_id: 't', correlation_id: v.first_work_order_id });
    const agents = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/agents?department=D01`, headers: auth })).json().agents;
    const head = agents.find((a: any) => a.agent_id === 'intake.head');
    expect(head.status).toBe('working');
    expect(head.current.task).toBe('normalize_idea');
    expect(head.tools.calc).toBe(1);
    const goals = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/goals`, headers: auth })).json();
    expect(goals.milestones).toHaveLength(5);
    expect(goals.roadmap).toHaveLength(13);
  });

  it('resolves room aliases and produces a facts answer without an LLM', () => {
    expect(resolveDepartments('engineering')).toEqual(['D07']);
    expect(resolveDepartments('D10')).toEqual(['D10']);
    expect(resolveDepartments('nope')).toEqual([]);
    const ans = factsAnswer({ department_ids: ['D07'], now: { work_orders: [{ intent: 'build_product', status: 'running' }], recent_events: [] }, done: { completed_work_orders: [], signed_artifacts: [] }, goals: { company: [], department: [], blockers: ['no workspace'], asks: [] }, pending_gates: [], budget: [], chat: [] } as any, 'what are you doing');
    expect(ans).toMatch(/build_product/);
  });
});

describe('company clock & meetings', () => {
  it('computes due schedule points in the founder timezone', () => {
    const sched = { timezone: 'America/Los_Angeles', work_start: '09:00', work_end: '17:00', exec_meeting_time: '07:00', exec_meeting_minutes: 30, all_hands_time: '09:00', all_hands_minutes: 15, improvement_time: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] } as const;
    expect(dueKinds(sched as any, 9 * 60, 'mon').sort()).toEqual(['all_hands', 'workday_start']);
    expect(dueKinds(sched as any, 17 * 60 + 31, 'fri')).toEqual(['improvement']);
    expect(dueKinds(sched as any, 9 * 60, 'sat')).toEqual([]);
    const c = localClock(new Date('2026-08-17T16:00:00Z'), 'America/Los_Angeles');
    expect(c.hhmm).toBe('09:00');
    expect(c.day).toBe('mon');
  });

  it('starts an all-hands, an executive briefing, and the improvement branch on demand (idempotent when scheduled)', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    const ah = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/meetings/all_hands/start`, headers: auth });
    expect(ah.statusCode).toBe(201);
    const ex = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/meetings/executive/start`, headers: auth });
    expect(ex.statusCode).toBe(201);
    const imp = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/meetings/improvement/start`, headers: auth });
    expect(imp.statusCode).toBe(201);
    const t = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/timeline?types=ops.meeting_started,ops.daily_briefing_started,ops.improvement_run_started`, headers: auth })).json();
    const types = t.events.map((e: any) => e.type);
    expect(types.filter((x: string) => x === 'ops.meeting_started')).toHaveLength(2);
    expect(types).toContain('ops.daily_briefing_started');
    expect(types).toContain('ops.improvement_run_started');
    // scheduled firing is idempotent per day/kind
    await k.clock.fire(v.venture_id, 'all_hands', { scheduled: true, date: '2026-08-17' });
    await k.clock.fire(v.venture_id, 'all_hands', { scheduled: true, date: '2026-08-17' });
    const t2 = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/timeline?types=ops.meeting_started`, headers: auth })).json();
    expect(t2.events).toHaveLength(3);
    const end = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/meetings/all_hands/end`, headers: auth });
    expect(end.statusCode).toBe(200);
  });

  it('turns a signed CapabilityGap into a Linq gate and only builds after approval', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    const art = await k.artifacts.create({ venture_id: v.venture_id, type: 'CapabilityGap', body: { taxonomy: 'missing_tool', summary: 'No way to send SMS reminders', evidence_refs: ['evt:1', 'evt:2'], occurrences: 3, proposed_fix: 'add an sms tool to D10', expected_impact: 'recover 3 stalled outreach sequences', risk: 'low' }, produced_by: 'chief.head', department_id: 'D13', quality: 'signed' });
    await k.events.append({ venture_id: v.venture_id, type: 'artifact.signed', actor_kind: 'agent', actor_id: 'chief.head', department_id: 'D13', payload: { artifact: { type: 'CapabilityGap', id: art.id, version: art.version, hash: art.body_hash }, quality: 'signed', cost_usd: 0 }, trace_id: 't' });
    await new Promise((r) => setTimeout(r, 150));
    const gates = (await app.inject({ method: 'GET', url: `/v1/gates?venture_id=${v.venture_id}&status=pending`, headers: auth })).json().gates;
    const g = gates.find((x: any) => x.gate_type === 'new_department');
    expect(g).toBeTruthy();
    expect(g.channel).toBe('linq');
    const before = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/work-orders`, headers: auth })).json().work_orders.filter((w: any) => w.intent === 'implement_capability');
    expect(before).toHaveLength(0);
    const dec = await app.inject({ method: 'POST', url: `/v1/gates/${g.id}/decision`, headers: auth, payload: { option_id: 'approve', decided_by: 'founder', decision: 'approve', note: 'yes' } });
    expect(dec.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    const after = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/work-orders`, headers: auth })).json().work_orders.filter((w: any) => w.intent === 'implement_capability');
    expect(after).toHaveLength(1);
    expect(after[0].to_dept).toBe('D07');
  });
});

describe('voice consent, wallets, integrations', () => {
  it('requires consent before cloning, clones in mock mode, and revokes', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app);
    const sample = Buffer.alloc(4000, 1).toString('base64');
    const early = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/voice/clone`, headers: auth, payload: { audio_base64: sample } });
    expect(early.statusCode).toBeGreaterThanOrEqual(400);
    const consent = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/voice/consent`, headers: auth, payload: { accepted: true, display_name: 'Ada' } });
    expect(consent.statusCode).toBe(201);
    expect(consent.json().consent_event_id).toBeTruthy();
    const clone = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/voice/clone`, headers: auth, payload: { audio_base64: sample, mime_type: 'audio/webm', name: 'Ada' } });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().voice_id).toBeTruthy();
    const s = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/settings`, headers: auth })).json().settings;
    expect(s.voice.status).toBe('cloned');
    expect(s.voice.sample_meta.bytes).toBeGreaterThan(0);
    const gates = (await app.inject({ method: 'GET', url: `/v1/gates?venture_id=${v.venture_id}`, headers: auth })).json().gates;
    expect(gates.some((g: any) => g.gate_type === 'voice_clone_consent' && g.status === 'approved')).toBe(true);
    const rev = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/voice/revoke`, headers: auth, payload: {} });
    expect(rev.statusCode).toBe(200);
    const s2 = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/settings`, headers: auth })).json().settings;
    expect(s2.voice.status).toBe('revoked');
    expect(s2.voice.voice_id).toBeUndefined();
    const evs = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/timeline?types=human.consent_recorded,human.consent_revoked`, headers: auth })).json();
    expect(evs.events.map((e: any) => e.type)).toEqual(['human.consent_recorded', 'human.consent_revoked']);
  });

  it('lists wallets per department and funds them via a (mock) top-up', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const v = await createVenture(app, { spend_cap_usd: 26 });
    const w1 = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/wallets`, headers: auth })).json();
    expect(w1.wallets).toHaveLength(13);
    expect(w1.wallets[0].envelope_usd).toBeCloseTo(2, 5);
    const prev = process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
    const top = await app.inject({ method: 'POST', url: `/v1/ventures/${v.venture_id}/wallets/topup`, headers: auth, payload: { amount_usd: 13 } });
    if (prev) process.env.STRIPE_SECRET_KEY = prev;
    expect(top.statusCode).toBe(201);
    expect(top.json().driver).toBe('mock');
    const w2 = (await app.inject({ method: 'GET', url: `/v1/ventures/${v.venture_id}/wallets`, headers: auth })).json();
    expect(w2.wallets[0].envelope_usd).toBeCloseTo(3, 5);
    expect(w2.funded_usd).toBeCloseTo(13, 5);
  });

  it('reports integration status without leaking values, and writes vars to the env file', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 't' });
    const dir = await mkdtemp(path.join(tmpdir(), 'zeroth-env-'));
    const file = path.join(dir, '.env');
    await writeFile(file, 'OTHER=1\nWHOP_API_KEY=old\n');
    process.env.ZEROTH_ENV_FILE = file;
    const before = process.env.WHOP_API_KEY;
    const put = await app.inject({ method: 'PUT', url: '/v1/integrations/vars/WHOP_API_KEY', headers: auth, payload: { value: 'whop_secret_123456' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ env: 'WHOP_API_KEY', configured: true });
    expect(await readFile(file, 'utf8')).toBe('OTHER=1\nWHOP_API_KEY=whop_secret_123456\n');
    const status = (await app.inject({ method: 'GET', url: '/v1/integrations', headers: auth })).json();
    const whop = status.integrations.find((i: any) => i.id === 'whop');
    expect(whop.ready).toBe(true);
    const v = whop.vars.find((x: any) => x.env === 'WHOP_API_KEY');
    expect(v.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain('whop_secret_123456');
    const bad = await app.inject({ method: 'PUT', url: '/v1/integrations/vars/NOT_A_KEY', headers: auth, payload: { value: 'x' } });
    expect(bad.statusCode).toBe(400);
    if (before === undefined) delete process.env.WHOP_API_KEY; else process.env.WHOP_API_KEY = before;
    const linq = await app.inject({ method: 'POST', url: '/v1/integrations/linq/test-message', headers: auth, payload: { to: '+16502231633' } });
    expect(linq.statusCode).toBe(200);
    // Without a Linq key the call is honest about it rather than pretending.
    if (!process.env.LINQ_API_KEY) expect(linq.json().degraded).toMatch(/LINQ_API_KEY/);
  });
});
