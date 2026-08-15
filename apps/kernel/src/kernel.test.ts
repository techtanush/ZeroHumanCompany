import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { openDb, type Db } from '@zeroth/db';
import { Kernel } from './kernel.js';
import { buildServer } from './server.js';

async function freshKernel(routing: any[] = []) {
  const db: Db = await openDb({ dataDir: 'memory' });
  const kernel = await Kernel.create({ db, routing, signingKey: 'test-key' });
  openKernels.push(kernel);
  return kernel;
}

const openKernels: Kernel[] = [];

afterEach(async () => {
  await Promise.all(openKernels.splice(0).map((kernel) => kernel.close()));
});

async function venture(k: Kernel, autonomy: 'copilot' | 'supervised' | 'autonomous' = 'supervised') {
  return k.createVenture({
    mode: 'founder_led',
    name: 'Test Co',
    founder: { display_name: 'Ada', email: `ada-${Math.random()}@x.com` },
    autonomy_level: autonomy,
    spend_cap_usd: 26,
  });
}

/** A NicheDossier whose numbers are all cited; the happy path for signing. */
function dossier(ids: { tam: string; price: string; cac: string }) {
  const cite = (id: string, method: 'measured' | 'derived' | 'estimated' | 'asserted' = 'measured') => ({
    value: 1_000_000, unit: 'usd', source_ids: [id], method,
  });
  return {
    label: 'Dental clinics, 2-5 chairs, CA',
    slice: { industry: 'dental', size: '2-5 chairs', geo: 'CA', trigger: 'new hire' },
    tam_usd: cite(ids.tam),
    sam_usd: cite(ids.tam),
    som_usd: cite(ids.tam),
    mrr_12mo_usd: cite(ids.tam, 'derived'),
    pricing_hypothesis: { model: 'per seat', price: { value: 199, unit: 'usd', source_ids: [ids.price], method: 'measured' as const }, anchor_comparables: ['Comp A'] },
    competitors: [{ name: 'Comp A', weakness: 'no scheduling', source_ids: [ids.price] }],
    reachability: { channels: ['email'], cac_usd: { value: 120, unit: 'usd', source_ids: [ids.cac], method: 'estimated' as const } },
    wedge: 'one-click recall reminders',
    pros: ['clear pain'],
    cons: ['fragmented buyers'],
    confidence: 0.6,
    rank_rationale: 'highest pain intensity per dollar of CAC',
  };
}

describe('event store', () => {
  let k: Kernel;
  beforeEach(async () => { k = await freshKernel(); });

  it('rejects unknown event types', async () => {
    const v = await venture(k);
    await expect(k.events.append({
      venture_id: v.venture_id, type: 'nonsense.happened', actor_id: 'x', trace_id: 't',
    })).rejects.toThrow(/unknown event type/);
  });

  it('rejects malformed payloads for known types', async () => {
    const v = await venture(k);
    await expect(k.events.append({
      venture_id: v.venture_id, type: 'money.revenue_received', actor_id: 'x', trace_id: 't',
      payload: { amount_usd: 'lots' },
    })).rejects.toThrow(/invalid/i);
  });

  it('is idempotent under a repeated idempotency_key', async () => {
    const v = await venture(k);
    const a = await k.events.append({
      venture_id: v.venture_id, type: 'human.notified', actor_id: 'x', trace_id: 't',
      idempotency_key: 'same',
    });
    const b = await k.events.append({
      venture_id: v.venture_id, type: 'human.notified', actor_id: 'x', trace_id: 't',
      idempotency_key: 'same',
    });
    expect(b.id).toBe(a.id);
    const all = await k.events.readStream(v.venture_id, { types: ['human.notified'] });
    expect(all).toHaveLength(1);
  });

  it('replays a stream in sequence order', async () => {
    const v = await venture(k);
    for (let i = 0; i < 5; i++) {
      await k.events.append({ venture_id: v.venture_id, type: 'agent.started', actor_id: `a${i}`, trace_id: 't' });
    }
    const evs = await k.events.readStream(v.venture_id, { types: ['agent.started'] });
    expect(evs.map((e) => e.actor_id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(evs.map((e) => e.seq)).toEqual([...evs].sort((x, y) => x.seq - y.seq).map((e) => e.seq));
  });
});

describe('evidence enforcement', () => {
  let k: Kernel;
  beforeEach(async () => { k = await freshKernel(); });

  it('refuses to sign an artifact with an uncited number', async () => {
    const v = await venture(k);
    const src = await k.artifacts.registerSource({ venture_id: v.venture_id, kind: 'web_page', uri: 'https://x' });
    const body = dossier({ tam: src, price: src, cac: src });
    // Strip the citations off the TAM: this must be rejected.
    (body.tam_usd as any).source_ids = [];
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier', body: body as any,
      produced_by: 'market.head', department_id: 'D03', quality: 'signed',
    })).rejects.toThrow(/evidence|validation/i);
  });

  it('signs an artifact whose numbers are all cited', async () => {
    const v = await venture(k);
    const src = await k.artifacts.registerSource({ venture_id: v.venture_id, kind: 'web_page', uri: 'https://x' });
    const a = await k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier', body: dossier({ tam: src, price: src, cac: src }) as any,
      produced_by: 'market.head', department_id: 'D03', quality: 'signed',
    });
    expect(a.quality).toBe('signed');
    expect(a.signature).toBeTruthy();
    expect(k.artifacts.verify(a.body, a.signature!)).toBe(true);
  });

  it('refuses a load-bearing number backed only by synthetic evidence', async () => {
    const v = await venture(k);
    const synth = await k.artifacts.registerSource({ venture_id: v.venture_id, kind: 'synthetic_panel' });
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier',
      body: dossier({ tam: synth, price: synth, cac: synth }) as any,
      produced_by: 'market.head', department_id: 'D03', quality: 'signed',
    })).rejects.toThrow(/synthetic/i);
  });

  it('refuses a TAM backed only by method="asserted"', async () => {
    const v = await venture(k);
    const src = await k.artifacts.registerSource({ venture_id: v.venture_id, kind: 'web_page' });
    const body = dossier({ tam: src, price: src, cac: src });
    (body.tam_usd as any).method = 'asserted';
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier', body: body as any,
      produced_by: 'market.head', department_id: 'D03', quality: 'signed',
    })).rejects.toThrow(/asserted/i);
  });

  it('allows an unsigned draft to carry gaps instead of evidence', async () => {
    const v = await venture(k);
    const zero = '00000000-0000-0000-0000-000000000000';
    const body = dossier({ tam: zero, price: zero, cac: zero });
    const a = await k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier', body: body as any,
      produced_by: 'market.head', department_id: 'D03', quality: 'draft', gaps: ['tam unverified'],
    });
    expect(a.quality).toBe('draft');
    expect(a.signature).toBeNull();
  });

  it('rejects an interview that did not disclose it was AI', async () => {
    const v = await venture(k);
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'Interview', department_id: 'D04', produced_by: 'outreach.head',
      quality: 'draft',
      body: {
        subject: { alias: 'P1', kind: 'network', icp_match: 0.8 },
        channel: 'voice',
        consent: { ai_disclosed: false, disclosure_text: '', recording: 'denied', jurisdiction: 'CA', recorded_at: new Date().toISOString() },
        duration_s: 600, script_version: 'v1',
      } as any,
    })).rejects.toThrow(/validation/i);
  });

  it('rejects a p0 feature with no justification', async () => {
    const v = await venture(k);
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'ProductSpec', department_id: 'D06', produced_by: 'pivot.head',
      quality: 'draft',
      body: {
        version_label: 'v1', one_liner: 'x', icp: 'y', venture_kind: 'saas', geography: 'US',
        features: [{ id: 'f1', user_story: 'as a user', acceptance_criteria: ['works'], priority: 'p0', justified_by: [] }],
        stack: { hosting: 'render', payments_rail: 'stripe' },
        qa_scenarios: ['a', 'b', 'c'],
        pricing: { model: 'flat', amount_usd: 49, interval: 'month' },
      } as any,
    })).rejects.toThrow(/justif/i);
  });

  it('enforces artifact ownership by department', async () => {
    const v = await venture(k);
    await expect(k.artifacts.create({
      venture_id: v.venture_id, type: 'NicheDossier', body: {} as any,
      produced_by: 'sales.head', department_id: 'D10', quality: 'draft',
    })).rejects.toThrow(/owned by D03/);
  });
});

describe('gates', () => {
  let k: Kernel;
  beforeEach(async () => { k = await freshKernel(); });

  const req = (venture_id: string, over: Partial<any> = {}) => ({
    venture_id, gate_type: 'money_out', requested_by: 'finance.head', department_id: 'D11',
    action: { tool: 'stripe.create_payment_link', args: { amount: 49 } },
    preview: { summary: 'charge $49' },
    options: [{ id: 'approve', label: 'Approve', consequence: 'card is charged' },
              { id: 'deny', label: 'Deny', consequence: 'nothing happens' }],
    amount_usd: 49, idempotency_key: `k-${Math.random()}`, trace_id: 't', ...over,
  });

  it('never auto-approves money_out, even when autonomous', async () => {
    const v = await venture(k, 'autonomous');
    const g = await k.gates.open(req(v.venture_id, { risk: 'low', reversible: true }) as any);
    expect(g.status).toBe('pending');
  });

  it('runs the side effect exactly once on approval', async () => {
    const v = await venture(k);
    let runs = 0;
    k.gates.onApprove('money_out', async () => { runs++; });
    const g = await k.gates.open(req(v.venture_id) as any);
    await k.gates.decide(g.id, { option_id: 'approve', decided_by: 'founder', decision: 'approve', note: '' });
    await expect(k.gates.decide(g.id, { option_id: 'approve', decided_by: 'founder', decision: 'approve', note: '' }))
      .rejects.toThrow(/already_decided|is approved/);
    expect(runs).toBe(1);
  });

  it('does not run the side effect on rejection', async () => {
    const v = await venture(k);
    let runs = 0;
    k.gates.onApprove('money_out', async () => { runs++; });
    const g = await k.gates.open(req(v.venture_id) as any);
    await k.gates.decide(g.id, { option_id: 'deny', decided_by: 'founder', decision: 'reject', note: 'too soon' });
    expect(runs).toBe(0);
  });

  it('is idempotent on the same idempotency_key', async () => {
    const v = await venture(k);
    const r = req(v.venture_id, { idempotency_key: 'fixed' });
    const a = await k.gates.open(r as any);
    const b = await k.gates.open(r as any);
    expect(b.id).toBe(a.id);
  });

  it('auto-approves a low-risk reversible deploy when supervised', async () => {
    const v = await venture(k);
    let ran = false;
    k.gates.onApprove('deploy', async () => { ran = true; });
    const g = await k.gates.open(req(v.venture_id, {
      gate_type: 'deploy', department_id: 'D07', risk: 'low', reversible: true, amount_usd: undefined,
    }) as any);
    expect(g.status).toBe('auto_approved');
    expect(ran).toBe(true);
  });

  it('approves nothing automatically in copilot mode', async () => {
    const v = await venture(k, 'copilot');
    const g = await k.gates.open(req(v.venture_id, {
      gate_type: 'deploy', department_id: 'D07', risk: 'low', reversible: true,
    }) as any);
    expect(g.status).toBe('pending');
  });

  it('rejects an option the gate never offered', async () => {
    const v = await venture(k);
    const g = await k.gates.open(req(v.venture_id) as any);
    await expect(k.gates.decide(g.id, { option_id: 'ship_it', decided_by: 'f', decision: 'approve', note: '' }))
      .rejects.toThrow(/unknown_option|not offered/);
  });

  it('notifies the founder when a gate uses the Linq channel', async () => {
    const v = await venture(k);
    const g = await k.gates.open(req(v.venture_id, { channel: 'linq' }) as any);
    const notices = await k.events.readStream(v.venture_id, { types: ['human.notified'] });
    expect(g.status).toBe('pending');
    expect(notices).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({ channel: 'linq', gate_id: g.id, delivered: false }),
    }));
  });
});

describe('budget meter', () => {
  let k: Kernel;
  beforeEach(async () => { k = await freshKernel(); });

  it('degrades the model tier at 80% of envelope', async () => {
    const v = await venture(k);
    // 26 cap / 13 depts = $2 envelope, $4 hard cap.
    await k.meter.record({ venture_id: v.venture_id, department_id: 'D03', unit: 'tool_call', resource: 'x', quantity: 850 });
    const [d03] = (await k.meter.budgets(v.venture_id)).filter((b) => b.department_id === 'D03');
    expect(d03.state).toBe('degraded');
    expect(await k.meter.effectiveTier(v.venture_id, 'D03', 'opus')).toBe('sonnet');
    const evs = await k.events.readStream(v.venture_id, { types: ['money.budget_degraded'] });
    expect(evs.length).toBe(1);
  });

  it('freezes a department at its hard cap and refuses new reservations', async () => {
    const v = await venture(k);
    await k.meter.record({ venture_id: v.venture_id, department_id: 'D03', unit: 'tool_call', resource: 'x', quantity: 2100 });
    const [d03] = (await k.meter.budgets(v.venture_id)).filter((b) => b.department_id === 'D03');
    expect(d03.state).toBe('frozen');
    await expect(k.meter.reserve(v.venture_id, 'D03', 0.5)).rejects.toThrow(/frozen/);
  });

  it('refuses a reservation that would exceed the hard cap', async () => {
    const v = await venture(k);
    await expect(k.meter.reserve(v.venture_id, 'D03', 99)).rejects.toThrow(/exceed|budget/i);
  });

  it('releases a reservation back to the envelope', async () => {
    const v = await venture(k);
    const id = await k.meter.reserve(v.venture_id, 'D03', 1);
    expect((await k.meter.budgets(v.venture_id)).find((b) => b.department_id === 'D03')!.reserved_usd).toBe(1);
    await k.meter.release(id);
    expect((await k.meter.budgets(v.venture_id)).find((b) => b.department_id === 'D03')!.reserved_usd).toBe(0);
  });

  it('prices tokens by tier', async () => {
    const v = await venture(k);
    const cost = await k.meter.recordTokens({
      venture_id: v.venture_id, department_id: 'D02', tier: 'sonnet',
      resource: 'claude-sonnet', tokens_in: 1_000_000, tokens_out: 0,
    });
    expect(cost).toBeCloseTo(3, 5);
  });
});

describe('projections and routing', () => {
  it('flips liveness and fans out work orders when SharpenedIdea is signed', async () => {
    const routing = [{
      id: 'sharpened_fanout',
      when: { event: 'artifact.signed', artifact_type: 'SharpenedIdea', min_count: 1, all_signed: [], once: true },
      emit: [
        { work_order: { to: 'D03', intent: 'research_niches', budget_usd: 1, params: {} } },
        { work_order: { to: 'D05', intent: 'build_panel', budget_usd: 0.5, params: {} } },
      ],
    }];
    const k = await freshKernel(routing);
    const v = await venture(k);

    const body = {
      one_liner: 'Recall reminders for small dental clinics',
      icp: { role: 'office manager', org_type: 'dental clinic', trigger: 'no-show spike', named_examples: ['X'], disqualifiers: [] },
      pain: { statement: 'no-shows', frequency: 'weekly', cost_today: { value: 1200, unit: 'usd/mo', basis: 'chair-hour rate' }, status_quo: 'manual calls' },
      wedge: { description: 'sms recalls', ships_in_hours: 8 },
      what_must_be_true: [
        { id: 'w1', statement: 'clinics will pay', test: 'interviews', tester: 'D04', blocking: true },
        { id: 'w2', statement: 'sms deliverable', test: 'pilot', tester: 'D07', blocking: false },
        { id: 'w3', statement: 'reachable', test: 'list build', tester: 'D09', blocking: false },
        { id: 'w4', statement: 'no compliance block', test: 'research', tester: 'D03', blocking: true },
      ],
      kill_criteria: [
        { statement: 'no paid pilot', measured_by: 'stripe', deadline: '2026-09-01' },
        { statement: 'CAC > LTV', measured_by: 'finance', deadline: '2026-09-01' },
        { statement: 'zero replies', measured_by: 'sales', deadline: '2026-09-01' },
      ],
      alternatives_considered: [{ option: 'full PMS', why_not: 'too big' }, { option: 'consulting', why_not: 'not scalable' }],
      open_assumptions: [], premises: [],
    };
    const a = await k.artifacts.create({
      venture_id: v.venture_id, type: 'SharpenedIdea', body: body as any,
      produced_by: 'officehours.partner', department_id: 'D02', quality: 'signed',
    });
    await k.events.append({
      venture_id: v.venture_id, type: 'artifact.signed', actor_id: 'officehours.partner', department_id: 'D02',
      payload: { artifact: { type: 'SharpenedIdea', id: a.id, version: a.version, hash: a.body_hash }, quality: 'signed', cost_usd: 0 },
      trace_id: v.trace_id,
    });
    await new Promise((r) => setTimeout(r, 120));

    const proj = await k.venture(v.venture_id);
    expect(proj.liveness.idea_locked).toBe(true);

    const wos = await k.db.query('SELECT to_dept, intent FROM work_orders WHERE venture_id = $1', [v.venture_id]);
    const depts = wos.rows.map((r: any) => r.to_dept);
    expect(depts).toContain('D03');
    expect(depts).toContain('D05');

    const milestones = await k.events.readStream(v.venture_id, { types: ['venture.milestone_reached'] });
    expect(milestones.map((m) => m.payload.milestone)).toContain('idea_locked');
  });

  it('does not route while the kill switch is engaged', async () => {
    const routing = [{
      id: 'r1', when: { event: 'build.deployed', min_count: 1, all_signed: [], once: false },
      emit: [{ work_order: { to: 'D09', intent: 'build_lead_lists', budget_usd: 1, params: {} } }],
    }];
    const k = await freshKernel(routing);
    const v = await venture(k);
    await k.killSwitch(v.venture_id, true);
    await expect(k.events.append({
      venture_id: v.venture_id, type: 'build.deployed', actor_id: 'build.head', trace_id: v.trace_id,
      payload: { url: 'https://x', commit_sha: 'abc', environment: 'production' },
    })).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 80));
    const wos = await k.db.query(`SELECT * FROM work_orders WHERE venture_id = $1 AND to_dept = 'D09'`, [v.venture_id]);
    expect(wos.rows).toHaveLength(0);
  });

  it('routes the 7am daily briefing trigger to D13', async () => {
    const routing = [{
      id: 'daily_0700_to_executive_briefing',
      when: { event: 'ops.daily_briefing_started', min_count: 1, all_signed: [], once: false },
      emit: [{ work_order: { to: 'D13', intent: 'run_daily_executive_briefing', budget_usd: 2, params: { cadence: 'daily_0700', band_room: 'executive-briefing' } } }],
    }];
    const k = await freshKernel(routing);
    const v = await venture(k);
    await k.events.append({
      venture_id: v.venture_id,
      type: 'ops.daily_briefing_started',
      actor_id: 'system.cron',
      department_id: 'D13',
      trace_id: v.trace_id,
      payload: { meeting_date: '2026-08-15' },
    });
    await new Promise((r) => setTimeout(r, 80));

    const wos = await k.db.query(`SELECT to_dept, intent, params FROM work_orders WHERE venture_id = $1 AND to_dept = 'D13'`, [v.venture_id]);
    expect(wos.rows).toHaveLength(1);
    expect(wos.rows[0]).toMatchObject({ to_dept: 'D13', intent: 'run_daily_executive_briefing' });
    expect(wos.rows[0].params).toMatchObject({ band_room: 'executive-briefing' });
  });
});

describe('vault', () => {
  it('stores encrypted, hands out handles, and redacts', async () => {
    const k = await freshKernel();
    await k.vault.put({ vendor: 'stripe', secret: 'sk_test_abcdef1234567890' });
    const row = await k.db.query('SELECT ciphertext FROM credentials LIMIT 1');
    expect(String(row.rows[0].ciphertext)).not.toContain('sk_test');
    const handle = await k.vault.mintHandle('stripe');
    expect(await k.vault.redeem(handle)).toBe('sk_test_abcdef1234567890');
    await expect(k.vault.redeem('vh_bogus')).rejects.toThrow(/unknown credential handle/);
    expect((await import('./vault.js')).Vault.redact('key sk_test_abcdef1234567890 here', [])).toContain('[redacted]');
  });
});

describe('http surface', () => {
  it('serves health, rejects bad auth, and creates a venture end to end', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 'tok' });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('healthy');

    const noauth = await app.inject({ method: 'GET', url: '/v1/ventures/x' });
    expect(noauth.statusCode).toBe(401);

    const created = await app.inject({
      method: 'POST', url: '/v1/ventures', headers: { authorization: 'Bearer tok' },
      payload: {
        mode: 'founder_led', name: 'Dental Recall',
        founder_profile: { display_name: 'Ada', email: 'ada@x.com', timezone: 'UTC', background: '', unfair_advantages: [], constraints: [] },
        autonomy_level: 'supervised', spend_cap_usd: 26, terac_cap_usd: 100,
      },
    });
    expect(created.statusCode).toBe(200);
    const { venture_id, first_work_order_id } = created.json();
    expect(first_work_order_id).toBeTruthy();

    const v = await app.inject({ method: 'GET', url: `/v1/ventures/${venture_id}`, headers: { authorization: 'Bearer tok' } });
    expect(v.json().status).toBe('active');

    const timeline = await app.inject({ method: 'GET', url: `/v1/ventures/${venture_id}/timeline`, headers: { authorization: 'Bearer tok' } });
    expect(timeline.json().events.map((e: any) => e.type)).toContain('venture.created');

    const briefing = await app.inject({
      method: 'POST',
      url: `/v1/ventures/${venture_id}/daily-briefing`,
      headers: { authorization: 'Bearer tok' },
      payload: { meeting_date: '2026-08-15', idempotency_key: 'daily-2026-08-15' },
    });
    expect(briefing.statusCode).toBe(201);
    expect(briefing.json().event.type).toBe('ops.daily_briefing_started');

    const phoneTransfer = await app.inject({
      method: 'POST',
      url: `/v1/ventures/${venture_id}/transfer-onboarding-to-phone`,
      headers: { authorization: 'Bearer tok' },
      payload: { step: 'office-hours', phone_e164: '+15555555555', idempotency_key: 'phone-transfer-1' },
    });
    expect(phoneTransfer.statusCode).toBe(202);
    expect(phoneTransfer.json().delivery.delivered).toBe(false);

    const budgets = await app.inject({ method: 'GET', url: `/v1/budgets/${venture_id}`, headers: { authorization: 'Bearer tok' } });
    expect(budgets.json().budgets.length).toBe(13);

    const killed = await app.inject({
      method: 'POST', url: '/v1/kill-switch', headers: { authorization: 'Bearer tok' },
      payload: { venture_id, on: true },
    });
    expect(killed.statusCode).toBe(200);
    const blocked = await app.inject({
      method: 'POST', url: '/v1/events', headers: { authorization: 'Bearer tok' },
      payload: { venture_id, type: 'agent.started', actor_id: 'x', trace_id: 't', idempotency_key: 'z' },
    });
    expect(blocked.statusCode).toBe(423);
  });

  it('maps a stripe webhook into money.revenue_received', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 'tok' });
    const v = await venture(k);
    const res = await app.inject({
      method: 'POST', url: '/v1/webhooks/stripe',
      payload: { id: 'evt_1', type: 'checkout.session.completed', venture_id: v.venture_id, data: { object: { id: 'cs_1', amount_total: 4900 } } },
    });
    expect(res.statusCode).toBe(202);
    const evs = await k.events.readStream(v.venture_id, { types: ['money.revenue_received'] });
    expect(evs[0].payload.amount_usd).toBe(49);
    const proj = await k.venture(v.venture_id);
    expect(proj.liveness.revenue_real).toBe(true);
  });

  it('accepts Stripe CLI webhook signatures using the endpoint secret', async () => {
    const old = process.env.STRIPE_WEBHOOK_SECRET;
    const secret = 'whsec_test_endpoint_secret';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 'tok' });
    const v = await venture(k);
    const raw = JSON.stringify({
      id: 'evt_signed_1',
      type: 'checkout.session.completed',
      venture_id: v.venture_id,
      data: { object: { id: 'cs_signed_1', amount_total: 2500 } },
    });
    const timestamp = '1786812000';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
      payload: raw,
    });

    expect(res.statusCode).toBe(202);
    const evs = await k.events.readStream(v.venture_id, { types: ['money.revenue_received'] });
    expect(evs[0].payload).toMatchObject({ amount_usd: 25, rail: 'stripe', external_id: 'cs_signed_1' });
    if (old === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = old;
  });

  it('maps a Linq founder reply into a gate decision', async () => {
    const k = await freshKernel();
    const app = buildServer({ kernel: k, token: 'tok' });
    const v = await venture(k);
    const gate = await k.gates.open({
      venture_id: v.venture_id,
      gate_type: 'pivot_approval',
      requested_by: 'pivot.head',
      department_id: 'D06',
      action: { tool: 'artifact.sign', args: { diff: 'narrow ICP' } },
      preview: { summary: 'Approve pivot to discharge coordinators' },
      options: [{ id: 'approve', label: 'Approve', consequence: 'ProductSpec is updated' }],
      suggested_option_id: 'approve',
      risk: 'medium',
      reversible: false,
      channel: 'linq',
      timeout_s: 900,
      on_timeout: 'hold',
      idempotency_key: 'linq-pivot-gate',
      trace_id: v.trace_id,
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/linq',
      payload: { id: 'linq_reply_1', venture_id: v.venture_id, gate_id: gate.id, from: '+15555555555', text: 'yes' },
    });

    expect(res.statusCode).toBe(202);
    expect((await k.gates.get(gate.id))?.status).toBe('approved');
  });
});
