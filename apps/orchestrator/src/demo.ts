/**
 * Boots the real kernel HTTP server, creates a venture over HTTP, runs the
 * orchestrator until the queue drains, and prints the timeline.
 *
 *   pnpm demo
 *
 * Runs with zero API keys: mock LLM + mock tool drivers.
 */
import { openDb } from '@zeroth/db';
import { Kernel, buildServer } from '@zeroth/kernel';
import { MockLlmClient } from '@zeroth/agent-kit';
import { loadManifests, loadRouting } from '@zeroth/manifests';
import { Orchestrator } from './worker.js';

const TOKEN = process.env.KERNEL_SHARED_TOKEN ?? 'dev-only-token';
const PORT = Number(process.env.PORT ?? 4010);

const sharpened = {
  one_liner: 'SMS recall reminders for small dental clinics',
  icp: { role: 'office manager', org_type: 'dental clinic (2-5 chairs)', trigger: 'no-show rate above 15%', named_examples: ['Bright Smile Dental'], disqualifiers: ['DSO-owned'] },
  pain: { statement: 'no-shows waste chair time', frequency: 'weekly', cost_today: { value: 1800, unit: 'usd/month', basis: '3 no-shows/wk x $150 chair hour' }, status_quo: 'front desk calls manually' },
  wedge: { description: 'one-click SMS recall campaign', ships_in_hours: 8 },
  what_must_be_true: [
    { id: 'w1', statement: 'clinics will pay $199/mo', test: 'discovery interviews', tester: 'D04', blocking: true },
    { id: 'w2', statement: 'SMS is deliverable', test: 'pilot send', tester: 'D07', blocking: false },
    { id: 'w3', statement: 'office managers reachable by email', test: 'list build', tester: 'D09', blocking: false },
    { id: 'w4', statement: 'no HIPAA blocker', test: 'regulatory research', tester: 'D03', blocking: true },
  ],
  kill_criteria: [
    { statement: 'no paid pilot in 30 days', measured_by: 'stripe', deadline: '2026-09-15' },
    { statement: 'CAC exceeds 6mo LTV', measured_by: 'finance ledger', deadline: '2026-09-15' },
    { statement: 'reply rate under 2%', measured_by: 'sequence stats', deadline: '2026-09-15' },
  ],
  alternatives_considered: [
    { option: 'full practice management system', why_not: '6 month build' },
    { option: 'scheduling consulting', why_not: 'does not scale' },
  ],
  open_assumptions: [], premises: ['clinics own their patient lists'],
};

function dossier(label: string, source_id: string) {
  const cite = (value: number, method: 'measured' | 'derived' | 'estimated' = 'measured') =>
    ({ value, unit: 'usd', source_ids: [source_id], method });
  return {
    label,
    slice: { industry: 'dental', size: '2-5 chairs', geo: 'California', trigger: 'high no-show rate' },
    tam_usd: cite(420_000_000), sam_usd: cite(38_000_000), som_usd: cite(2_100_000, 'derived'),
    mrr_12mo_usd: cite(64_000, 'derived'),
    pricing_hypothesis: { model: 'per clinic per month', price: cite(199), anchor_comparables: ['Weave $299'] },
    competitors: [{ name: 'Weave', pricing: cite(299), weakness: 'slow onboarding', source_ids: [source_id] }],
    reachability: { channels: ['email'], cac_usd: cite(140, 'estimated') },
    wedge: 'ships in a day', pros: ['measurable ROI'], cons: ['seasonal budgets'],
    confidence: 0.62, rank_rationale: 'highest pain per dollar of CAC',
  };
}

async function main() {
  const db = await openDb({ dataDir: 'memory' });
  const kernel = await Kernel.create({ db, routing: await loadRouting(), signingKey: 'demo-key' });
  const app = buildServer({ kernel, token: TOKEN });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`kernel listening on :${PORT} (db=${kernel.db.driver})\n`);

  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    return res.json() as Promise<any>;
  };

  console.log('health:', await (await fetch(`http://127.0.0.1:${PORT}/health`)).json());

  const created = await api('/v1/ventures', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'founder_led',
      name: 'Dental Recall',
      founder_profile: { display_name: 'Ada', email: 'ada@clinic.test', timezone: 'UTC', background: '', unfair_advantages: [], constraints: [] },
      autonomy_level: 'supervised',
      spend_cap_usd: 260,
      terac_cap_usd: 100,
    }),
  });
  console.log('venture created:', created.venture_id);

  const source_id = await kernel.artifacts.registerSource({
    venture_id: created.venture_id, kind: 'web_page', uri: 'https://ada.org/statistics',
    title: 'ADA practice statistics', reliability: 0.9,
  });

  const llm = new MockLlmClient()
    .on(/critic-rubric|# .*[Cc]ritic/, () => JSON.stringify({ accept: true, defects: [] }))
    .on(/Output JSON shape.*SharpenedIdea/s, () =>
      JSON.stringify({ artifact_type: 'SharpenedIdea', body: sharpened, source_ids: [], gaps: [], quality: 'signed' }))
    .on(/Output JSON shape.*NicheDossier/s, () =>
      JSON.stringify({ artifacts: ['Pediatric', 'General', 'Ortho'].map((l) => ({
        artifact_type: 'NicheDossier', body: dossier(l, source_id), source_ids: [], gaps: [], quality: 'signed',
      })) }));

  const loaded: any = await loadManifests();
  const list = Array.isArray(loaded) ? loaded : [...loaded.values()];
  const orch = new Orchestrator({ kernel, llm, toolDriver: 'mock', manifests: new Map(list.map((m: any) => [m.id, m])) });
  await orch.init();

  await api('/v1/work-orders', {
    method: 'POST',
    body: JSON.stringify({ venture_id: created.venture_id, to: 'D02', intent: 'run_office_hours', budget_usd: 3 }),
  });

  // Drain the queue: each completed work order routes new ones.
  for (let i = 0; i < 12; i++) {
    const did = await orch.tick();
    if (!did) { await new Promise((r) => setTimeout(r, 250)); if (!(await orch.tick())) break; }
    await new Promise((r) => setTimeout(r, 150));
  }

  const timeline = await api(`/v1/ventures/${created.venture_id}/timeline?limit=500`);
  console.log('\n─── timeline ───');
  for (const e of timeline.events) {
    if (e.type === 'money.metered') continue;
    console.log(`  ${String(e.seq).padStart(3)}  ${e.type.padEnd(26)} ${e.department_id ?? ''}`);
  }

  const arts = await api(`/v1/ventures/${created.venture_id}/artifacts`);
  console.log('\n─── artifacts ───');
  for (const a of arts.artifacts) console.log(`  ${a.type.padEnd(18)} v${a.version}  ${a.quality}  signed=${Boolean(a.signature)}`);

  const gates = await api(`/v1/gates?venture_id=${created.venture_id}`);
  console.log('\n─── gates ───');
  for (const g of gates.gates) {
    console.log(`  ${g.gate_type.padEnd(20)} ${g.status}`);
    for (const o of g.options) console.log(`      [${o.id.slice(0, 8)}] ${o.label} — ${o.consequence}`);
  }

  // The founder taps one option; that decision must unblock the next department.
  const pending = gates.gates.find((g: any) => g.status === 'pending');
  if (pending) {
    const choice = pending.options[0];
    console.log(`\nfounder approves: ${choice.label}`);
    await api(`/v1/gates/${pending.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ option_id: choice.id, decided_by: 'founder', decision: 'approve', note: '' }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const after = await api(`/v1/ventures/${created.venture_id}/work-orders`);
    const unblocked = after.work_orders.filter((w: any) => w.intent === 'run_discovery_interviews');
    console.log(`work orders unblocked by the decision: ${unblocked.length} (${unblocked.map((w: any) => w.to_dept).join(', ')})`);
  }

  const v = await api(`/v1/ventures/${created.venture_id}`);
  console.log('\nliveness:', v.liveness);
  console.log('spend_usd:', Number(v.spend_usd).toFixed(4));

  await app.close();
  await kernel.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
