import {
  ARTIFACT_OWNER,
  ArtifactType,
  LOAD_BEARING_POINTERS,
  SYNTHETIC_SOURCE_KINDS,
  SourceRef,
  artifactSchema,
} from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import { KernelError } from './event-store.js';
import { bodyHash, getPointer, hmac, nowIso, numericPointers, uuid } from './util.js';

export interface SignInput {
  venture_id: string;
  type: string;
  body: Record<string, unknown>;
  produced_by: string;
  department_id: string;
  work_order_id?: string;
  sources?: SourceRef[];
  quality?: 'draft' | 'signed' | 'partial' | 'contested';
  gaps?: string[];
  cost_usd?: number;
  lineage_id?: string;
}

export interface SignedArtifact {
  id: string;
  venture_id: string;
  type: ArtifactType;
  version: number;
  lineage_id: string;
  body: Record<string, unknown>;
  body_hash: string;
  quality: string;
  signature: string | null;
  gaps: string[];
  cost_usd: number;
  created_at: string;
}

/**
 * Numeric fields that are structurally exempt from citation: they are counts,
 * scores, weights and configuration produced by the system itself, not claims
 * about the world. Everything else numeric must be cited before signing.
 */
const EXEMPT_POINTER_PATTERNS: RegExp[] = [
  /confidence$/, /^\/scores\//, /score$/, /weight$/, /_count$/, /^\/seed$/,
  /strength$/, /probability$/, /intensity$/, /^\/duration_s$/, /ts_offset_s$/,
  /icp_match$/, /^\/cost_usd$/, /^\/attempt$/, /occurrences$/, /^\/rank$/,
  /ships_in_hours$/, /^\/interview_count$/, /population_weight$/,
  /^\/questions\/\d+\/(estimate|ci\/\d+|responses\/\d+\/(weight|answer))$/,
  /^\/archetypes\/\d+\/attributes\//, /^\/cost\//, /eng_hours$/,
  /^\/evidence\/\d+\/weight$/, /^\/qa\//, /scenarios_/, /^\/leads\/\d+\//,
  /^\/suppressed_count$/, /^\/themes\/\d+\/(supports|contradicts|neutral|net_strength)$/,
  /^\/pricing\//, /^\/allocations\/\d+\//, /^\/total_usd$/, /^\/runway_usd$/,
  /^\/budget_usd$/, /^\/amount_usd$/, /^\/deadline/, /^\/expected_/,
  /^\/numbers_stated\/\d+\/value$/,
  // D02 SharpenedIdea: cost_today is justified by its sibling `basis` string,
  // which the schema already requires. See architecture 02-departments/D02.
  /^\/pain\/cost_today\/value$/,
];

function isExempt(pointer: string): boolean {
  return EXEMPT_POINTER_PATTERNS.some((re) => re.test(pointer));
}

/** A `Cited<T>` node is self-citing: /tam_usd/value is covered by /tam_usd. */
function coveringPointers(pointer: string): string[] {
  const parts = pointer.split('/');
  const out: string[] = [pointer];
  for (let i = parts.length - 1; i > 1; i--) out.push(parts.slice(0, i).join('/'));
  return out;
}

export interface EvidenceViolation {
  json_pointer: string;
  reason: string;
}

export class ArtifactRegistry {
  constructor(
    private db: Db,
    private signingKey: string,
  ) {}

  /**
   * Validate + store an artifact. Signing is refused unless every load-bearing
   * numeric claim carries a real (non-synthetic) citation. This is the
   * anti-hallucination spine; it is enforced here and nowhere else.
   */
  async create(input: SignInput): Promise<SignedArtifact> {
    const typeParsed = ArtifactType.safeParse(input.type);
    if (!typeParsed.success) {
      throw new KernelError('unknown_artifact_type', `unknown artifact type "${input.type}"`);
    }
    const type = typeParsed.data;

    const owner = ARTIFACT_OWNER[type];
    if (input.department_id !== owner && input.department_id !== 'D13') {
      throw new KernelError(
        'wrong_producer',
        `${type} is owned by ${owner}, not ${input.department_id}`,
      );
    }

    const parsed = artifactSchema(type).safeParse(input.body);
    if (!parsed.success) {
      throw new KernelError(
        'invalid_artifact_body',
        `${type} body failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ')}`,
        false,
        422,
      );
    }
    const body = parsed.data as Record<string, unknown>;
    const sources = input.sources ?? [];
    const wantSigned = (input.quality ?? 'draft') === 'signed';

    if (wantSigned) {
      const violations = await this.checkEvidence(type, body, sources, input.venture_id);
      if (violations.length > 0) {
        throw new KernelError(
          'evidence_required',
          `cannot sign ${type}: ${violations.length} uncited or unsupported claim(s) — ` +
            violations.map((v) => `${v.json_pointer}: ${v.reason}`).join('; '),
          false,
          422,
          { violations },
        );
      }
    }

    const hash = bodyHash(body);
    const id = uuid();
    const lineage_id = input.lineage_id ?? id;

    return this.db.tx(async (tx) => {
      const prior = await tx.query<{ v: number }>(
        'SELECT COALESCE(MAX(version),0) AS v FROM artifacts WHERE lineage_id = $1',
        [lineage_id],
      );
      const version = Number(prior.rows[0]?.v ?? 0) + 1;

      if (version > 1) {
        await tx.query(
          `UPDATE artifacts SET quality = 'superseded', superseded_by = $1
             WHERE lineage_id = $2 AND quality <> 'superseded'`,
          [id, lineage_id],
        );
      }

      const quality = input.quality ?? 'draft';
      const signature = wantSigned ? hmac(this.signingKey, hash) : null;
      const created_at = nowIso();

      await tx.query(
        `INSERT INTO artifacts
           (id, venture_id, type, version, lineage_id, body, body_hash, schema_version,
            quality, gaps, produced_by, department_id, work_order_id, signature, signed_at,
            cost_usd, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id, input.venture_id, type, version, lineage_id,
          JSON.stringify(body), hash, `${type}@1.0.0`, quality,
          JSON.stringify(input.gaps ?? []), input.produced_by, input.department_id,
          input.work_order_id ?? null, signature, wantSigned ? created_at : null,
          input.cost_usd ?? 0, created_at,
        ],
      );

      for (const s of sources) {
        await tx.query(
          `INSERT INTO artifact_sources (artifact_id, source_id, json_pointer, excerpt, confidence, method)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [id, s.source_id, s.json_pointer, s.excerpt, s.confidence, s.method],
        );
      }

      return {
        id, venture_id: input.venture_id, type, version, lineage_id,
        body, body_hash: hash, quality, signature, gaps: input.gaps ?? [],
        cost_usd: input.cost_usd ?? 0, created_at,
      };
    });
  }

  /** Public so tests and the agent-kit can pre-check before attempting to sign. */
  async checkEvidence(
    type: ArtifactType,
    body: Record<string, unknown>,
    sources: SourceRef[],
    venture_id: string,
  ): Promise<EvidenceViolation[]> {
    const violations: EvidenceViolation[] = [];
    const byPointer = new Map<string, SourceRef[]>();
    for (const s of sources) {
      const list = byPointer.get(s.json_pointer) ?? [];
      list.push(s);
      byPointer.set(s.json_pointer, list);
    }

    const cited = (pointer: string): SourceRef[] =>
      coveringPointers(pointer).flatMap((p) => byPointer.get(p) ?? []);

    // 1. Every numeric claim needs at least one citation, unless structurally exempt.
    for (const pointer of numericPointers(body)) {
      if (isExempt(pointer)) continue;
      // A Cited<> node carries its own source_ids inline.
      const parent = pointer.split('/').slice(0, -1).join('/');
      const parentVal = getPointer(body, parent) as any;
      if (parentVal && Array.isArray(parentVal.source_ids) && parentVal.source_ids.length > 0) continue;
      if (cited(pointer).length === 0) {
        violations.push({ json_pointer: pointer, reason: 'numeric claim has no source' });
      }
    }

    // 2. Load-bearing pointers may not rest on `asserted` method or synthetic-only sources.
    const loadBearing = LOAD_BEARING_POINTERS[type] ?? [];
    for (const pointer of loadBearing) {
      const node = getPointer(body, pointer) as any;
      if (node === undefined) continue;
      const inlineIds: string[] = Array.isArray(node?.source_ids) ? node.source_ids : [];
      const refs = cited(pointer);
      const methods = [
        ...refs.map((r) => r.method),
        ...(typeof node?.method === 'string' ? [node.method] : []),
      ];
      if (methods.length > 0 && methods.every((m) => m === 'asserted')) {
        violations.push({ json_pointer: pointer, reason: 'load-bearing value backed only by method="asserted"' });
      }
      const ids = [...inlineIds, ...refs.map((r) => r.source_id)];
      if (ids.length === 0) {
        violations.push({ json_pointer: pointer, reason: 'load-bearing value has no source' });
        continue;
      }
      const kinds = await this.sourceKinds(venture_id, ids);
      if (kinds.length > 0 && kinds.every((k) => SYNTHETIC_SOURCE_KINDS.includes(k as any))) {
        violations.push({
          json_pointer: pointer,
          reason: 'load-bearing value backed only by synthetic evidence',
        });
      }
    }
    return violations;
  }

  private async sourceKinds(venture_id: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const r = await this.db.query<{ kind: string }>(
      'SELECT kind FROM sources WHERE venture_id = $1 AND id = ANY($2)',
      [venture_id, ids],
    );
    return r.rows.map((x) => x.kind);
  }

  async registerSource(s: {
    venture_id: string;
    kind: string;
    uri?: string;
    title?: string;
    content_hash?: string;
    snapshot_uri?: string;
    publisher?: string;
    reliability?: number;
    fetched_by?: string;
  }): Promise<string> {
    const id = uuid();
    await this.db.query(
      `INSERT INTO sources (id, venture_id, kind, uri, title, content_hash, snapshot_uri, publisher, reliability, fetched_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, s.venture_id, s.kind, s.uri ?? null, s.title ?? null, s.content_hash ?? null,
       s.snapshot_uri ?? null, s.publisher ?? null, s.reliability ?? null, s.fetched_by ?? null],
    );
    return id;
  }

  async get(id: string): Promise<any | null> {
    const r = await this.db.query('SELECT * FROM artifacts WHERE id = $1', [id]);
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const src = await this.db.query('SELECT * FROM artifact_sources WHERE artifact_id = $1', [id]);
    return {
      ...row,
      version: Number(row.version),
      body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body,
      gaps: typeof row.gaps === 'string' ? JSON.parse(row.gaps) : row.gaps,
      sources: src.rows,
    };
  }

  async list(venture_id: string, filter: { type?: string; quality?: string } = {}): Promise<any[]> {
    const params: unknown[] = [venture_id];
    let sql = 'SELECT * FROM artifacts WHERE venture_id = $1';
    if (filter.type) { params.push(filter.type); sql += ` AND type = $${params.length}`; }
    if (filter.quality) { params.push(filter.quality); sql += ` AND quality = $${params.length}`; }
    sql += ' ORDER BY created_at ASC';
    const r = await this.db.query(sql, params);
    return r.rows.map((row: any) => ({
      ...row,
      version: Number(row.version),
      body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body,
      gaps: typeof row.gaps === 'string' ? JSON.parse(row.gaps) : row.gaps,
    }));
  }

  verify(body: unknown, signature: string): boolean {
    return hmac(this.signingKey, bodyHash(body)) === signature;
  }
}
