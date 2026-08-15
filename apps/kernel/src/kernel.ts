import type { RoutingTable } from '@zeroth/contracts';
import { openDb, type Db } from '@zeroth/db';
import { ArtifactRegistry } from './artifacts.js';
import { EventStore, KernelError, type StoredEvent } from './event-store.js';
import { GateEngine } from './gates.js';
import { notifyFounderByLinq } from './founder-channel.js';
import { Meter } from './meter.js';
import { reduce, ventureProjection } from './projections.js';
import { Router } from './routing.js';
import { Vault } from './vault.js';
import { SettingsStore } from './settings.js';
import { Insight } from './insight.js';
import { CompanyClock } from './scheduler.js';
import { VoiceService } from './voice.js';
import { Wallets } from './wallets.js';
import { nowIso, slugify, uuid } from './util.js';

export interface KernelOptions {
  db?: Db;
  databaseUrl?: string;
  signingKey?: string;
  routing?: RoutingTable;
  /** Default per-department budget envelope used when a venture is created. */
  defaultEnvelopeUsd?: number;
  /** Start the company clock (meetings/workday/improvement). Off in tests unless asked. */
  clock?: boolean;
}

/**
 * The Kernel: event store + artifact registry + gates + meter + router + vault.
 * Everything else in the company is a client of this object.
 */
export class Kernel {
  readonly db: Db;
  readonly events: EventStore;
  readonly artifacts: ArtifactRegistry;
  readonly gates: GateEngine;
  readonly meter: Meter;
  readonly router: Router;
  readonly vault: Vault;
  readonly settings: SettingsStore;
  readonly insight: Insight;
  readonly clock: CompanyClock;
  readonly voice: VoiceService;
  readonly wallets: Wallets;

  private constructor(db: Db, opts: KernelOptions) {
    this.db = db;
    this.events = new EventStore(db);
    this.artifacts = new ArtifactRegistry(db, opts.signingKey ?? process.env.KERNEL_SIGNING_KEY ?? 'dev-signing-key');
    this.gates = new GateEngine(db, this.events, notifyFounderByLinq);
    this.meter = new Meter(db, this.events);
    this.router = new Router(db, this.events, opts.routing ?? []);
    this.vault = new Vault(db);
    this.router.setGateEngine(this.gates);
    this.settings = new SettingsStore(db, this.events);
    this.insight = new Insight(db, this.events, this.artifacts);
    this.clock = new CompanyClock(this, db, this.events, this.settings);
    this.voice = new VoiceService(this.events, this.settings, this.gates, (v) => this.traceFor(v), () => (process.env.ZEROTH_TOOLS === 'real' ? 'real' : 'mock'));
    this.wallets = new Wallets(db, this.events, this.meter);
    if (opts.clock) this.clock.start();

    // Projections run inside the append transaction; routing runs after commit.
    this.events.addReducer(async (e, tx) => {
      const milestone = await reduce(e, tx);
      if (milestone) {
        // Emitted after commit to avoid recursive writes inside the same tx.
        queueMicrotask(() => {
          void this.events.append({
            venture_id: e.venture_id,
            type: 'venture.milestone_reached',
            actor_kind: 'system',
            actor_id: 'kernel.projections',
            payload: { milestone },
            trace_id: e.trace_id,
            causation_id: e.id,
            idempotency_key: `milestone:${e.venture_id}:${milestone}`,
          }).catch(() => undefined);
        });
      }
    });
    this.events.onEvent((e) => {
      void this.router.handle(e).catch((err) => {
        console.error('[kernel] routing failed', { type: e.type, error: String(err) });
      });
      void this.onImprovementEvents(e).catch((err) => {
        console.error('[kernel] improvement flow failed', { type: e.type, error: String(err) });
      });
    });
  }

  /**
   * Improvement branch: when D13 signs a CapabilityGap, the founder is texted
   * (Linq gate) and nothing is built until they approve. Approval issues the
   * build work order into the granted workspace.
   */
  private async onImprovementEvents(e: StoredEvent): Promise<void> {
    if (e.type === 'artifact.signed' && (e.payload as any)?.artifact?.type === 'CapabilityGap') {
      const ref = (e.payload as any).artifact;
      const art = await this.artifacts.get(ref.id);
      const body = (art?.body ?? {}) as any;
      const summary = String(body.summary ?? body.taxonomy ?? 'new capability');
      await this.gates.open({
        venture_id: e.venture_id, gate_type: 'new_department', requested_by: 'chief.head', department_id: 'D13',
        action: { tool: 'kernel.issue_work_order', args: { to: 'D07', intent: 'implement_capability', gap_artifact_id: ref.id } },
        preview: { title: 'Improvement branch found something to build', summary: `${summary} (${String(body.taxonomy ?? 'gap')}). Approve to let Build implement it in your workspace.` , gap: body },
        options: [
          { id: 'approve', label: 'Build it', consequence: 'D07 implements the capability in the granted workspace' },
          { id: 'reject', label: 'Not now', consequence: 'the gap stays logged; nothing is built' },
        ],
        suggested_option_id: 'approve', risk: 'medium', reversible: true, channel: 'linq', timeout_s: 6 * 3600, on_timeout: 'hold',
        idempotency_key: `improvement:${ref.id}`, trace_id: e.trace_id,
      } as any).catch(() => undefined);
      return;
    }
    if (e.type === 'gate.approved') {
      const gate = await this.gates.get(String((e.payload as any).gate_id));
      if (!gate || gate.gate_type !== 'new_department' || gate.action?.tool !== 'kernel.issue_work_order') return;
      const args = gate.action.args as any;
      const claimed = await this.db.query(`INSERT INTO processed_messages (consumer, message_id, result_ref) VALUES ('improvement_wo', $1, $1) ON CONFLICT DO NOTHING`, [gate.id]);
      if ((claimed as any).rowCount === 0) return; // already issued for this gate
      const s = await this.settings.get(e.venture_id);
      await this.issueWorkOrder({
        venture_id: e.venture_id, from: 'D13', to: String(args.to ?? 'D07'), intent: String(args.intent ?? 'implement_capability'), budget_usd: 6,
        input_artifacts: args.gap_artifact_id ? [{ type: 'CapabilityGap', id: args.gap_artifact_id, version: 1, hash: '' }] : [],
        params: { approved_gate_id: gate.id, workspace_root: s.workspace.workspace_root, use_replay_before_deploy: true },
        trace_id: e.trace_id,
      });
    }
  }

  static async create(opts: KernelOptions = {}): Promise<Kernel> {
    const db = opts.db ?? (await openDb({ url: opts.databaseUrl }));
    return new Kernel(db, opts);
  }

  async createVenture(input: {
    mode: 'founder_led' | 'autonomous_origination';
    name?: string;
    founder: { display_name: string; email?: string; phone_e164?: string; timezone?: string };
    autonomy_level?: 'copilot' | 'supervised' | 'autonomous';
    spend_cap_usd?: number;
    terac_cap_usd?: number;
    departments?: string[];
  }): Promise<{ venture_id: string; founder_id: string; trace_id: string; cycle_id: string }> {
    const founder_id = uuid();
    const venture_id = uuid();
    const trace_id = `v:${venture_id.slice(0, 8)}`;
    const name = input.name ?? 'Untitled Venture';
    const email = input.founder.email ?? `${slugify(input.founder.display_name)}@founder.local`;

    await this.db.query(
      `INSERT INTO founders (id, email, phone_e164, display_name, timezone, spend_cap_usd, terac_cap_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [founder_id, email, input.founder.phone_e164 ?? null, input.founder.display_name,
       input.founder.timezone ?? 'America/Los_Angeles',
       input.spend_cap_usd ?? 50, input.terac_cap_usd ?? 200],
    );
    await this.db.query(
      `INSERT INTO ventures (id, founder_id, name, slug, mode, autonomy_level, trace_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [venture_id, founder_id, name, `${slugify(name)}-${venture_id.slice(0, 6)}`,
       input.mode, input.autonomy_level ?? 'supervised', trace_id],
    );

    const depts = input.departments ?? [
      'D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','D11','D12','D13',
    ];
    for (const d of depts) {
      await this.db.query(
        `INSERT INTO departments (id, venture_id, department_id, manifest_yaml, manifest_hash, cluster)
         VALUES ($1,$2,$3,'','','unknown') ON CONFLICT DO NOTHING`,
        [uuid(), venture_id, d],
      );
    }

    const cap = input.spend_cap_usd ?? 50;
    const perDept = Number((cap / depts.length).toFixed(6));
    const cycle_id = await this.meter.openCycle(
      venture_id,
      cap,
      depts.map((d) => ({
        department_id: d,
        envelope_usd: perDept,
        hard_cap_usd: Number((perDept * 2).toFixed(6)),
        rationale: 'even initial split; Treasury reallocates after the first cycle',
      })),
    );

    await this.events.append({
      venture_id,
      type: 'venture.created',
      actor_kind: 'founder',
      actor_id: founder_id,
      payload: {
        name,
        slug: `${slugify(name)}-${venture_id.slice(0, 6)}`,
        mode: input.mode,
        autonomy_level: input.autonomy_level ?? 'supervised',
        founder_id,
      },
      trace_id,
    });

    return { venture_id, founder_id, trace_id, cycle_id };
  }

  /** Issue a work order directly (the founder or a department asking for work). */
  async issueWorkOrder(input: {
    venture_id: string;
    from?: string;
    to: string;
    intent: string;
    budget_usd: number;
    input_artifacts?: unknown[];
    params?: Record<string, unknown>;
    success_criteria?: string[];
    trace_id?: string;
  }): Promise<string> {
    const id = uuid();
    const trace_id = input.trace_id ?? (await this.traceFor(input.venture_id));
    // Every department knows the one folder the founder granted; Build depends on it.
    const params: Record<string, unknown> = { ...(input.params ?? {}) };
    if (params.workspace_root == null) {
      const s = await this.settings.get(input.venture_id).catch(() => null);
      if (s?.workspace.workspace_root) { params.workspace_root = s.workspace.workspace_root; params.agency_workspace_path = s.workspace.workspace_root; }
    }
    await this.db.query(
      `INSERT INTO work_orders (id, venture_id, from_dept, to_dept, intent, input_artifacts,
                                params, budget_usd, success_criteria, status, trace_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11)`,
      [id, input.venture_id, input.from ?? 'kernel', input.to, input.intent,
       JSON.stringify(input.input_artifacts ?? []), JSON.stringify(params),
       input.budget_usd, JSON.stringify(input.success_criteria ?? []), trace_id, nowIso()],
    );
    await this.events.append({
      venture_id: input.venture_id,
      type: 'dept.work_order_issued',
      actor_kind: 'system',
      actor_id: input.from ?? 'kernel',
      department_id: input.to,
      payload: { work_order_id: id, to_dept: input.to, intent: input.intent, budget_usd: input.budget_usd },
      trace_id,
      correlation_id: id,
    });
    return id;
  }

  async claimNextWorkOrder(dept?: string): Promise<any | null> {
    const params: unknown[] = [];
    let sql = `SELECT * FROM work_orders WHERE status = 'queued'`;
    if (dept) { params.push(dept); sql += ` AND to_dept = $${params.length}`; }
    sql += ' ORDER BY created_at ASC LIMIT 1';
    return this.db.tx(async (tx) => {
      const r = await tx.query<any>(sql, params);
      if (r.rows.length === 0) return null;
      const wo = r.rows[0];
      const upd = await tx.query(
        `UPDATE work_orders SET status='admitted' WHERE id=$1 AND status='queued'`,
        [wo.id],
      );
      if (upd.rowCount === 0) return null;
      return {
        ...wo,
        budget_usd: Number(wo.budget_usd),
        input_artifacts: typeof wo.input_artifacts === 'string' ? JSON.parse(wo.input_artifacts) : wo.input_artifacts,
        params: typeof wo.params === 'string' ? JSON.parse(wo.params) : wo.params,
        success_criteria: typeof wo.success_criteria === 'string' ? JSON.parse(wo.success_criteria) : wo.success_criteria,
      };
    });
  }

  async killSwitch(venture_id: string, on: boolean, actor = 'founder'): Promise<void> {
    await this.events.append({
      venture_id,
      type: on ? 'system.kill_switch_engaged' : 'system.kill_switch_released',
      actor_kind: 'founder',
      actor_id: actor,
      payload: {},
      trace_id: await this.traceFor(venture_id),
    });
  }

  async isHalted(venture_id: string): Promise<boolean> {
    const r = await this.db.query<{ kill_switch: boolean; status: string }>(
      'SELECT kill_switch, status FROM ventures WHERE id = $1',
      [venture_id],
    );
    const v = r.rows[0];
    return !v || v.kill_switch === true || v.status !== 'active';
  }

  async venture(venture_id: string) {
    return ventureProjection(this.db, venture_id);
  }

  async traceFor(venture_id: string): Promise<string> {
    const r = await this.db.query<{ trace_id: string }>('SELECT trace_id FROM ventures WHERE id = $1', [venture_id]);
    if (r.rows.length === 0) throw new KernelError('venture_not_found', `no venture ${venture_id}`, false, 404);
    return r.rows[0].trace_id;
  }

  async close(): Promise<void> {
    this.clock.stop();
    this.gates.stopSweeper();
    await this.db.close();
  }
}

export { KernelError, type StoredEvent };
