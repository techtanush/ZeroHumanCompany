import type { RoutingRule, RoutingTable } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import { EventStore, StoredEvent } from './event-store.js';
import type { GateEngine } from './gates.js';
import { nowIso, uuid } from './util.js';

export interface EnqueuedWorkOrder {
  id: string;
  venture_id: string;
  to_dept: string;
  intent: string;
  budget_usd: number;
}

export type WorkOrderSink = (wo: EnqueuedWorkOrder) => void;

/**
 * The routing engine is the company's nervous system: it turns "an artifact was
 * signed" into "this department has work to do", declaratively, from routing.yaml.
 */
export class Router {
  private sinks: WorkOrderSink[] = [];

  constructor(
    private db: Db,
    private events: EventStore,
    private rules: RoutingTable,
    /** Set by the Kernel so routing rules can open real approval gates. */
    private gates?: GateEngine,
  ) {}

  setGateEngine(gates: GateEngine): void {
    this.gates = gates;
  }

  onWorkOrder(fn: WorkOrderSink): void {
    this.sinks.push(fn);
  }

  setRules(rules: RoutingTable): void {
    this.rules = rules;
  }

  /** Called for every appended event, after commit. */
  async handle(e: StoredEvent): Promise<EnqueuedWorkOrder[]> {
    const out: EnqueuedWorkOrder[] = [];
    const killed = await this.isHalted(e.venture_id);
    if (killed) return out;

    for (const rule of this.rules) {
      if (!(await this.matches(rule, e))) continue;
      if (rule.when.once && (await this.alreadyFired(rule.id, e.venture_id))) continue;
      await this.markFired(rule.id, e.venture_id);

      for (const emit of rule.emit) {
        if (emit.work_order) {
          const wo = await this.issue(e, emit.work_order);
          out.push(wo);
        }
        if (emit.gate) {
          // Open a REAL gate row: a gate.opened event with no gate behind it is
          // a card the founder can never decide, which would silently stall the
          // company at exactly the moment it needs a human.
          if (!this.gates) {
            throw new Error('routing rule emits a gate but no GateEngine is wired');
          }
          await this.gates.open({
            venture_id: e.venture_id,
            gate_type: emit.gate.gate_type,
            requested_by: 'kernel.router',
            department_id: emit.gate.department_id,
            action: { tool: 'noop', args: { rule_id: rule.id } },
            preview: {
              summary: emit.gate.summary || `${emit.gate.gate_type} needs a decision`,
              candidates: await this.gateCandidates(e, emit.gate.gate_type),
            },
            options: await this.gateOptions(e, emit.gate.gate_type),
            risk: 'medium',
            reversible: true,
            channel: 'boardroom',
            timeout_s: 900,
            on_timeout: 'hold',
            idempotency_key: `route:${rule.id}:${e.venture_id}`,
            trace_id: e.trace_id,
          } as any);
        }
      }
    }
    for (const wo of out) for (const s of this.sinks) s(wo);
    return out;
  }

  private async matches(rule: RoutingRule, e: StoredEvent): Promise<boolean> {
    if (rule.when.event !== e.type) return false;

    if (rule.when.artifact_type) {
      const a = e.payload.artifact as { type?: string } | undefined;
      if (a?.type !== rule.when.artifact_type) return false;
      if (rule.when.min_count > 1) {
        const c = await this.db.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM artifacts
             WHERE venture_id = $1 AND type = $2 AND quality = 'signed'`,
          [e.venture_id, rule.when.artifact_type],
        );
        if (Number(c.rows[0]?.n ?? 0) < rule.when.min_count) return false;
      }
    }

    if (rule.when.gate_type) {
      const gate_id = e.payload.gate_id as string | undefined;
      if (!gate_id) return false;
      const g = await this.db.query<{ gate_type: string }>('SELECT gate_type FROM gates WHERE id = $1', [gate_id]);
      if (g.rows[0]?.gate_type !== rule.when.gate_type) return false;
    }

    for (const type of rule.when.all_signed) {
      const c = await this.db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM artifacts WHERE venture_id = $1 AND type = $2 AND quality = 'signed'`,
        [e.venture_id, type],
      );
      if (Number(c.rows[0]?.n ?? 0) < 1) return false;
    }
    return true;
  }

  private async issue(
    e: StoredEvent,
    spec: { to: string; intent: string; budget_usd: number; params?: Record<string, unknown> },
  ): Promise<EnqueuedWorkOrder> {
    const id = uuid();
    const artifact = e.payload.artifact ? [e.payload.artifact] : [];
    await this.db.query(
      `INSERT INTO work_orders (id, venture_id, from_dept, to_dept, intent, input_artifacts,
                                params, budget_usd, success_criteria, status, trace_id, created_at)
       VALUES ($1,$2,'kernel',$3,$4,$5,$6,$7,'[]','queued',$8,$9)`,
      [id, e.venture_id, spec.to, spec.intent, JSON.stringify(artifact),
       JSON.stringify(spec.params ?? {}), spec.budget_usd, e.trace_id, nowIso()],
    );
    await this.events.append({
      venture_id: e.venture_id,
      type: 'dept.work_order_issued',
      actor_kind: 'system',
      actor_id: 'kernel.router',
      department_id: spec.to,
      payload: { work_order_id: id, to_dept: spec.to, intent: spec.intent, budget_usd: spec.budget_usd },
      trace_id: e.trace_id,
      causation_id: e.id,
      correlation_id: id,
    });
    return { id, venture_id: e.venture_id, to_dept: spec.to, intent: spec.intent, budget_usd: spec.budget_usd };
  }

  /**
   * For a selection gate, the options ARE the candidate artifacts, so the
   * founder taps a niche rather than answering an open question.
   */
  private async gateOptions(e: StoredEvent, gate_type: string) {
    if (gate_type === 'niche_selection') {
      const r = await this.db.query<any>(
        `SELECT id, body FROM artifacts
          WHERE venture_id = $1 AND type = 'NicheDossier' AND quality = 'signed'
          ORDER BY created_at ASC`,
        [e.venture_id],
      );
      const opts = r.rows.map((row: any) => {
        const body = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
        return {
          id: row.id,
          label: String(body?.label ?? 'niche'),
          consequence: `Run discovery interviews against ${body?.label ?? 'this niche'}`,
        };
      });
      if (opts.length > 0) return opts;
    }
    return [
      { id: 'approve', label: 'Approve', consequence: 'work continues' },
      { id: 'reject', label: 'Reject', consequence: 'work stops here' },
    ];
  }

  private async gateCandidates(e: StoredEvent, gate_type: string) {
    if (gate_type !== 'niche_selection') return [];
    const r = await this.db.query<any>(
      `SELECT id, body FROM artifacts
        WHERE venture_id = $1 AND type = 'NicheDossier' AND quality = 'signed'
        ORDER BY created_at ASC`,
      [e.venture_id],
    );
    return r.rows.map((row: any) => {
      const body = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;
      return { artifact_id: row.id, label: body?.label, confidence: body?.confidence };
    });
  }

  private async isHalted(venture_id: string): Promise<boolean> {
    const r = await this.db.query<{ kill_switch: boolean; status: string }>(
      'SELECT kill_switch, status FROM ventures WHERE id = $1',
      [venture_id],
    );
    const v = r.rows[0];
    return !v || v.kill_switch === true || v.status === 'killed' || v.status === 'paused';
  }

  private async alreadyFired(rule_id: string, venture_id: string): Promise<boolean> {
    const r = await this.db.query(
      'SELECT 1 FROM processed_messages WHERE consumer = $1 AND message_id = $2',
      ['router', `${venture_id}:${rule_id}`],
    );
    return r.rows.length > 0;
  }

  private async markFired(rule_id: string, venture_id: string): Promise<void> {
    await this.db.query(
      'INSERT INTO processed_messages (consumer, message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      ['router', `${venture_id}:${rule_id}`],
    );
  }
}
