# 11 — Evidence & Truth: The Anti-Hallucination Spine

One sentence: **every claim the company makes carries evidence, or carries a gap** — a fabricated
number is a P0 bug (worker brief, invariant 3), and this file is the machinery that makes that
invariant enforceable rather than aspirational.

```
   tool fetch / interview / panel / webhook
                  │  snapshot + hash
                  ▼
            ┌──────────┐      claim-level links       ┌────────────────┐
            │ sources  │◄─────────────────────────────│ artifact_sources│
            │ (frozen) │   (json_pointer, excerpt,    │  per-field refs │
            └────┬─────┘    confidence, method)       └───────┬────────┘
                 │                                            │
                 ▼                                            ▼
        evidence drawer (Boardroom)              evidence check at sign time
        "click any number → see why"             no source & no gap ⇒ REJECT
```

Upstream: [`04-data-model.md`](04-data-model.md) (`sources`, `artifact_sources`, `claims`),
[`02-agent-runtime.md`](02-agent-runtime.md) (evidence check in the Head loop),
[`05-memory-and-context.md`](05-memory-and-context.md) (T4 memory is never a citation).
Downstream: [`16-evaluation-framework.md`](16-evaluation-framework.md) (rubrics score evidence
quality), [`12-safety-and-compliance.md`](12-safety-and-compliance.md) (consent on interview
sources), [`10-observability.md`](10-observability.md) ("explain this" renders these links).

---

## Source records

**MVP** — a `Source` is a frozen observation: what we read, where, when, and a snapshot proving
it. The table is in [`04-data-model.md`](04-data-model.md); the contract:

```ts
// packages/contracts/src/evidence.ts
import { z } from 'zod';

export const SourceKind = z.enum([
  'web_page',           // scraped/fetched page, snapshot in object storage
  'api_response',       // structured API result (enrichment, Apify actor output)
  'census_pums',        // PUMS microdata extract — simpop's substrate
  'interview',          // a real human conversation, consented + transcribed
  'stripe_object',      // charge, subscription, dispute — money facts
  'repo_file',          // code the company wrote or read
  'support_ticket',     // what a customer actually said
  'synthetic_panel',    // simpop output — ALWAYS labeled synthetic
  'human_hire_output',  // Terac deliverable
  'model_estimate',     // an LLM's own reasoning, admissible ONLY as 'estimated'
]);

export const Source = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  kind: SourceKind,
  uri: z.string().optional(),                 // URL | s3://… | pums://ca/2022 | interview:<uuid>
  title: z.string().optional(),
  retrieved_at: z.string().datetime(),
  content_hash: z.string().optional(),        // sha256 of the snapshot
  snapshot_uri: z.string().optional(),        // we keep what we read — refetches drift
  publisher: z.string().optional(),
  reliability: z.number().min(0).max(1),      // tier prior, table below
  fetched_by: z.string(),                     // agent_id
});
```

**Snapshot rule:** the tool plane snapshots every `web_page` and `api_response` at fetch time
(`sources.snapshot_uri`), deduped by `content_hash`. A citation points at what *we saw*, not at a
URL that may have changed. Disk is cheaper than a retracted claim.

**Source creation is a tool-plane side effect, not an agent choice.** `web_fetch` returns
`{content, source_id}` — the agent physically cannot fetch something without a Source existing.
Interviews create their Source on `human.call_completed`; Stripe objects on webhook receipt.

---

## Source quality tiers

**MVP** — `reliability` starts from a tier prior, adjustable per source, never above its tier cap.

| Tier | Kinds / examples | Prior | Cap |
|---|---|---|---|
| **T1 — ground truth** | `stripe_object`, `census_pums`, `repo_file`, signed contracts | 0.95 | 1.0 |
| **T2 — first-person testimony** | `interview` (real human, consented), `support_ticket` | 0.80 | 0.9 |
| **T3 — institutional publication** | gov/industry stats, peer-reviewed, major-press `web_page` | 0.70 | 0.85 |
| **T4 — commercial web** | vendor sites, review platforms, directories, `api_response` enrichment | 0.50 | 0.7 |
| **T5 — synthetic & derived** | `synthetic_panel`, `human_hire_output` (unverified), `model_estimate` | 0.30 | 0.5 |

Rules:

- A T5 source can never be the *sole* support for a `measured` claim (see methods below).
- `synthetic_panel` reliability is further scaled by simpop's `calibration_delta`
  ([`04-data-model.md`](04-data-model.md), `panel_results`) — a panel that diverged from real
  interviews gets discounted automatically, and the divergence is never hidden.
- Publisher-level adjustments live in T2 department memory as `dead_source` / `prior` notes
  ([`05-memory-and-context.md`](05-memory-and-context.md)); they down-rank retrieval, they do not
  edit `reliability` retroactively.

---

## Citation requirements per claim type

**MVP** — what a claim is determines what may back it. Enforced at sign time (below).

| Claim type | Example | Minimum evidence |
|---|---|---|
| **Quantitative market** (TAM/SAM/SOM, price points, growth) | "SOM ≈ $2.1M" | ≥1 source T3+, or 2 independent T4; method ∈ {measured, derived} |
| **Behavioral** (what customers do) | "practices reorder monthly" | ≥1 `interview` claim with `evidence_class='past_behavior'` or `current_practice` |
| **Intent** (what customers say they'll do) | "8/12 would pay $79" | `interview` claims, labeled `stated_intent` — never upgraded to behavioral |
| **Synthetic** (panel estimates) | "62% of archetype 7 prefer…" | `synthetic_panel` source + `evidence_class='synthetic'` on the artifact field |
| **Financial (own)** | "MRR is $149" | `stripe_object` only. Test mode labeled. |
| **Technical** (product state) | "QA passed 12/12" | `repo_file` / Replay `qa_runs` refs |
| **Qualitative synthesis** | "the segment is underserved" | ≥2 supporting sources of any tier; marked `method='asserted'` with named support |
| **Model estimate** | "we estimate CAC ≈ $40" | allowed only with `method='estimated'`, visible uncertainty, and a stated basis — and it renders with an "estimate" badge in the UI |

**The `evidence_class` label** (worker brief, invariant 7) rides on every artifact field that
mixes origins:

```ts
export const EvidenceClass = z.enum(['real','synthetic','mixed']);
// 'real'      — backed exclusively by T1–T4 non-synthetic sources
// 'synthetic' — simpop panels, model estimates
// 'mixed'     — both; the artifact must expose the split, e.g. "12 real interviews + panel n=2,400"
```

Synthetic ≠ proof: an artifact whose *decision-driving* fields are `synthetic`-only cannot pass a
`pivot_approval` or `niche_selection` gate without the gap stated on the card. D06 may *propose*
from synthetic evidence; the founder sees exactly how much of the case is simulated.

---

## The claim-level link: `artifact_sources`

**MVP** — evidence attaches to **fields, not documents**. The schema
([`04-data-model.md`](04-data-model.md)) binds `(artifact_id, source_id, json_pointer)` with:

| Field | Meaning |
|---|---|
| `json_pointer` | which field this backs — `/tam_usd`, `/personas/2/willingness_to_pay_usd` |
| `excerpt` | the exact supporting span from the snapshot — what a judge reads in the drawer |
| `confidence` | the *citing agent's* confidence that the excerpt supports the claim (0–1) |
| `method` | `measured` (source states it) · `derived` (arithmetic from sources, shown) · `estimated` (model judgment from stated basis) · `asserted` (qualitative, supported) |

**Derivations show their work.** A `derived` claim stores the formula in the artifact body next to
the value: `{"som_usd": 2100000, "som_basis": "1,400 practices (src A) × $125/mo (src B) × 12"}`.
The evidence checker recomputes trivial arithmetic and rejects mismatches > 5%.

### Claim confidence scoring

Field-level confidence shown in the Boardroom is computed, not self-reported:

```
confidence(field) = max over supporting links of
    (link.confidence × source.reliability)
  boosted +0.1 if ≥2 independent sources agree (different publishers, different kinds)
  penalized ×0.5 if any linked source CONTRADICTS (polarity check on claims)
  capped by the source tier cap
```

Contradictions are findings, not noise: a field with support *and* contradiction renders amber,
and D06's k=24 retrieval is designed to surface exactly these
([`05-memory-and-context.md`](05-memory-and-context.md), failure modes).

---

## Enforcement path: how a claim gets checked

**MVP** — evidence is checked at **step 7 of the Head loop** (sign time,
[`02-agent-runtime.md`](02-agent-runtime.md)), by code, before the critic ever sees it:

```ts
// apps/kernel/src/artifacts/evidence-check.ts
export async function evidenceCheck(artifact: Draft): Promise<EvidenceReport> {
  const rules = EVIDENCE_RULES[artifact.type];              // per artifact type, in contracts
  const violations: Violation[] = [];

  for (const field of quantitativeFields(artifact.body, rules)) {
    const links = await links(artifact.id, field.pointer);
    if (links.length === 0 && !artifact.gaps.includes(gapFor(field.pointer)))
      violations.push({ pointer: field.pointer, kind: 'uncited_quantitative' });

    for (const l of links) {
      if (!(await snapshotContains(l.source_id, l.excerpt)))
        violations.push({ pointer: field.pointer, kind: 'excerpt_not_in_snapshot' });  // fabricated citation
      if (ruleFor(field).min_tier > tierOf(l.source_id) && links.length < 2)
        violations.push({ pointer: field.pointer, kind: 'insufficient_tier' });
    }
    if (rules.evidence_class_required && !field.evidence_class)
      violations.push({ pointer: field.pointer, kind: 'missing_evidence_class' });
  }
  return { violations, verdict: violations.length ? 'reject' : 'pass' };
}
```

The full path of a claim, birth to render:

```
1. FETCH      tool plane creates Source + snapshot (agent cannot skip this)
2. DRAFT      worker writes the field and cites {source_id, excerpt, method}
3. OFFLOAD    the excerpt's full context stays retrievable via memory handles
4. CHECK      evidenceCheck(): excerpt ∈ snapshot, tier ≥ rule, arithmetic recomputed
5. CRITIC     adversarial pass may contest *interpretation* (the code already caught fabrication)
6. SIGN       artifact.quality='signed'; links frozen with the version
7. RENDER     Boardroom evidence drawer: field → excerpt → snapshot → source URI
```

**What happens on failure — gaps, never invention:**

| Failure | Outcome |
|---|---|
| No source found for a required field | Field set `null`, `gaps: ['no_evidence:/tam_usd']`, artifact may still sign as `partial` |
| Excerpt not found in snapshot | **P0-class rejection.** `artifact.validation_failed` event, run marked `failed`, retried once with the violation in context; a second failure freezes the worker's replica for the cycle and files a `cos.gap_detected` |
| Tier too low, no second source | Field downgraded to `method='estimated'` with the T4/T5 basis named, or gapped — the Head chooses, the choice is logged in `decisions[]` |
| Sources contradict | Both linked; field flagged `contested`; artifact can sign but the contradiction rides into any gate preview that uses the field |

A **gap is a first-class outcome**: `gaps[]` propagates through `ArtifactReady`
([`03-event-bus.md`](03-event-bus.md)), renders on gate cards ("Validation ships with gaps on
clinical claims" — [`06-human-in-the-loop.md`](06-human-in-the-loop.md)), and is the trigger for
rung-5 human hires when a gap is worth paying to close.

---

## The ClaimLedger

**MVP** — the shared contract for **D04** (produces it from interviews), read by **D03** (checks
market numbers against testimony), **D05** (calibrates the panel against it), and **D06** (pivots
from it). It is the venture's structured record of *what real humans actually said*.

```ts
// packages/contracts/src/artifacts/claim-ledger.ts
export const Claim = z.object({
  id: z.string().uuid(),
  interview_id: z.string().uuid(),
  speaker_alias: z.string(),                  // 'P3 — ops lead, 40-person dental group' — NEVER a name
  ts_offset_s: z.number().int().optional(),   // where in the recording
  verbatim: z.string(),                       // exact words. NEVER summarized (compaction rung-3 exemption)
  normalized: z.string(),                     // cleaned restatement for clustering
  theme: z.string(),                          // 'pricing' | 'switching_cost' | 'buyer_identity' | …
  polarity: z.enum(['supports','contradicts','neutral']),
  target_hypothesis: z.string(),              // which "what must be true" this bears on
  strength: z.number().min(0).max(1),         // scored: past_behavior ≫ opinion
  evidence_class: z.enum(['past_behavior','current_practice','stated_intent','opinion']),
  source_id: z.string().uuid(),               // → the interview Source
});

export const ClaimLedger = z.object({
  venture_id: z.string().uuid(),
  hypotheses: z.array(z.object({
    id: z.string(),                           // 'H2'
    statement: z.string(),                    // 'Practices will pay ≥$79/mo to stop no-shows'
    status: z.enum(['supported','contradicted','contested','untested']),
    support_strength: z.number(),             // Σ strength of supporting claims, behavior-weighted
    contradict_strength: z.number(),
    claims: z.array(z.string().uuid()),
  })),
  claims: z.array(Claim),
  interview_count: z.number().int(),
  coverage_gaps: z.array(z.string()),         // segments/personas we never reached
  evidence_class: z.literal('real'),          // the ledger is real-only BY DEFINITION
});
```

**Strength scoring** (the reason "8 people said they'd buy" doesn't win arguments):

| `evidence_class` | Base strength | Rationale |
|---|---|---|
| `past_behavior` | 0.9 | "I paid $200 for a workaround last quarter" — money already moved |
| `current_practice` | 0.7 | "we track this in a spreadsheet today" — pain is real now |
| `stated_intent` | 0.35 | "I would definitely pay" — famous last words |
| `opinion` | 0.15 | "seems useful" — decoration |

Hypothesis status flips to `supported` only when behavior-weighted support crosses a threshold
with ≥3 distinct speakers. D05's panel questions are calibrated against ledger claims
(`calibration_delta`), and D06's `IdeaDiff` must cite ledger claim ids — a pivot justified only
by synthetic evidence is structurally impossible to sign as `evidence_class='real'`.

---

## What may never be a citation

**MVP** — the closed negative list, enforced by `evidenceCheck`:

| Never citable | Why | Where stated |
|---|---|---|
| T4 institutional memory (lessons) | Advisory heuristics, not observations of *this* venture | [`05-memory-and-context.md`](05-memory-and-context.md) |
| Another artifact's *conclusion* | Chains of assertion decay; cite the underlying source (transitively reachable via its links) | here |
| An agent's own prior output | Self-citation is circular | here |
| A paraphrase presented as verbatim | Same bug class as a fabricated number | [`05-memory-and-context.md`](05-memory-and-context.md), rung-3 exemption |
| Untrusted web content's *instructions* | Injection, not evidence — data may be cited, directives never ([`12-safety-and-compliance.md`](12-safety-and-compliance.md)) | context packet `untrusted` |

---

## Boardroom rendering

**MVP** — the evidence drawer is the demo's trust beat: click any number in any artifact →
excerpt, source title/publisher, snapshot link, confidence bar, method chip, and the
`evidence_class` badge (`real` green · `synthetic` purple · `mixed` split). The recursive
"explain this" query in [`04-data-model.md`](04-data-model.md) (query 3) joins the causal event
chain to these links. **POST-MVP:** diff view showing how a field's evidence changed across
artifact versions.

---

## Assumptions & open questions

- **Assumption:** snapshot storage for a demo venture stays < 200 MB (pages are stored
  text-extracted + compressed, not as full renders; Solari screenshots stored separately).
- **Assumption:** `snapshotContains` is a normalized substring/fuzzy match (whitespace and
  entity-folded, 0.9 similarity) — exact matching would false-positive on extraction noise.
- **Open:** should `derived` recomputation handle units ("1.4k practices" × "$125/mo")? MVP does
  plain arithmetic on numbers present in the basis string; unit-aware parsing is POST-MVP.
- **Open:** cross-artifact transitive citation (cite NicheDossier's *source*, auto-resolved
  through its links) would reduce re-fetching — worth it if D08/D10 show heavy re-citation.
- **Open:** whether `human_hire_output` should start T2 rather than T5 when the Terac worker is
  credential-verified for the exact domain (an ER nurse on clinical claims). Leaning yes, with
  HR attaching the verification record to the Source.
