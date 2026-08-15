import type { Db } from '@zeroth/db';
import { EventStore, KernelError } from './event-store.js';
import { nowIso, uuid } from './util.js';

/** USD per million tokens. Overridable by env when pricing changes. */
export const MODEL_PRICES: Record<string, { in: number; out: number; cached_read: number }> = {
  opus: { in: 15, out: 75, cached_read: 1.5 },
  sonnet: { in: 3, out: 15, cached_read: 0.3 },
  haiku: { in: 0.8, out: 4, cached_read: 0.08 },
  pioneer: { in: 0.1, out: 0.4, cached_read: 0.01 },
};

export const UNIT_PRICES: Record<string, number> = {
  sandbox_seconds: 0.0000463, // ~$0.16/hour
  tool_call: 0.002,
  voice_minute: 0.12,
  storage_gb_hour: 0.0001,
  egress_gb: 0.09,
};

export interface MeterEntry {
  venture_id: string;
  department_id: string;
  agent_run_id?: string;
  work_order_id?: string;
  unit: string;
  resource: string;
  quantity: number;
  unit_cost_usd?: number;
}

export interface BudgetState {
  department_id: string;
  envelope_usd: number;
  hard_cap_usd: number;
  reserved_usd: number;
  spent_usd: number;
  state: 'active' | 'degraded' | 'frozen' | 'thawed';
}

/**
 * Budget Meter: two-phase spend (reserve -> commit/release), automatic model
 * downgrade at 80% of envelope, hard freeze at the cap.
 */
export class Meter {
  constructor(
    private db: Db,
    private events: EventStore,
  ) {}

  async openCycle(
    venture_id: string,
    total_usd: number,
    allocations: Array<{ department_id: string; envelope_usd: number; hard_cap_usd: number; rationale?: string }>,
    durationMs = 24 * 3600 * 1000,
  ): Promise<string> {
    const cycle_id = uuid();
    const prev = await this.db.query<{ n: string }>(
      'SELECT COALESCE(MAX(cycle_index),0) AS n FROM budgets WHERE venture_id = $1',
      [venture_id],
    );
    await this.db.query(
      `INSERT INTO budgets (id, venture_id, cycle_id, cycle_index, closes_at, total_usd, runway_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuid(), venture_id, cycle_id, Number(prev.rows[0]?.n ?? 0) + 1,
       new Date(Date.now() + durationMs).toISOString(), total_usd, total_usd],
    );
    for (const a of allocations) {
      await this.db.query(
        `INSERT INTO budget_allocations
           (id, venture_id, cycle_id, department_id, envelope_usd, hard_cap_usd, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuid(), venture_id, cycle_id, a.department_id, a.envelope_usd, a.hard_cap_usd, a.rationale ?? null],
      );
    }
    await this.events.append({
      venture_id,
      type: 'money.budget_allocated',
      actor_kind: 'system',
      actor_id: 'finance.treasurer',
      payload: { cycle_id, total_usd, allocations },
      trace_id: `budget:${cycle_id}`,
    });
    return cycle_id;
  }

  async currentCycle(venture_id: string): Promise<string | null> {
    const r = await this.db.query<{ cycle_id: string }>(
      'SELECT cycle_id FROM budgets WHERE venture_id = $1 ORDER BY cycle_index DESC LIMIT 1',
      [venture_id],
    );
    return r.rows[0]?.cycle_id ?? null;
  }

  /** Reserve budget before work starts. Throws when the department is frozen or over cap. */
  async reserve(
    venture_id: string,
    department_id: string,
    amount_usd: number,
    work_order_id?: string,
    ttlMs = 3600_000,
  ): Promise<string> {
    const cycle_id = await this.currentCycle(venture_id);
    if (!cycle_id) throw new KernelError('no_budget_cycle', 'no open budget cycle for venture');

    return this.db.tx(async (tx) => {
      const r = await tx.query<any>(
        'SELECT * FROM budget_allocations WHERE cycle_id = $1 AND department_id = $2',
        [cycle_id, department_id],
      );
      if (r.rows.length === 0) {
        throw new KernelError('no_allocation', `no budget allocated to ${department_id}`);
      }
      const a = r.rows[0];
      const reserved = Number(a.reserved_usd);
      const spent = Number(a.spent_usd);
      const cap = Number(a.hard_cap_usd);
      if (a.state === 'frozen') {
        throw new KernelError('budget_frozen', `${department_id} budget is frozen`, false, 402);
      }
      if (spent + reserved + amount_usd > cap) {
        throw new KernelError(
          'budget_exceeded',
          `${department_id} would exceed hard cap ($${cap}); spent $${spent}, reserved $${reserved}, want $${amount_usd}`,
          false,
          402,
        );
      }
      const id = uuid();
      await tx.query(
        `INSERT INTO reservations (id, venture_id, cycle_id, department_id, work_order_id, amount_usd, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, venture_id, cycle_id, department_id, work_order_id ?? null, amount_usd,
         new Date(Date.now() + ttlMs).toISOString()],
      );
      await tx.query(
        'UPDATE budget_allocations SET reserved_usd = reserved_usd + $1, updated_at = now() WHERE id = $2',
        [amount_usd, a.id],
      );
      return id;
    });
  }

  async release(reservation_id: string): Promise<void> {
    await this.db.tx(async (tx) => {
      const r = await tx.query<any>('SELECT * FROM reservations WHERE id = $1', [reservation_id]);
      if (r.rows.length === 0 || r.rows[0].state !== 'held') return;
      const res = r.rows[0];
      await tx.query(`UPDATE reservations SET state = 'released' WHERE id = $1`, [reservation_id]);
      await tx.query(
        `UPDATE budget_allocations SET reserved_usd = GREATEST(reserved_usd - $1, 0), updated_at = now()
         WHERE cycle_id = $2 AND department_id = $3`,
        [Number(res.amount_usd), res.cycle_id, res.department_id],
      );
    });
  }

  /** Record actual consumption. Always safe to call; emits money.metered. */
  async record(entry: MeterEntry): Promise<number> {
    const unit_cost = entry.unit_cost_usd ?? UNIT_PRICES[entry.unit] ?? 0;
    const cost_usd = Number((entry.quantity * unit_cost).toFixed(6));
    const cycle_id = (await this.currentCycle(entry.venture_id)) ?? uuid();

    await this.db.query(
      `INSERT INTO meters (id, venture_id, department_id, agent_run_id, work_order_id, unit,
                           resource, quantity, unit_cost_usd, cost_usd, cycle_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [uuid(), entry.venture_id, entry.department_id, entry.agent_run_id ?? null,
       entry.work_order_id ?? null, entry.unit, entry.resource, entry.quantity,
       unit_cost, cost_usd, cycle_id],
    );
    await this.db.query(
      `UPDATE budget_allocations SET spent_usd = spent_usd + $1, updated_at = now()
       WHERE cycle_id = $2 AND department_id = $3`,
      [cost_usd, cycle_id, entry.department_id],
    );
    await this.db.query('UPDATE ventures SET spend_usd = spend_usd + $1 WHERE id = $2', [
      cost_usd, entry.venture_id,
    ]);
    await this.events.append({
      venture_id: entry.venture_id,
      type: 'money.metered',
      actor_kind: 'system',
      actor_id: 'kernel.meter',
      department_id: entry.department_id,
      payload: {
        department_id: entry.department_id, unit: entry.unit,
        resource: entry.resource, quantity: entry.quantity, cost_usd,
      },
      trace_id: `meter:${entry.venture_id}`,
      correlation_id: entry.work_order_id,
    });
    await this.enforcePolicy(entry.venture_id, entry.department_id, cycle_id);
    return cost_usd;
  }

  /** Token accounting for a model call, priced by tier. */
  async recordTokens(
    entry: Omit<MeterEntry, 'unit' | 'quantity' | 'unit_cost_usd'> & {
      tier: string;
      tokens_in: number;
      tokens_out: number;
      tokens_cached_read?: number;
    },
  ): Promise<number> {
    const p = MODEL_PRICES[entry.tier] ?? MODEL_PRICES.sonnet;
    let total = 0;
    total += await this.record({ ...entry, unit: 'tokens_in', quantity: entry.tokens_in, unit_cost_usd: p.in / 1e6 });
    total += await this.record({ ...entry, unit: 'tokens_out', quantity: entry.tokens_out, unit_cost_usd: p.out / 1e6 });
    if (entry.tokens_cached_read) {
      total += await this.record({
        ...entry, unit: 'tokens_cached_read', quantity: entry.tokens_cached_read,
        unit_cost_usd: p.cached_read / 1e6,
      });
    }
    return Number(total.toFixed(6));
  }

  /** Degrade at 80% of envelope, freeze at the hard cap. Both emit events. */
  private async enforcePolicy(venture_id: string, department_id: string, cycle_id: string): Promise<void> {
    const r = await this.db.query<any>(
      'SELECT * FROM budget_allocations WHERE cycle_id = $1 AND department_id = $2',
      [cycle_id, department_id],
    );
    if (r.rows.length === 0) return;
    const a = r.rows[0];
    const spent = Number(a.spent_usd);
    const envelope = Number(a.envelope_usd);
    const cap = Number(a.hard_cap_usd);
    const ratio = envelope > 0 ? spent / envelope : 0;

    if (spent >= cap && a.state !== 'frozen') {
      await this.db.query(`UPDATE budget_allocations SET state = 'frozen' WHERE id = $1`, [a.id]);
      await this.events.append({
        venture_id, type: 'money.budget_exceeded', actor_kind: 'system', actor_id: 'kernel.meter',
        department_id, payload: { department_id, envelope_usd: envelope, spent_usd: spent },
        trace_id: `meter:${venture_id}`,
      });
      await this.events.append({
        venture_id, type: 'dept.frozen', actor_kind: 'system', actor_id: 'kernel.meter',
        department_id, payload: { department_id, reason: 'hard cap reached' },
        trace_id: `meter:${venture_id}`,
      });
    } else if (ratio >= 0.8 && a.state === 'active') {
      await this.db.query(`UPDATE budget_allocations SET state = 'degraded' WHERE id = $1`, [a.id]);
      await this.events.append({
        venture_id, type: 'money.budget_degraded', actor_kind: 'system', actor_id: 'kernel.meter',
        department_id, payload: { department_id, ratio: Number(ratio.toFixed(3)) },
        trace_id: `meter:${venture_id}`,
      });
    }
  }

  /** Model tier actually used, after budget degradation. */
  async effectiveTier(venture_id: string, department_id: string, requested: string): Promise<string> {
    const cycle_id = await this.currentCycle(venture_id);
    if (!cycle_id) return requested;
    const r = await this.db.query<{ state: string }>(
      'SELECT state FROM budget_allocations WHERE cycle_id = $1 AND department_id = $2',
      [cycle_id, department_id],
    );
    const state = r.rows[0]?.state;
    if (state !== 'degraded') return requested;
    const downgrade: Record<string, string> = { opus: 'sonnet', sonnet: 'haiku', haiku: 'haiku' };
    return downgrade[requested] ?? requested;
  }

  async budgets(venture_id: string): Promise<BudgetState[]> {
    const cycle_id = await this.currentCycle(venture_id);
    if (!cycle_id) return [];
    const r = await this.db.query<any>(
      'SELECT * FROM budget_allocations WHERE cycle_id = $1 ORDER BY department_id',
      [cycle_id],
    );
    return r.rows.map((a: any) => ({
      department_id: a.department_id,
      envelope_usd: Number(a.envelope_usd),
      hard_cap_usd: Number(a.hard_cap_usd),
      reserved_usd: Number(a.reserved_usd),
      spent_usd: Number(a.spent_usd),
      state: a.state,
    }));
  }
}
