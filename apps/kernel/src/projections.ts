import type { Db } from '@zeroth/db';
import type { StoredEvent } from './event-store.js';

/**
 * Projections. Every table touched here is rebuildable by replaying `events`;
 * none of them is authoritative. Reducers run inside the append transaction.
 */

type Liveness = Record<string, boolean>;

async function setLiveness(db: Db, venture_id: string, key: string): Promise<boolean> {
  const r = await db.query<{ liveness: Liveness | string }>(
    'SELECT liveness FROM ventures WHERE id = $1',
    [venture_id],
  );
  if (r.rows.length === 0) return false;
  const cur: Liveness =
    typeof r.rows[0].liveness === 'string' ? JSON.parse(r.rows[0].liveness) : r.rows[0].liveness;
  if (cur[key] === true) return false;
  cur[key] = true;
  await db.query('UPDATE ventures SET liveness = $1 WHERE id = $2', [JSON.stringify(cur), venture_id]);
  return true;
}

/** Returns the milestone reached by this event, if any, so the caller can emit it. */
export async function reduce(e: StoredEvent, db: Db): Promise<string | null> {
  switch (e.type) {
    case 'dept.work_order_issued': {
      // work_orders rows are written by the kernel API; nothing to project here.
      return null;
    }
    case 'dept.work_started': {
      const id = e.payload.work_order_id as string;
      await db.query(
        `UPDATE work_orders SET status='running', started_at=now() WHERE id=$1 AND status IN ('queued','admitted')`,
        [id],
      );
      await db.query(
        `UPDATE departments SET state='working' WHERE venture_id=$1 AND department_id=$2`,
        [e.venture_id, e.department_id ?? ''],
      );
      return null;
    }
    case 'dept.work_completed': {
      const id = e.payload.work_order_id as string;
      const artifact = e.payload.artifact as { id?: string } | undefined;
      await db.query(
        `UPDATE work_orders SET status='done', finished_at=now(), output_artifact_id=$2 WHERE id=$1`,
        [id, artifact?.id ?? null],
      );
      await db.query(
        `UPDATE departments SET state='idle' WHERE venture_id=$1 AND department_id=$2`,
        [e.venture_id, e.department_id ?? ''],
      );
      return null;
    }
    case 'dept.work_failed': {
      await db.query(
        `UPDATE work_orders SET status='failed', finished_at=now(), error=$2, attempt=$3 WHERE id=$1`,
        [e.payload.work_order_id, String(e.payload.error ?? ''), Number(e.payload.attempt ?? 0)],
      );
      await db.query(
        `UPDATE departments SET state='idle' WHERE venture_id=$1 AND department_id=$2`,
        [e.venture_id, e.department_id ?? ''],
      );
      return null;
    }
    case 'dept.frozen':
      await db.query(`UPDATE departments SET state='frozen' WHERE venture_id=$1 AND department_id=$2`,
        [e.venture_id, e.department_id ?? '']);
      return null;
    case 'dept.unfrozen':
      await db.query(`UPDATE departments SET state='idle' WHERE venture_id=$1 AND department_id=$2`,
        [e.venture_id, e.department_id ?? '']);
      return null;

    case 'artifact.signed': {
      const a = e.payload.artifact as { type?: string } | undefined;
      if (a?.type === 'SharpenedIdea') {
        return (await setLiveness(db, e.venture_id, 'idea_locked')) ? 'idea_locked' : null;
      }
      if (a?.type === 'ClaimLedger') {
        return (await setLiveness(db, e.venture_id, 'market_validated')) ? 'market_validated' : null;
      }
      return null;
    }

    case 'build.deployed':
      return (await setLiveness(db, e.venture_id, 'product_live')) ? 'product_live' : null;

    case 'sales.lead_created': {
      const lead_id = e.payload.lead_id as string | undefined;
      if (lead_id) {
        await db.query(
          `INSERT INTO leads (id, venture_id, alias, icp_score) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO NOTHING`,
          [lead_id, e.venture_id, String(e.payload.alias ?? 'lead'), Number(e.payload.icp_score ?? 0)],
        );
      }
      return (await setLiveness(db, e.venture_id, 'pipeline_active')) ? 'pipeline_active' : null;
    }

    case 'sales.deal_stage_changed': {
      const deal_id = e.payload.deal_id as string | undefined;
      if (deal_id) {
        await db.query(
          `INSERT INTO deals (id, venture_id, lead_id, stage, amount_usd, probability)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage, updated_at = now()`,
          [deal_id, e.venture_id, (e.payload.lead_id as string) ?? null,
           String(e.payload.stage ?? 'new'), Number(e.payload.amount_usd ?? 0),
           Number(e.payload.probability ?? 0)],
        );
      }
      return null;
    }

    case 'sales.deal_won':
      await db.query(`UPDATE deals SET stage='won', updated_at=now() WHERE id=$1`, [e.payload.deal_id]);
      return null;

    case 'sales.deal_lost':
      await db.query(`UPDATE deals SET stage='lost', lost_reason=$2, updated_at=now() WHERE id=$1`,
        [e.payload.deal_id, String(e.payload.reason ?? '')]);
      return null;

    case 'money.revenue_received':
      return (await setLiveness(db, e.venture_id, 'revenue_real')) ? 'revenue_real' : null;

    case 'support.ticket_opened': {
      const id = e.payload.ticket_id as string | undefined;
      if (id) {
        await db.query(
          `INSERT INTO tickets (id, venture_id, subject, severity, status)
           VALUES ($1,$2,$3,$4,'open') ON CONFLICT (id) DO NOTHING`,
          [id, e.venture_id, String(e.payload.subject ?? ''), String(e.payload.severity ?? 'medium')],
        );
      }
      return null;
    }
    case 'support.ticket_resolved':
      await db.query(`UPDATE tickets SET status='resolved' WHERE id=$1`, [e.payload.ticket_id]);
      return null;

    case 'venture.killed':
      await db.query(`UPDATE ventures SET status='killed', killed_at=now() WHERE id=$1`, [e.venture_id]);
      return null;
    case 'venture.resumed':
      await db.query(`UPDATE ventures SET status='active' WHERE id=$1`, [e.venture_id]);
      return null;
    case 'venture.autonomy_changed':
      await db.query('UPDATE ventures SET autonomy_level=$2 WHERE id=$1',
        [e.venture_id, String(e.payload.autonomy_level)]);
      return null;
    case 'system.kill_switch_engaged':
      await db.query('UPDATE ventures SET kill_switch=true, status=$2 WHERE id=$1', [e.venture_id, 'paused']);
      return null;
    case 'system.kill_switch_released':
      await db.query('UPDATE ventures SET kill_switch=false, status=$2 WHERE id=$1', [e.venture_id, 'active']);
      return null;

    default:
      return null;
  }
}

export async function ventureProjection(db: Db, venture_id: string): Promise<any | null> {
  const r = await db.query<any>('SELECT * FROM ventures WHERE id = $1', [venture_id]);
  if (r.rows.length === 0) return null;
  const v = r.rows[0];
  return {
    ...v,
    time_scale: Number(v.time_scale),
    spend_usd: Number(v.spend_usd),
    liveness: typeof v.liveness === 'string' ? JSON.parse(v.liveness) : v.liveness,
    created_at: v.created_at instanceof Date ? v.created_at.toISOString() : String(v.created_at),
  };
}
