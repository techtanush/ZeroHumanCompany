import type { ArtifactType, DepartmentManifest, SourceRef } from '@zeroth/contracts';
import { artifactSchema } from '@zeroth/contracts';
import { runAgent, type RunContext } from './run.js';
import { extractJson } from './llm.js';

export interface CriticVerdict {
  accept: boolean;
  defects: string[];
}

export interface HeadOutcome {
  /** The artifact bodies the department produced (min_outputs may be > 1). */
  outputs: Array<{ body: Record<string, unknown>; sources: SourceRef[] }>;
  type: ArtifactType;
  quality: 'signed' | 'partial' | 'contested';
  gaps: string[];
  tokens_in: number;
  tokens_out: number;
  worker_results: Array<{ agent_id: string; ok: boolean; error?: string }>;
  critic: CriticVerdict | null;
}

export interface HeadOptions {
  manifest: DepartmentManifest;
  ctx: Omit<RunContext, 'tools' | 'vars'> & { vars: Record<string, unknown> };
  /** Builds the tool array for one agent from its manifest allowlist. */
  buildTools: (names: string[]) => RunContext['tools'];
  /** Validate an output body before signing; returns violations. */
  preflight?: (type: ArtifactType, body: Record<string, unknown>, sources: SourceRef[]) => Promise<string[]>;
}

/**
 * The Head loop: plan -> dispatch workers -> merge -> evidence check -> critic ->
 * at most ONE revision -> emit. Unbounded critic loops are how a demo runs out of
 * money at 2am, so the revision budget is exactly one, by design.
 */
export async function runHead(opts: HeadOptions): Promise<HeadOutcome> {
  const { manifest, ctx } = opts;
  const gaps: string[] = [];
  const worker_results: HeadOutcome['worker_results'] = [];
  let tokens_in = 0;
  let tokens_out = 0;

  // 1. Workers, bounded by manifest.concurrency, partials allowed.
  const workerJobs = manifest.workers.flatMap((w) =>
    Array.from({ length: w.replicas }, (_, i) => ({ spec: w, replica: i })),
  );
  const workerOutputs: Array<{ agent_id: string; text: string; json: unknown }> = [];

  for (let i = 0; i < workerJobs.length; i += manifest.concurrency) {
    const slice = workerJobs.slice(i, i + manifest.concurrency);
    const settled = await Promise.allSettled(
      slice.map((job) =>
        runAgent(job.spec, {
          ...ctx,
          tools: opts.buildTools(job.spec.tools),
          vars: { ...ctx.vars, replica_index: job.replica },
        }),
      ),
    );
    settled.forEach((r, idx) => {
      const spec = slice[idx].spec;
      if (r.status === 'fulfilled') {
        tokens_in += r.value.tokens_in;
        tokens_out += r.value.tokens_out;
        workerOutputs.push({ agent_id: r.value.agent_id, text: r.value.text, json: r.value.json });
        worker_results.push({ agent_id: spec.agent_id, ok: true });
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        worker_results.push({ agent_id: spec.agent_id, ok: false, error: msg });
        gaps.push(`worker ${spec.agent_id} failed: ${msg}`);
      }
    });
  }

  // 2. Head merges the worker findings into the department's output artifact.
  const mergeVars = {
    ...ctx.vars,
    task: ctx.vars.task ?? `Produce ${manifest.io.min_outputs} ${manifest.io.output} artifact(s).`,
    worker_findings: workerOutputs
      .map((w) => `### ${w.agent_id}\n${w.json ? JSON.stringify(w.json) : w.text}`)
      .join('\n\n'),
    output_type: manifest.io.output,
    min_outputs: manifest.io.min_outputs,
  };

  const head = await runAgent(manifest.head, {
    ...ctx,
    tools: opts.buildTools(manifest.head.tools),
    vars: mergeVars,
  });
  tokens_in += head.tokens_in;
  tokens_out += head.tokens_out;

  let outputs = parseOutputs(head.json ?? safeJson(head.text), manifest.io.output);
  if (outputs.length === 0) {
    return {
      outputs: [], type: manifest.io.output, quality: 'contested',
      gaps: [...gaps, 'head produced no parseable artifact'],
      tokens_in, tokens_out, worker_results, critic: null,
    };
  }

  // 3. Evidence + schema preflight. Failures become defects the critic sees.
  let defects = await preflightAll(opts, manifest.io.output, outputs);

  // 4. Critic: one adversarial pass.
  let verdict: CriticVerdict | null = null;
  if (manifest.critic) {
    const critic = await runAgent(
      {
        agent_id: manifest.critic.agent_id,
        model: manifest.critic.model,
        replicas: 1,
        system_prompt_ref: manifest.critic.rubric_ref,
        tools: [],
        max_tokens_per_run: manifest.critic.max_tokens_per_run,
      },
      {
        ...ctx,
        tools: [],
        vars: {
          ...ctx.vars,
          task: 'Review the candidate artifacts against the rubric. Return {"accept":bool,"defects":[string]}.',
          candidate: JSON.stringify(outputs.map((o) => o.body)),
          known_defects: JSON.stringify(defects),
        },
      },
    );
    tokens_in += critic.tokens_in;
    tokens_out += critic.tokens_out;
    verdict = parseVerdict(critic.json ?? safeJson(critic.text));
    if (verdict && !verdict.accept) defects = [...defects, ...verdict.defects];
  }

  // 5. Exactly one revision pass, and only if something is actually wrong.
  if (defects.length > 0) {
    const revised = await runAgent(manifest.head, {
      ...ctx,
      tools: opts.buildTools(manifest.head.tools),
      vars: {
        ...mergeVars,
        task: `Revise the artifacts to fix these defects, changing nothing else:\n- ${defects.join('\n- ')}`,
        previous: JSON.stringify(outputs.map((o) => o.body)),
      },
    });
    tokens_in += revised.tokens_in;
    tokens_out += revised.tokens_out;
    const revisedOutputs = parseOutputs(revised.json ?? safeJson(revised.text), manifest.io.output);
    if (revisedOutputs.length > 0) {
      const remaining = await preflightAll(opts, manifest.io.output, revisedOutputs);
      if (remaining.length < defects.length) {
        outputs = revisedOutputs;
        defects = remaining;
      }
    }
  }

  // 6. Ship. Still-defective work ships as `contested` and says so in the UI.
  const quality: HeadOutcome['quality'] =
    defects.length > 0 ? 'contested'
    : outputs.length < manifest.io.min_outputs ? 'partial'
    : 'signed';

  if (outputs.length < manifest.io.min_outputs) {
    gaps.push(`expected ${manifest.io.min_outputs} ${manifest.io.output}, produced ${outputs.length}`);
  }

  return {
    outputs, type: manifest.io.output, quality,
    gaps: [...gaps, ...defects], tokens_in, tokens_out, worker_results, critic: verdict,
  };
}

async function preflightAll(
  opts: HeadOptions,
  type: ArtifactType,
  outputs: Array<{ body: Record<string, unknown>; sources: SourceRef[] }>,
): Promise<string[]> {
  const defects: string[] = [];
  for (const [i, o] of outputs.entries()) {
    const schema = artifactSchema(type).safeParse(o.body);
    if (!schema.success) {
      defects.push(
        ...schema.error.issues.map((iss) => `output[${i}] ${iss.path.join('.') || '<root>'}: ${iss.message}`),
      );
      continue;
    }
    if (opts.preflight) {
      const v = await opts.preflight(type, o.body, o.sources);
      defects.push(...v.map((msg) => `output[${i}] ${msg}`));
    }
  }
  return defects;
}

/**
 * Accept every envelope the prompts actually ask agents to emit:
 *   {artifact_type, body, source_ids[], gaps[], quality}   <- packages/prompts contract
 *   {artifacts:[...]}  |  [...]  |  a bare body object
 * Being liberal here is deliberate: a model that returns the right facts in a
 * slightly different wrapper should not cost the company a whole work order.
 */
export function parseOutputs(
  json: unknown,
  _type: ArtifactType,
): Array<{ body: Record<string, unknown>; sources: SourceRef[] }> {
  if (json === null || json === undefined) return [];
  const list: unknown[] = Array.isArray(json)
    ? json
    : typeof json === 'object' && Array.isArray((json as any).artifacts)
      ? (json as any).artifacts
      : [json];

  const out: Array<{ body: Record<string, unknown>; sources: SourceRef[] }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const hasEnvelope =
      'body' in rec && rec.body !== null && typeof rec.body === 'object';
    const body = hasEnvelope
      ? (rec.body as Record<string, unknown>)
      : stripEnvelopeKeys(rec);

    out.push({ body, sources: normalizeSources(rec) });
  }
  return out;
}

const ENVELOPE_KEYS = new Set([
  'artifact_type', 'body', 'sources', 'source_ids', 'assumptions', 'gaps', 'quality',
]);

function stripEnvelopeKeys(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) if (!ENVELOPE_KEYS.has(k)) out[k] = v;
  return out;
}

/** `sources` may be full SourceRefs, or `source_ids` may be bare id strings. */
function normalizeSources(rec: Record<string, unknown>): SourceRef[] {
  if (Array.isArray(rec.sources)) {
    return (rec.sources as unknown[]).filter(
      (s): s is SourceRef => Boolean(s) && typeof s === 'object' && 'source_id' in (s as object),
    );
  }
  if (Array.isArray(rec.source_ids)) {
    // Artifact-level ids with no pointer: recorded as backing the whole artifact.
    return (rec.source_ids as unknown[])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({
        source_id: id,
        json_pointer: '/',
        excerpt: '(artifact-level citation)',
        confidence: 0.5,
        method: 'estimated' as const,
      }));
  }
  return [];
}

function parseVerdict(json: unknown): CriticVerdict | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as any;
  return {
    accept: Boolean(j.accept),
    defects: Array.isArray(j.defects) ? j.defects.map(String) : [],
  };
}

function safeJson(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}
