import { GateDecision, GateRecord, GateRequest, GateStatus } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import { EventStore, KernelError } from './event-store.js';
import { nowIso, uuid } from './util.js';

export type GateExecutor = (gate: GateRecord) => Promise<void>;
export type GateNotifier = (gate: GateRecord) => Promise<{ delivered: boolean; message_id?: string; degraded?: string }>;

/**
 * The Gate Engine. Nothing irreversible happens in this company without a gate
 * row moving from `pending` to `approved`/`auto_approved` first.
 */
export class GateEngine {
  private executors = new Map<string, GateExecutor>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private events: EventStore,
    private notifyFounder?: GateNotifier,
  ) {}

  /** Registered per gate_type: what actually runs when the founder approves. */
  onApprove(gate_type: string, fn: GateExecutor): void {
    this.executors.set(gate_type, fn);
  }

  async open(req: GateRequest): Promise<GateRecord> {
    const parsed = GateRequest.parse(req);

    const existing = await this.db.query(
      'SELECT * FROM gates WHERE venture_id = $1 AND idempotency_key = $2',
      [parsed.venture_id, parsed.idempotency_key],
    );
    if (existing.rows.length > 0) return this.rowToGate(existing.rows[0]);

    const autonomy = await this.autonomyLevel(parsed.venture_id);
    const auto = this.shouldAutoApprove(parsed, autonomy);

    const id = uuid();
    const opened_at = nowIso();
    const expires_at = new Date(Date.now() + parsed.timeout_s * 1000).toISOString();
    const status: GateStatus = auto ? 'auto_approved' : 'pending';

    await this.db.query(
      `INSERT INTO gates
        (id, venture_id, gate_type, requested_by, department_id, action, preview, options,
         suggested_option_id, amount_usd, risk, reversible, status, channel, timeout_s,
         on_timeout, idempotency_key, work_order_id, trace_id, opened_at, expires_at,
         decided_by, decided_option_id, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [
        id, parsed.venture_id, parsed.gate_type, parsed.requested_by, parsed.department_id,
        JSON.stringify(parsed.action), JSON.stringify(parsed.preview), JSON.stringify(parsed.options),
        parsed.suggested_option_id ?? null, parsed.amount_usd ?? null, parsed.risk, parsed.reversible,
        status, parsed.channel, parsed.timeout_s, parsed.on_timeout, parsed.idempotency_key,
        parsed.work_order_id ?? null, parsed.trace_id, opened_at, expires_at,
        auto ? 'policy' : null, auto ? (parsed.suggested_option_id ?? parsed.options[0].id) : null,
        auto ? opened_at : null,
      ],
    );

    await this.events.append({
      venture_id: parsed.venture_id,
      type: 'gate.opened',
      actor_kind: 'system',
      actor_id: 'kernel.gates',
      department_id: parsed.department_id,
      payload: { gate_id: id, gate_type: parsed.gate_type, amount_usd: parsed.amount_usd },
      trace_id: parsed.trace_id,
      correlation_id: parsed.work_order_id,
    });

    const gate = await this.get(id);
    if (!gate) throw new KernelError('gate_missing', 'gate disappeared after insert');

    if (auto) {
      await this.events.append({
        venture_id: parsed.venture_id,
        type: 'gate.auto_approved',
        actor_kind: 'system',
        actor_id: 'kernel.gates',
        department_id: parsed.department_id,
        payload: {
          gate_id: id,
          option_id: gate.decided_option_id ?? parsed.options[0].id,
          reason: `autonomy_level=${autonomy}, risk=${parsed.risk}, reversible=${parsed.reversible}`,
        },
        trace_id: parsed.trace_id,
      });
      await this.execute(gate);
    } else if (gate.channel === 'linq') {
      await this.notifyFounderGate(gate);
    }
    return gate;
  }

  private async notifyFounderGate(gate: GateRecord): Promise<void> {
    if (!this.notifyFounder) return;
    try {
      const result = await this.notifyFounder(gate);
      await this.events.append({
        venture_id: gate.venture_id,
        type: 'human.notified',
        actor_kind: 'system',
        actor_id: 'kernel.founder-channel',
        department_id: gate.department_id,
        payload: {
          channel: 'linq',
          gate_id: gate.id,
          delivered: result.delivered,
          message_id: result.message_id,
          degraded: result.degraded,
        },
        trace_id: gate.trace_id,
        correlation_id: gate.work_order_id,
        idempotency_key: `linq_gate_notice:${gate.id}`,
      });
    } catch (error) {
      await this.events.append({
        venture_id: gate.venture_id,
        type: 'human.notified',
        actor_kind: 'system',
        actor_id: 'kernel.founder-channel',
        department_id: gate.department_id,
        payload: { channel: 'linq', gate_id: gate.id, delivered: false, degraded: error instanceof Error ? error.message : String(error) },
        trace_id: gate.trace_id,
        correlation_id: gate.work_order_id,
        idempotency_key: `linq_gate_notice:${gate.id}`,
      });
    }
  }

  /**
   * Autonomy policy. `copilot` approves nothing automatically; `autonomous`
   * auto-approves low-risk reversible actions only. Money out and outbound to a
   * real person are NEVER auto-approved, at any autonomy level.
   */
  private shouldAutoApprove(req: GateRequest, autonomy: string): boolean {
    const never = ['money_out', 'outbound_to_real_person', 'refund', 'account_creation', 'new_department'];
    if (never.includes(req.gate_type)) return false;
    if (autonomy === 'copilot') return false;
    if (autonomy === 'supervised') return req.risk === 'low' && req.reversible;
    return req.risk !== 'high' && req.reversible; // autonomous
  }

  async decide(gate_id: string, decision: GateDecision): Promise<GateRecord> {
    const d = GateDecision.parse(decision);
    const gate = await this.get(gate_id);
    if (!gate) throw new KernelError('gate_not_found', `no gate ${gate_id}`, false, 404);
    if (gate.status !== 'pending') {
      throw new KernelError('gate_already_decided', `gate ${gate_id} is ${gate.status}`, false, 409);
    }
    if (!gate.options.some((o) => o.id === d.option_id)) {
      throw new KernelError('unknown_option', `option "${d.option_id}" is not offered by this gate`);
    }

    const status: GateStatus =
      d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'redirected';

    await this.db.query(
      `UPDATE gates SET status=$1, decided_by=$2, decided_option_id=$3, decision_note=$4, decided_at=$5
       WHERE id=$6`,
      [status, d.decided_by, d.option_id, d.note, nowIso(), gate_id],
    );

    await this.events.append({
      venture_id: gate.venture_id,
      type: d.decision === 'approve' ? 'gate.approved' : d.decision === 'reject' ? 'gate.rejected' : 'gate.redirected',
      actor_kind: 'founder',
      actor_id: d.decided_by,
      department_id: gate.department_id,
      payload:
        d.decision === 'approve'
          ? { gate_id, option_id: d.option_id, decided_by: d.decided_by }
          : d.decision === 'reject'
            ? { gate_id, decided_by: d.decided_by, note: d.note }
            : { gate_id, note: d.note },
      trace_id: gate.trace_id,
      correlation_id: gate.work_order_id,
    });

    const updated = (await this.get(gate_id))!;
    if (status === 'approved') await this.execute(updated);
    return updated;
  }

  /** Runs the registered side effect exactly once, after approval. */
  private async execute(gate: GateRecord): Promise<void> {
    const fn = this.executors.get(gate.gate_type);
    if (!fn) return;
    const key = `gate_exec:${gate.id}`;
    const seen = await this.db.query(
      'SELECT 1 FROM processed_messages WHERE consumer = $1 AND message_id = $2',
      ['gate_engine', key],
    );
    if (seen.rows.length > 0) return;
    await this.db.query(
      'INSERT INTO processed_messages (consumer, message_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      ['gate_engine', key],
    );
    await fn(gate);
  }

  /** Expire pending gates whose deadline passed, applying their on_timeout policy. */
  async sweepTimeouts(): Promise<number> {
    const r = await this.db.query(
      `SELECT * FROM gates WHERE status = 'pending' AND expires_at < now()`,
    );
    for (const row of r.rows) {
      const gate = this.rowToGate(row);
      const status: GateStatus =
        gate.on_timeout === 'auto_approve' ? 'approved'
        : gate.on_timeout === 'auto_reject' ? 'rejected'
        : 'timed_out';
      await this.db.query(
        `UPDATE gates SET status=$1, decided_by='timeout', decided_at=$2 WHERE id=$3`,
        [status, nowIso(), gate.id],
      );
      await this.events.append({
        venture_id: gate.venture_id,
        type: 'gate.timed_out',
        actor_kind: 'system',
        actor_id: 'kernel.gates',
        payload: { gate_id: gate.id, on_timeout: gate.on_timeout },
        trace_id: gate.trace_id,
      });
      if (status === 'approved') await this.execute({ ...gate, status });
    }
    return r.rows.length;
  }

  startSweeper(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweepTimeouts().catch(() => undefined);
    }, intervalMs);
    this.timer.unref?.();
  }

  stopSweeper(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async get(id: string): Promise<GateRecord | null> {
    const r = await this.db.query('SELECT * FROM gates WHERE id = $1', [id]);
    return r.rows.length ? this.rowToGate(r.rows[0]) : null;
  }

  async list(venture_id: string, status?: string): Promise<GateRecord[]> {
    const params: unknown[] = [venture_id];
    let sql = 'SELECT * FROM gates WHERE venture_id = $1';
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY opened_at DESC';
    const r = await this.db.query(sql, params);
    return r.rows.map((row: any) => this.rowToGate(row));
  }

  private async autonomyLevel(venture_id: string): Promise<string> {
    const r = await this.db.query<{ autonomy_level: string }>(
      'SELECT autonomy_level FROM ventures WHERE id = $1',
      [venture_id],
    );
    return r.rows[0]?.autonomy_level ?? 'supervised';
  }

  private rowToGate(r: any): GateRecord {
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
    return {
      id: r.id,
      venture_id: r.venture_id,
      gate_type: r.gate_type,
      requested_by: r.requested_by,
      department_id: r.department_id,
      action: j(r.action),
      preview: j(r.preview) ?? {},
      options: j(r.options) ?? [],
      suggested_option_id: r.suggested_option_id ?? undefined,
      amount_usd: r.amount_usd !== null && r.amount_usd !== undefined ? Number(r.amount_usd) : undefined,
      risk: r.risk,
      reversible: r.reversible,
      status: r.status,
      channel: r.channel ?? 'boardroom',
      timeout_s: Number(r.timeout_s),
      on_timeout: r.on_timeout,
      idempotency_key: r.idempotency_key,
      work_order_id: r.work_order_id ?? undefined,
      trace_id: r.trace_id,
      decided_by: r.decided_by ?? undefined,
      decided_option_id: r.decided_option_id ?? undefined,
      decision_note: r.decision_note ?? undefined,
      opened_at: r.opened_at instanceof Date ? r.opened_at.toISOString() : String(r.opened_at),
      expires_at: r.expires_at instanceof Date ? r.expires_at.toISOString() : String(r.expires_at),
      decided_at: r.decided_at ? (r.decided_at instanceof Date ? r.decided_at.toISOString() : String(r.decided_at)) : undefined,
    } as GateRecord;
  }
}
