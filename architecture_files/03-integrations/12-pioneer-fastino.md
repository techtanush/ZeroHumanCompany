# 12 — Pioneer (Fastino Labs)

> **Tier 2.** The company's classifiers get better every venture: small specialist models trained on
> our own event log, promoted onto live traffic only after beating Claude on our own evals.

---

## What it is

Pioneer, by Fastino Labs, is a platform to **fine-tune, evaluate, and deploy small language models**
with OpenAI- and Anthropic-compatible endpoints. Verified against `docs.pioneer.ai` (2026-08):

- **Drop-in inference:** point an existing OpenAI/Anthropic client at Pioneer; `POST /inference`.
- **Model families:** encoder models for structured tasks — **GLiNER2 Large** (NER, text
  classification, structured JSON extraction), GLiGuard (safety), GLiNER2-PII (PII detection) — and
  decoder LLMs (Nemotron 3.5 Lightning for LoRA training, DeepSeek V4 Flash, GLM 5.2), plus
  proprietary passthrough (Claude, GPT) on compatible endpoints. `GET /base-models` lists them.
- **Training:** `POST /felix/training-jobs` runs LoRA fine-tunes on uploaded (or synthetic-generated)
  labeled data, returning F1/precision/recall.
- **Evaluation:** `POST /felix/evaluations` benchmarks a fine-tune against the base, surfacing lift,
  cost, and latency before any traffic routes to it; bring-your-own evals supported.
- **Adaptive Inference:** mines live production failures, retrains automatically, promotes improved
  checkpoints behind the same endpoint — with full PDF audit reports, and **routing controlled by
  the customer**. Weights and datasets are downloadable — they are ours.

---

## The exact product problem it solves

Zeroth makes thousands of **high-volume, low-judgment** LLM calls per venture: score this lead,
classify this ticket, rate this claim, rank this message variant. On Claude (even `haiku`) these
calls are (a) the bulk of token cost at scale, (b) latency-bound in hot loops (D05 archetype
polling batches, D09 scoring hundreds of leads), and (c) no better for the extra model capacity —
a 7-class ticket triage does not need frontier reasoning.

Invariant #6 says the company knows what it costs. The *corollary* is that a company that knows its
costs should **lower them where quality permits** — and prove the "quality permits" part. Pioneer is
that mechanism: specialist small models for the four classification paths below, trained on the
company's own labeled history, promoted only through an eval gate.

---

## Which departments use it

The four target paths, chosen because each produces its **own labels as a byproduct of operating**:

| Path | Dept | Task (model family) | Ground-truth label source (from our event log) |
|---|---|---|---|
| **ICP fit scoring** | D09 | `Lead → {fit_score bucket, disqualify_reason?}` (GLiNER2 classification) | What happened downstream: replied / meeting / won / lost / bounced — `sales.*` events |
| **Claim strength** | D04 | `Claim → {strong, weak, contradicted, unsupported}` (GLiNER2) | D04 Head's adjudications + Terac expert verdicts ([`01-terac.md`](01-terac.md)) — the `ClaimLedger` audit trail |
| **Ticket triage** | D12 | `Ticket → {category × severity × routing}` (GLiNER2) | Final resolved category/severity after handling — `support.*` events |
| **Archetype polling** | D05 | Persona-conditioned survey response for simpop's ~12 archetypes (Nemotron LoRA) | Post-stratified panel results already validated against real outcomes (simit's backtests, per the worker brief) + Terac calibration panels |
| **Message-variant ranking** | D08/D10 | `variant pair → preferred` (GLiNER2 or LoRA reward-style) | Realized open/reply/click events from Composio-sent sequences ([`13-composio.md`](13-composio.md)) |

**The flywheel, stated once:** every one of these labels is emitted by the company doing its normal
work. The event store *is* the training set. Nobody annotates anything.

---

## Technical integration

### Where it sits in the model tier table

Pioneer slots under the routing table in [`15-anthropic-claude.md`](15-anthropic-claude.md) /
`../01-platform/02-agent-runtime.md`. Every classify-shaped tool call goes through one dispatcher:

```ts
// packages/agent-kit/src/classify.ts — ONE entry point for all classification paths
export async function classify<T>(path: ClassifyPath, input: unknown): Promise<Scored<T>> {
  const route = routingTable.get(path);        // 'pioneer:iCP-fit-v3' | 'haiku' | 'sonnet'
  const t0 = Date.now();
  const out = route.startsWith('pioneer:')
    ? await pioneer.inference({ model: route.slice(8), input, schema: schemas[path] })  // POST /inference
    : await claude(route, prompts[path], input);
  emit('model.inference', { path, route, latency_ms: Date.now() - t0,
                            usd: cost(route, out.usage), confidence: out.confidence });
  // Below-floor confidence falls THROUGH to the next tier, and both calls are logged:
  if (out.confidence < CONF_FLOOR[path]) return classify(path, input, nextTier(route));
  return out;
}
```

Three properties: the **route is data** (a table row, hot-swappable per path); every inference is a
metered event (`pioneer:*` shows in the cost panel next to `haiku` — the 3:15 visual); and
**low-confidence answers escalate to Claude automatically**, so a small model can only ever make the
easy calls it has proven it makes well.

### Training-data extraction from the event log

```sql
-- ICP-fit example: features at scoring time joined to outcome ≥14 days later
SELECT l.snapshot_features AS input,
       CASE WHEN d.stage IN ('won','meeting')          THEN 'high'
            WHEN e.replied_at IS NOT NULL              THEN 'medium'
            WHEN e.bounced OR d.stage = 'disqualified' THEN 'low' END AS label
FROM lead_snapshots l
LEFT JOIN sequence_events e USING (lead_id)
LEFT JOIN deals d USING (lead_id)
WHERE l.venture_id = ANY($ventures)          -- cross-venture: the platform learns, not the venture
  AND l.scored_at < now() - interval '14 days';
```

Labels are **outcomes, not model opinions** — we never train a student on the teacher's guesses
alone (that only distills bias). Where outcome labels are thin at hackathon scale, we bootstrap:
seeded synthetic ventures run through the full pipeline pre-event generate a few thousand labeled
rows per path, honestly tagged `label_source: 'seed_run'`; Pioneer's synthetic data generation can
extend a labeled set from a domain description where volumes are thin (their documented feature).

Datasets upload per path; `POST /felix/training-jobs` runs the LoRA/GLiNER fine-tune; returned
F1/precision/recall land as a `ModelCandidate` artifact.

### The eval gate — no small model touches live traffic without beating Claude

This is the part that makes it Zeroth and not a cost hack. Promotion is a **gated decision with
evidence**, exactly like every other irreversible-ish action:

```
ModelCandidate (training complete)
   │
   ├─ 1. Pioneer eval (POST /felix/evaluations): candidate vs base — lift, cost, latency
   ├─ 2. OUR eval: frozen holdout of ≥200 rows per path (real outcomes, never trained on)
   │       candidate vs CURRENT ROUTE (i.e., vs haiku/sonnet, not vs a base model):
   │       agreement-with-outcome, calibration (Brier), per-class recall on the classes
   │       that cost money when wrong (e.g. 'high'-fit precision — false positives burn
   │       outreach sends and reputation)
   ├─ 3. PROMOTION RULE (per path, in config, visible in the Boardroom):
   │       accuracy_candidate ≥ accuracy_current − ε(path)        // ε: 0 for claim-strength,
   │       AND cost_per_call ≤ 0.2 × current                      //    0.02 for triage
   │       AND p95_latency ≤ current
   ├─ 4. Decision recorded {path, metrics table, verdict}; D13 is the approver —
   │       model routing is a capability change, and capability changes are D13's jurisdiction
   ├─ 5. SHADOW WEEK (demo: shadow minutes): candidate runs on live traffic with outputs
   │       logged-not-used; disagreements with the current route sampled and adjudicated
   └─ 6. Promote: routingTable[path] = 'pioneer:{model}'  → emit cos.model_promoted
        Demote: automatic, if rolling agreement-with-outcome drops below floor for N calls
                (the same monitor that promoted it; demotion needs no meeting)
```

Adaptive Inference then keeps mining live failures and retraining **behind the same endpoint** — but
its promoted checkpoints still pass through step 5–6 on our side, because *we* control routing (a
control Pioneer explicitly leaves to the customer). The PDF audit report attaches to the `Decision`.

---

## User-facing experience

Founders never see Pioneer. They see the digest line D13 writes after a promotion: *"Ticket triage
now runs on a specialist model trained on your support history — 21× cheaper, slightly more
accurate. Claude still handles the hard ones."* Judges see the 3:15 cost panel: `pioneer:triage-v2
$0.0004/call` next to `haiku $0.009/call`, with call counts, and the promotion `Decision` one click
away showing the eval table that justified it.

---

## Why the use case is novel

Three claims no checkout-integration team can make: the **training data is the exhaust of the
business itself** (outcome labels from the event log, cross-venture, so venture #2 starts smarter
than venture #1 — that is D13's continuous-improvement mandate made concrete); **promotion is
governed like spend** (an eval gate with a recorded decision, shadow traffic, and automatic
demotion — the same institutional shape as HR's ROI rule); and the **cost story closes the loop
with Treasury** — cheaper inference literally raises the budget envelopes Treasury can allocate
from the same revenue ([`03-stripe.md`](03-stripe.md)). The company doesn't use small models; it
*industrializes* them.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Fine-tune + deploy on Pioneer | Three GLiNER/LoRA fine-tunes trained on our own event-log data, served via `POST /inference` |
| Eval rigor | Their eval API + our outcome-holdout gate + shadow traffic + auto-demotion |
| Live on stage | 3:15 cost panel shows `pioneer:*` routes serving real calls during the demo |
| The sentence | "The high-volume, low-judgment calls got 20× cheaper and *more* accurate the longer the company ran." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Training cost/latency | LoRA jobs on small models are minutes-to-hours scale (unverified — confirm exact times at hackathon). All training happens pre-demo; the demo shows serving + the recorded promotion decisions. |
| Data volume | Hackathon-scale outcome labels are thin; mitigated by seed runs + Pioneer synthetic generation, both honestly labeled. Small models on narrow tasks are the regime where hundreds of examples genuinely work — this is the one place that fact helps us. |
| Data governance | Training rows contain lead/customer-derived features → **GLiNER2-PII pass redacts before upload** (their own PII model, used on the way in — a nice closed loop). Weights/datasets downloadable and deletable; retention terms (unverified — confirm at hackathon). |
| Inference SLA / rate limits | Quotas and p95 under load (unverified — confirm at hackathon). The confidence-floor fall-through means a slow/failed Pioneer call degrades to `haiku`, never to a dropped classification. |
| Wrong-call blast radius | Bounded by design: promoted paths are advisory/low-judgment; every money- or people-facing consequence downstream still passes its own gates. A bad triage wastes minutes, not dollars. |
| Pricing | Per-call and training pricing (unverified — confirm at hackathon); modeled in config like every other vendor fee. |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Pioneer inference down | Routing table falls back per path to the previous tier (`haiku`/`sonnet`) — **zero behavioral change**, the tier table was serving those routes yesterday. `model: fallback` chip; cost panel shows the delta, which is itself a nice honest beat. |
| Training/eval API down | Promotion pipeline pauses; live routing unaffected (routes only change through the gate anyway). |
| Model quality regresses live | Auto-demotion monitor (step 6) — no vendor dependency; it's our event-log agreement metric. |
| On stage | The 3:15 beat reads from the meters, which are our data. Even in total Pioneer absence the promotion `Decision` records + cost history render; only live `pioneer:*` calls would be missing, and the fallback chip explains it. |

---

## Contribution to the general prize

The hackathon asks for a company that *executes with little to no human input* — the judges' sharper
question is whether it can do so **economically and increasingly well**. Pioneer is Zeroth's answer
to "does the company improve?": measurable, governed self-improvement (cheaper unit economics,
outcome-verified accuracy, automatic demotion) rather than the vibes version. It is also the
concrete mechanism behind D13's thesis that the platform compounds across ventures — venture #2's
lead scoring is trained on venture #1's outcomes.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Pricing, training-job latency, inference quotas/SLA, data
  retention terms, synthetic-generation quality on our label taxonomies.
- Open: is the D05 archetype-polling LoRA (persona-conditioned generation, not classification) demo
  scope, or POST-MVP? It is the most differentiated path but the hardest to eval-gate honestly on
  hackathon timelines. Default: POST-MVP; the three GLiNER classification paths are MVP.
- Open: exact ε values per path in the promotion rule — set from the seed-run baseline, not a priori.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`15-anthropic-claude.md`](15-anthropic-claude.md) (the tier table Pioneer routes under) ·
[`01-terac.md`](01-terac.md) (expert verdicts as claim-strength labels) ·
[`13-composio.md`](13-composio.md) (send/reply events as ranking labels) ·
[`03-stripe.md`](03-stripe.md) (cheaper inference → bigger envelopes)
