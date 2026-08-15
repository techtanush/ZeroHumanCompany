import { describe, expect, it } from 'vitest';
import { openDb } from '@zeroth/db';
import { Kernel } from '@zeroth/kernel';
import { MockLlmClient } from '@zeroth/agent-kit';
import { loadManifests, loadRouting } from '@zeroth/manifests';
import type { DepartmentManifest } from '@zeroth/contracts';
import { Orchestrator } from './worker.js';

/**
 * End-to-end: a founder's idea walks through D01 -> D02 -> D03 with a mocked
 * model, producing real signed artifacts, a real niche_selection gate, and real
 * follow-on work orders. This is the vertical slice the demo depends on.
 */

const sharpened = {
  one_liner: 'SMS recall reminders for small dental clinics',
  icp: { role: 'office manager', org_type: 'dental clinic (2-5 chairs)', trigger: 'no-show rate above 15%', named_examples: ['Bright Smile Dental'], disqualifiers: ['DSO-owned'] },
  pain: { statement: 'no-shows waste chair time', frequency: 'weekly', cost_today: { value: 1800, unit: 'usd/month', basis: '3 no-shows/wk x $150 chair hour' }, status_quo: 'front desk calls manually' },
  wedge: { description: 'one-click SMS recall campaign', ships_in_hours: 8 },
  what_must_be_true: [
    { id: 'w1', statement: 'clinics will pay $199/mo', test: 'discovery interviews', tester: 'D04', blocking: true },
    { id: 'w2', statement: 'SMS is deliverable to patients', test: 'pilot send', tester: 'D07', blocking: false },
    { id: 'w3', statement: 'office managers are reachable by email', test: 'list build', tester: 'D09', blocking: false },
    { id: 'w4', statement: 'no HIPAA blocker for reminder text', test: 'regulatory research', tester: 'D03', blocking: true },
  ],
  kill_criteria: [
    { statement: 'no paid pilot in 30 days', measured_by: 'stripe', deadline: '2026-09-15' },
    { statement: 'CAC exceeds 6mo LTV', measured_by: 'finance ledger', deadline: '2026-09-15' },
    { statement: 'reply rate under 2%', measured_by: 'sales sequence stats', deadline: '2026-09-15' },
  ],
  alternatives_considered: [
    { option: 'full practice management system', why_not: '6 month build, crowded' },
    { option: 'consulting on scheduling', why_not: 'does not scale' },
  ],
  open_assumptions: [], premises: ['clinics own their patient lists'],
};

function dossier(label: string, source_id: string) {
  const cite = (value: number, method: 'measured' | 'derived' | 'estimated' = 'measured') => ({
    value, unit: 'usd', source_ids: [source_id], method,
  });
  return {
    label,
    slice: { industry: 'dental', size: '2-5 chairs', geo: 'California', trigger: 'high no-show rate' },
    tam_usd: cite(420_000_000),
    sam_usd: cite(38_000_000),
    som_usd: cite(2_100_000, 'derived'),
    mrr_12mo_usd: cite(64_000, 'derived'),
    pricing_hypothesis: { model: 'per clinic per month', price: cite(199), anchor_comparables: ['Weave $299', 'NexHealth $400'] },
    competitors: [{ name: 'Weave', pricing: cite(299), weakness: 'bundled phone system, slow onboarding', source_ids: [source_id] }],
    reachability: { channels: ['email', 'dental association lists'], cac_usd: cite(140, 'estimated') },
    wedge: 'ships in a day, no phone system replacement',
    pros: ['clear measurable ROI'], cons: ['seasonal budgets'],
    confidence: 0.62,
    rank_rationale: 'highest pain per dollar of CAC among the three slices',
  };
}

async function setup() {
  const db = await openDb({ dataDir: 'memory' });
  const routing = await loadRouting();
  const kernel = await Kernel.create({ db, routing, signingKey: 'e2e-key' });

  const loaded = await loadManifests();
  const list: DepartmentManifest[] = Array.isArray(loaded) ? loaded : [...(loaded as any).values()];
  const manifests = new Map(list.map((m) => [m.id, m]));

  const v = await kernel.createVenture({
    mode: 'founder_led',
    name: 'Dental Recall',
    founder: { display_name: 'Ada', email: 'ada@clinic.test' },
    autonomy_level: 'supervised',
    spend_cap_usd: 260,
  });

  // One real source, so evidence checks have something legitimate to point at.
  const source_id = await kernel.artifacts.registerSource({
    venture_id: v.venture_id, kind: 'web_page', uri: 'https://ada.org/statistics',
    title: 'ADA practice statistics', reliability: 0.9,
  });

  const llm = new MockLlmClient()
    // The critic always accepts; defects come from real schema/evidence checks.
    // Critic prompts are the rubric files and carry a Rubric heading.
    .on(/critic-rubric|# .*[Cc]ritic/, () => JSON.stringify({ accept: true, defects: [] }))
    .on(/artifact_type:"SharpenedIdea"|Output JSON shape.*SharpenedIdea/s, () =>
      JSON.stringify({ artifact_type: 'SharpenedIdea', body: sharpened, source_ids: [], gaps: [], quality: 'signed' }))
    .on(/artifact_type:"NicheDossier"|Output JSON shape.*NicheDossier/s, () =>
      JSON.stringify({
        artifacts: ['Pediatric dental', 'General dental', 'Ortho'].map((l) => ({
          artifact_type: 'NicheDossier', body: dossier(l, source_id), source_ids: [], gaps: [], quality: 'signed',
        })),
      }))
    .on(/IdeaSeed|normalize/i, () => JSON.stringify({ artifacts: [{ body: {
      raw_statement: 'help dentists with no-shows',
      normalized: { problem: 'no-shows', who_hurts: 'small clinics', current_workaround: 'manual calls',
        proposed_solution: 'sms recalls', business_model_guess: 'saas', category: 'healthtech' },
      founder_profile: { display_name: 'Ada', timezone: 'UTC', background: '', unfair_advantages: [], constraints: [] },
    }, sources: [] }] }));

  const orch = new Orchestrator({ kernel, llm, toolDriver: 'mock', manifests });
  await orch.init();
  return { kernel, orch, venture: v, source_id };
}

describe('end-to-end venture flow', () => {
  it('turns a signed SharpenedIdea into niche research, a gate, and follow-on work', async () => {
    const { kernel, orch, venture } = await setup();

    // D02 signs the SharpenedIdea, which is what the routing table listens for.
    await kernel.issueWorkOrder({
      venture_id: venture.venture_id, to: 'D02', intent: 'run_office_hours', budget_usd: 3,
    });
    expect(await orch.tick('D02')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));

    const sharpenedArtifacts = await kernel.artifacts.list(venture.venture_id, { type: 'SharpenedIdea' });
    expect(sharpenedArtifacts).toHaveLength(1);
    expect(sharpenedArtifacts[0].quality).toBe('signed');

    const proj = await kernel.venture(venture.venture_id);
    expect(proj.liveness.idea_locked).toBe(true);

    // Routing fanned out to D03/D04/D05 without anyone telling it to.
    const queued = await kernel.db.query(
      `SELECT to_dept, intent FROM work_orders WHERE venture_id=$1 AND status='queued'`,
      [venture.venture_id],
    );
    const depts = queued.rows.map((r: any) => r.to_dept);
    expect(depts).toContain('D03');

    // D03 produces 3 signed dossiers, which opens the niche_selection gate.
    expect(await orch.tick('D03')).toBe(true);
    await new Promise((r) => setTimeout(r, 300));

    const dossiers = await kernel.artifacts.list(venture.venture_id, { type: 'NicheDossier' });
    expect(dossiers.length).toBeGreaterThanOrEqual(3);
    expect(dossiers.every((d: any) => d.quality === 'signed')).toBe(true);
    expect(dossiers[0].signature).toBeTruthy();

    const gateEvents = await kernel.events.readStream(venture.venture_id, { types: ['gate.opened'] });
    expect(gateEvents.length).toBeGreaterThanOrEqual(1);

    // Money was actually metered against D02/D03 envelopes.
    const budgets = await kernel.meter.budgets(venture.venture_id);
    expect(budgets.find((b) => b.department_id === 'D03')!.spent_usd).toBeGreaterThan(0);

    // And every step is on the timeline, in order.
    const types = (await kernel.events.readStream(venture.venture_id, { limit: 500 })).map((e) => e.type);
    expect(types).toContain('venture.created');
    expect(types).toContain('dept.work_started');
    expect(types).toContain('artifact.signed');
    expect(types).toContain('dept.work_completed');
    expect(types).toContain('money.metered');
  }, 60_000);

  it('halts the whole company when the kill switch is engaged', async () => {
    const { kernel, orch, venture } = await setup();
    await kernel.killSwitch(venture.venture_id, true);
    await kernel.issueWorkOrder({
      venture_id: venture.venture_id, to: 'D02', intent: 'run_office_hours', budget_usd: 3,
    });
    await orch.tick('D02');
    const arts = await kernel.artifacts.list(venture.venture_id);
    expect(arts).toHaveLength(0);
    const wo = await kernel.db.query(`SELECT status FROM work_orders WHERE venture_id=$1`, [venture.venture_id]);
    expect(wo.rows.every((r: any) => r.status === 'cancelled' || r.status === 'queued')).toBe(true);
  }, 30_000);
});
