import { DEPARTMENT_NAMES, type DepartmentId } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import type { EventStore } from './event-store.js';
import type { Meter } from './meter.js';

/**
 * Wallets = each department's budget envelope, presented as a spendable
 * balance. Money in comes from the founder (spend cap), Stripe top-ups, and
 * revenue; money out is metered token/tool/hire spend. Stripe funds the pool
 * via a Checkout Session; per-agent physical cards would need Stripe Issuing,
 * which is surfaced as an "ask" rather than silently faked.
 */
export class Wallets {
  constructor(private readonly db: Db, private readonly events: EventStore, private readonly meter: Meter) {}

  async list(venture_id: string) {
    const budgets = await this.meter.budgets(venture_id);
    const v = await this.db.query<any>('SELECT spend_usd FROM ventures WHERE id = $1', [venture_id]);
    const f = await this.db.query<any>('SELECT f.spend_cap_usd, f.terac_cap_usd FROM founders f JOIN ventures v ON v.founder_id = f.id WHERE v.id = $1', [venture_id]);
    const funded = await this.db.query<any>(`SELECT COALESCE(SUM((payload->>'amount_usd')::numeric),0) AS total FROM events WHERE venture_id = $1 AND type IN ('money.wallet_funded','money.revenue_received')`, [venture_id]).catch(() => ({ rows: [{ total: 0 }] }));
    const agentsByDept = await this.db.query<any>(`SELECT department_id, agent_id, SUM(cost_usd) AS cost, COUNT(*) AS runs FROM agent_runs WHERE venture_id = $1 GROUP BY department_id, agent_id`, [venture_id]).catch(() => ({ rows: [] as any[] }));
    return {
      currency: 'USD',
      spend_cap_usd: Number(f.rows[0]?.spend_cap_usd ?? 50),
      terac_cap_usd: Number(f.rows[0]?.terac_cap_usd ?? 200),
      spent_usd: Number(v.rows[0]?.spend_usd ?? 0),
      funded_usd: Number(funded.rows[0]?.total ?? 0),
      stripe: {
        configured: Boolean(process.env.STRIPE_SECRET_KEY),
        test_mode: (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_'),
        issuing: { available: false, ask: 'Per-agent spend cards need Stripe Issuing enabled on the account (Dashboard → Issuing). Until then agents spend from department envelopes metered by the kernel.' },
      },
      wallets: budgets.map((b) => ({
        department_id: b.department_id,
        name: DEPARTMENT_NAMES[b.department_id as DepartmentId] ?? b.department_id,
        envelope_usd: b.envelope_usd,
        hard_cap_usd: b.hard_cap_usd,
        reserved_usd: b.reserved_usd,
        spent_usd: b.spent_usd,
        available_usd: Math.max(0, b.envelope_usd - b.reserved_usd - b.spent_usd),
        state: b.state,
        agents: agentsByDept.rows.filter((r) => r.department_id === b.department_id).map((r) => ({ agent_id: r.agent_id, spent_usd: Number(r.cost), runs: Number(r.runs) })),
      })),
    };
  }

  /** Founder tops up the company via Stripe Checkout (test mode). Returns a URL to pay at. */
  async createTopUp(venture_id: string, amount_usd: number, success_url: string, cancel_url: string): Promise<{ url: string; session_id?: string; driver: 'stripe' | 'mock' }> {
    const key = process.env.STRIPE_SECRET_KEY;
    const cents = Math.round(amount_usd * 100);
    if (!key) {
      // Mock: fund immediately so the demo keeps moving; clearly labelled.
      await this.fund(venture_id, amount_usd, 'mock', `mock_${Date.now()}`);
      return { url: success_url, driver: 'mock' };
    }
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', success_url);
    form.set('cancel_url', cancel_url);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'usd');
    form.set('line_items[0][price_data][unit_amount]', String(cents));
    form.set('line_items[0][price_data][product_data][name]', 'Zeroth agent wallet top-up');
    form.set('metadata[venture_id]', venture_id);
    form.set('metadata[kind]', 'wallet_topup');
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    const j = (await res.json()) as any;
    if (!res.ok) throw new Error(`stripe ${res.status}: ${String(j?.error?.message ?? '').slice(0, 200)}`);
    return { url: j.url, session_id: j.id, driver: 'stripe' };
  }

  /** Records a top-up and grows every department envelope proportionally. */
  async fund(venture_id: string, amount_usd: number, rail: string, external_id?: string): Promise<void> {
    const trace = await this.db.query<{ trace_id: string }>('SELECT trace_id FROM ventures WHERE id = $1', [venture_id]);
    if (!trace.rows[0]) return;
    await this.events.append({ venture_id, type: 'money.wallet_funded', actor_kind: 'founder', actor_id: 'founder', payload: { amount_usd, rail, external_id }, trace_id: trace.rows[0].trace_id, idempotency_key: external_id ? `fund:${rail}:${external_id}` : undefined });
    const budgets = await this.meter.budgets(venture_id);
    if (!budgets.length) return;
    const per = amount_usd / budgets.length;
    const cycle = await this.db.query<{ cycle_id: string }>('SELECT cycle_id FROM budgets WHERE venture_id = $1 ORDER BY cycle_index DESC LIMIT 1', [venture_id]);
    if (!cycle.rows[0]) return;
    await this.db.query(`UPDATE budget_allocations SET envelope_usd = envelope_usd + $1, hard_cap_usd = hard_cap_usd + $2 WHERE cycle_id = $3`, [per, per * 2, cycle.rows[0].cycle_id]);
    await this.db.query(`UPDATE budgets SET total_usd = total_usd + $1 WHERE cycle_id = $2`, [amount_usd, cycle.rows[0].cycle_id]);
    await this.db.query(`UPDATE founders SET spend_cap_usd = spend_cap_usd + $1 WHERE id = (SELECT founder_id FROM ventures WHERE id = $2)`, [amount_usd, venture_id]);
  }
}
