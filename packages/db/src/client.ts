import { SCHEMA_SQL } from './schema.js';

export interface QueryResult<R = any> {
  rows: R[];
  rowCount: number;
}

/** The single database interface the whole backend codes against. */
export interface Db {
  query<R = any>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
  /** Serialized transaction. Nested calls reuse the outer transaction. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: 'pglite' | 'pg';
}

/**
 * PGlite driver — embedded Postgres, no docker required.
 * Used for dev, tests and the demo laptop. `DATABASE_URL` switches to real pg.
 */
async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(dataDir === 'memory' ? undefined : dataDir);
  await pg.waitReady;

  // PGlite is single-connection, so transactions must be serialized process-wide.
  let chain: Promise<unknown> = Promise.resolve();
  let inTx = false;

  const base: Db = {
    driver: 'pglite',
    async query<R>(sql: string, params: unknown[] = []) {
      const r = await pg.query<R>(sql, params as any[]);
      return { rows: r.rows as R[], rowCount: r.rows.length };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      if (inTx) return fn(base); // reuse outer transaction
      const run = async (): Promise<T> => {
        inTx = true;
        await pg.query('BEGIN');
        try {
          const out = await fn(base);
          await pg.query('COMMIT');
          return out;
        } catch (e) {
          await pg.query('ROLLBACK');
          throw e;
        } finally {
          inTx = false;
        }
      };
      const next = chain.then(run, run);
      chain = next.catch(() => undefined);
      return next;
    },
    async close() {
      await pg.close();
    },
  };
  return base;
}

/** Real Postgres driver (Render / docker compose). Same interface. */
async function createPg(url: string): Promise<Db> {
  const pgMod: any = await import('pg');
  const Pool = pgMod.default?.Pool ?? pgMod.Pool;
  const pool = new Pool({ connectionString: url, max: 10 });

  const wrap = (client: any): Db => ({
    driver: 'pg',
    async query<R>(sql: string, params: unknown[] = []) {
      const r = await client.query(sql, params as any[]);
      return { rows: r.rows as R[], rowCount: r.rowCount ?? r.rows.length };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      return fn(wrap(client)); // already inside a transaction
    },
    async close() {
      /* client lifetime owned by the pool */
    },
  });

  return {
    driver: 'pg',
    async query<R>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params as any[]);
      return { rows: r.rows as R[], rowCount: r.rowCount ?? r.rows.length };
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export interface OpenDbOptions {
  /** Postgres connection string. When absent, PGlite is used. */
  url?: string;
  /** PGlite data dir, or 'memory' for an ephemeral database. */
  dataDir?: string;
  /** Run the schema on open. Default true. */
  migrate?: boolean;
}

export async function openDb(opts: OpenDbOptions = {}): Promise<Db> {
  const url = opts.url ?? process.env.DATABASE_URL;
  const db = url
    ? await createPg(url)
    : await createPglite(opts.dataDir ?? process.env.PGLITE_DIR ?? 'memory');
  if (opts.migrate !== false) await migrate(db);
  return db;
}

export async function migrate(db: Db): Promise<void> {
  // Statement-by-statement so PGlite (which dislikes multi-statement strings
  // containing $$-quoted bodies) executes reliably on both drivers.
  for (const stmt of splitSql(SCHEMA_SQL)) {
    await db.query(stmt);
  }
}

/** Split SQL on semicolons that are not inside $$ ... $$ bodies or quotes. */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (!inSingle && c === '$' && sql[i + 1] === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    if (!inDollar && c === "'") inSingle = !inSingle;
    if (c === ';' && !inDollar && !inSingle) {
      const s = buf.trim();
      if (s) out.push(s);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export async function resetDb(db: Db): Promise<void> {
  await db.query(`
    DROP TABLE IF EXISTS tickets, deals, leads, memory, credentials, reservations,
      budget_allocations, budgets, meters, gates, escalations, agent_runs, work_orders,
      departments, artifact_sources, artifacts, sources, processed_messages, events,
      ventures, founders CASCADE
  `);
  await migrate(db);
}
