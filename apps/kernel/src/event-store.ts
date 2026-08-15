import { EventEnvelope, EventType, eventPayloadSchema } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import { nowIso, uuid } from './util.js';

export interface AppendInput {
  venture_id: string;
  type: string;
  actor_kind?: 'agent' | 'founder' | 'system' | 'webhook' | 'human_hire';
  actor_id: string;
  department_id?: string;
  payload?: Record<string, unknown>;
  trace_id: string;
  causation_id?: string;
  correlation_id?: string;
  bus_transport?: 'band' | 'pg_notify' | 'none';
  /** When set, a second append with the same key is a no-op returning the first event. */
  idempotency_key?: string;
}

export type StoredEvent = EventEnvelope & { seq: number };
export type Subscriber = (e: StoredEvent) => void;

/**
 * The event store is the truth. It is the ONLY writer of the `events` table.
 * Everything else in the system is a projection of what this file appended.
 */
export class EventStore {
  private subs = new Set<Subscriber>();
  /** Hooks run inside the append transaction: routing and projections. */
  private reducers: Array<(e: StoredEvent, db: Db) => Promise<void> | void> = [];

  constructor(private db: Db) {}

  onEvent(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  addReducer(fn: (e: StoredEvent, db: Db) => Promise<void> | void): void {
    this.reducers.push(fn);
  }

  async append(input: AppendInput): Promise<StoredEvent> {
    const parsedType = EventType.safeParse(input.type);
    if (!parsedType.success) {
      throw new KernelError('unknown_event_type', `unknown event type "${input.type}"`, false);
    }
    const payloadSchema = eventPayloadSchema(parsedType.data);
    const payload = payloadSchema.safeParse(input.payload ?? {});
    if (!payload.success) {
      throw new KernelError(
        'invalid_event_payload',
        `payload for ${input.type} is invalid: ${payload.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        false,
      );
    }

    return this.db.tx(async (tx) => {
      if (input.idempotency_key) {
        const seen = await tx.query<{ result_ref: string }>(
          'SELECT result_ref FROM processed_messages WHERE consumer = $1 AND message_id = $2',
          ['event_store', input.idempotency_key],
        );
        if (seen.rows.length > 0 && seen.rows[0].result_ref) {
          const prior = await tx.query('SELECT * FROM events WHERE id = $1', [seen.rows[0].result_ref]);
          if (prior.rows.length > 0) return this.rowToEvent(prior.rows[0]);
        }
      }

      const id = uuid();
      const ts = nowIso();
      const res = await tx.query(
        `INSERT INTO events
           (id, venture_id, ts, type, actor_kind, actor_id, department_id,
            payload, trace_id, causation_id, correlation_id, bus_transport)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          id,
          input.venture_id,
          ts,
          input.type,
          input.actor_kind ?? 'agent',
          input.actor_id,
          input.department_id ?? null,
          JSON.stringify({ ...(input.payload ?? {}) }),
          input.trace_id,
          input.causation_id ?? null,
          input.correlation_id ?? null,
          input.bus_transport ?? 'pg_notify',
        ],
      );

      if (input.idempotency_key) {
        await tx.query(
          `INSERT INTO processed_messages (consumer, message_id, result_ref)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          ['event_store', input.idempotency_key, id],
        );
      }

      const stored = this.rowToEvent(res.rows[0]);
      for (const r of this.reducers) await r(stored, tx);
      return stored;
    }).then((stored) => {
      // Notify subscribers only after the transaction committed.
      for (const s of this.subs) {
        try {
          s(stored);
        } catch {
          /* a broken subscriber must never break the writer */
        }
      }
      return stored;
    });
  }

  async readStream(
    venture_id: string,
    opts: { after_seq?: number; limit?: number; types?: string[] } = {},
  ): Promise<StoredEvent[]> {
    const params: unknown[] = [venture_id, opts.after_seq ?? 0];
    let sql = 'SELECT * FROM events WHERE venture_id = $1 AND seq > $2';
    if (opts.types?.length) {
      params.push(opts.types);
      sql += ` AND type = ANY($${params.length})`;
    }
    params.push(Math.min(opts.limit ?? 500, 2000));
    sql += ` ORDER BY seq ASC LIMIT $${params.length}`;
    const res = await this.db.query(sql, params);
    return res.rows.map((r: any) => this.rowToEvent(r));
  }

  async latestSeq(venture_id: string): Promise<number> {
    const r = await this.db.query<{ seq: string }>(
      'SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE venture_id = $1',
      [venture_id],
    );
    return Number(r.rows[0]?.seq ?? 0);
  }

  private rowToEvent(r: any): StoredEvent {
    return {
      seq: Number(r.seq),
      id: r.id,
      venture_id: r.venture_id,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      type: r.type,
      actor_kind: r.actor_kind,
      actor_id: r.actor_id,
      department_id: r.department_id ?? undefined,
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? {}),
      trace_id: r.trace_id,
      causation_id: r.causation_id ?? undefined,
      correlation_id: r.correlation_id ?? undefined,
      bus_transport: r.bus_transport ?? 'pg_notify',
    } as StoredEvent;
  }
}

export class KernelError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public status = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'KernelError';
  }
}
