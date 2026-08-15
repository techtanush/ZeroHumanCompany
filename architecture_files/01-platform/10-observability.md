# 10 — Observability & Audit: Reconstruct Any Decision

One sentence: the company must be able to answer **"what happened, what did it cost, and why did
it decide that?"** for any moment in its life, from one immutable log — because a zero-human
company whose reasoning cannot be audited is a liability, not a product.

```
                          ┌──────────────────────────────────────────┐
   every agent, tool,     │            EVENT STORE (truth)           │
   gate, webhook ────────►│  events (append-only, hash-chained)      │
                          └───────┬──────────────────────┬───────────┘
                                  │                      │
                     ┌────────────▼───────┐   ┌──────────▼──────────┐
                     │  TRACES            │   │  METRICS            │
                     │  spans per venture │   │  Redis counters +   │
                     │  flow, dept, run   │   │  mv_* rollups       │
                     └────────────┬───────┘   └──────────┬──────────┘
                                  │                      │
                     ┌────────────▼──────────────────────▼──────────┐
                     │  Boardroom SSE · Alerts · D13 daily review   │
                     └──────────────────────────────────────────────┘
```

Upstream: [`03-event-bus.md`](03-event-bus.md) (taxonomy base),
[`04-data-model.md`](04-data-model.md) (`events`, `agent_runs`, `meters`).
Downstream: [`16-evaluation-framework.md`](16-evaluation-framework.md) (evals read traces),
[`13-permissions-and-policy.md`](13-permissions-and-policy.md) (`policy.evaluated` events),
[`15-error-handling-and-fallbacks.md`](15-error-handling-and-fallbacks.md) (alert-driven recovery).

---

## Structured event taxonomy

**MVP** — extends the [`03-event-bus.md`](03-event-bus.md) table. Every event is
`<domain>.<verb_past_tense>`, every payload has a Zod schema in
`packages/contracts/src/events/`. Unknown event types are rejected at `EventStore.append`.

| Namespace | Events (additions in bold) | Emitted by |
|---|---|---|
| `venture.*` | `created`, `mode_set`, `autonomy_changed`, `killed`, `resumed`, `milestone_reached` | kernel |
| `dept.*` | `work_order_issued`, `work_started`, `work_completed`, `work_failed`, `frozen`, `unfrozen` | kernel, orchestrator |
| `agent.*` | `started`, `tool_used`, `tool_failed`, `finished`, `retried`, `budget_exceeded`, **`context_packed`**, **`compaction_applied`**, **`handoff_written`** | agent-kit |
| `artifact.*` | `created`, `signed`, `superseded`, `contested`, **`validation_failed`** | kernel |
| `gate.*` | `opened`, `approved`, `rejected`, `redirected`, `timed_out`, `auto_approved`, **`executed`**, **`batched`** | gate engine |
| `policy.*` | **`evaluated`**, **`scope_violation`**, **`prohibited_attempted`** | policy engine |
| `escalation.*` | **`raised`**, **`climbed`**, **`resolved`**, **`abandoned`** | ladder |
| `identity.*` | **`ceremony_paused`**, **`ceremony_resumed`**, **`strategy_failed`**, **`credential_used`**, **`credential_granted`**, **`credential_revoked`**, **`credential_invalid`**, **`leak_suspected`** | identity service |
| `memory.*` | **`written`**, **`promoted`**, **`retrieved`** (sampled 1:10), **`degraded`** | memory service |
| `money.*` | `metered`, `budget_allocated`, `budget_exceeded`, `revenue_received`, `refunded`, `payout`, **`degraded`**, **`frozen`**, **`thawed`** | budget meter |
| `human.*` | `notified`, `replied`, `call_placed`, `call_completed`, `consent_recorded`, `dnc_added` | gateway-linq, voice |
| `terac.*` | `requisition_filed`, `hire_posted`, `worker_matched`, `work_delivered`, `paid` | D11 tools |
| `build.*` | `repo_created`, `commit_pushed`, `qa_started`, `qa_failed`, `qa_passed`, `deployed`, `rolled_back` | D07 tools |
| `sales.*` | `lead_created`, `sequence_started`, `reply_received`, `meeting_booked`, `deal_stage_changed`, `deal_won`, `deal_lost` | D09/D10 |
| `support.*` | `ticket_opened`, `ticket_resolved`, `signal_filed` | D12 |
| `cos.*` | `gap_detected`, `department_designed`, `shadow_test_run`, `department_deployed`, **`eval_gate_passed`**, **`eval_gate_failed`** | D13 |
| `error.*` | **`raised`**, **`retried`**, **`circuit_opened`**, **`circuit_closed`**, **`dead_lettered`**, **`replayed`** | see [`15-error-handling-and-fallbacks.md`](15-error-handling-and-fallbacks.md) |
| `bus.*` | `degraded`, `recovered` | bus |

### The envelope, restated with the observability fields

```ts
// packages/contracts/src/events/envelope.ts
export const EventEnvelope = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  ts: z.string().datetime(),
  type: z.string(),                       // validated against the registry
  actor_kind: z.enum(['agent','founder','system','webhook','human_hire']),
  actor_id: z.string(),
  department_id: DepartmentId.optional(),
  payload: z.record(z.unknown()),         // per-type Zod schema applied before append

  /* correlation — the audit spine */
  trace_id: z.string(),                   // venture-flow trace (see spans below)
  span_id: z.string().optional(),         // the span this event belongs to
  causation_id: z.string().uuid().optional(),   // event that directly caused this one
  correlation_id: z.string().uuid().optional(), // work order / gate / ceremony / call

  /* integrity */
  prev_hash: z.string(),                  // hash chain per venture (below)
  hash: z.string(),                       // sha256(canonical(this without hash))
});
```

**Payload size cap: 8 KB.** Larger payloads store the blob in object storage and reference it
(`{blob_uri, sha256, bytes}`). The log stays fast to replay and cheap to retain.

---

## Tracing spans across departments

**MVP** — OpenTelemetry-compatible span model, stored in Postgres (`spans` table), exported to an
OTLP endpoint when configured. The span tree mirrors the org tree:

```
trace: venture flow (trace_id, lives as long as the venture)
└── span: work_order D02→D03 "research_niches"          (correlation_id = work_order.id)
    ├── span: head market.head plan                     (agent_run)
    ├── span: worker market.demand#0                    (agent_run)
    │   ├── span: tool web_search "dental PMS pricing"  (tool invocation)
    │   └── span: tool apify.run_actor g2-reviews
    ├── span: worker market.demand#1
    ├── span: merge + evidence check
    ├── span: critic market.critic
    └── span: sign NicheDossier v1
```

```sql
CREATE TABLE spans (
  span_id         text PRIMARY KEY,            -- 16-hex
  trace_id        text NOT NULL,
  parent_span_id  text,
  venture_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN
                    ('work_order','agent_run','tool','gate','ceremony','webhook','cron','replay')),
  name            text NOT NULL,               -- 'D03.research_niches' | 'tool:web_search'
  department_id   text,
  agent_run_id    uuid,
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz,
  status          text CHECK (status IN ('ok','error','timeout','cancelled')),
  attrs           jsonb NOT NULL DEFAULT '{}'  -- {model, tokens_in, cost_usd, tool, http_status,…}
);
CREATE INDEX ON spans (trace_id, started_at);
CREATE INDEX ON spans (venture_id, kind, started_at DESC);
```

| Rule | Why |
|---|---|
| `trace_id` is minted at `venture.created` and never changes | "Show me everything this company ever did" is one index scan |
| Every `WorkOrder`, `Escalation`, `ArtifactReady` carries `trace_id` (already in [`03-event-bus.md`](03-event-bus.md)) | Cross-department causality without joins on time |
| Span context propagates into sandboxes via the run token; tool plane opens a child span per invocation | The expensive question "which tool call burned the budget" is a span query |
| Events reference `span_id` where one exists | Event ↔ span cross-navigation in the Boardroom |
| Webhooks open a root-less span joined to the trace via `correlation_id` lookup | Stripe's webhook doesn't know our trace; the order does |

**POST-MVP:** sampled span export to a hosted OTel backend; MVP keeps spans local because the
Boardroom is the primary trace viewer.

---

## Metrics

**MVP** — three layers, cheapest first. All named `zeroth.<area>.<metric>`.

### Layer 1: real-time counters (Redis, drives the UI)

| Key | Type | Source |
|---|---|---|
| `meter:{cycle}:{dept}` → `usd` | HINCRBYFLOAT | Budget meter ([`08-money-and-metering.md`](08-money-and-metering.md)) |
| `m:active_runs:{venture}` | gauge | orchestrator |
| `m:queue_depth:{dept}` | gauge | BullMQ |
| `m:gates_pending:{venture}` | gauge | gate engine |
| `m:errors:{dept}:{class}` | counter, 5m window | error handler |
| `m:circuit:{tool}` | gauge (0 closed, 1 open, 2 half) | circuit breakers |

### Layer 2: per-department / per-agent / per-tool rollups (Postgres MVs, 5s refresh)

```sql
CREATE MATERIALIZED VIEW mv_agent_perf AS
SELECT venture_id, department_id, agent_id, model_tier,
       count(*)                                          AS runs,
       count(*) FILTER (WHERE status='ok')               AS ok,
       count(*) FILTER (WHERE status IN ('failed','timeout')) AS failed,
       avg(EXTRACT(EPOCH FROM finished_at - started_at)) AS avg_duration_s,
       sum(cost_usd)                                     AS cost_usd,
       sum(tokens_in + tokens_out)                       AS tokens
FROM agent_runs GROUP BY 1,2,3,4;

CREATE MATERIALIZED VIEW mv_tool_perf AS
SELECT venture_id,
       attrs->>'tool'                                    AS tool,
       count(*)                                          AS calls,
       count(*) FILTER (WHERE status='error')            AS errors,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ended_at - started_at)) AS p50_s,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ended_at - started_at)) AS p95_s,
       sum((attrs->>'cost_usd')::numeric)                AS cost_usd
FROM spans WHERE kind='tool' GROUP BY 1,2;
```

### Layer 3: the metric catalog (what we actually watch)

| Metric | Dimension | Target / alert |
|---|---|---|
| `work_order.duration_s` p95 | department | < 1.5 × `sla.soft_deadline_s` |
| `work_order.fail_rate` | department | < 10% / cycle |
| `artifact.contested_rate` | department | < 15%; rising ⇒ critic and Head are diverging |
| `artifact.partial_rate` + mean `gaps[]` length | department | trend only; spikes mean a tool or source died |
| `agent.retry_rate` | agent_id | < 20% |
| `tool.error_rate` | tool | < 5%; breaker opens at the threshold in [`15-error-handling-and-fallbacks.md`](15-error-handling-and-fallbacks.md) |
| `gate.time_to_decision_s` p50 | gate_type | founder responsiveness; informs `timeout_s` tuning |
| `gate.auto_approve_rate` | gate_type × autonomy | audited weekly by D13 — a drifting rate means policy drift |
| `cost.per_artifact_usd` | artifact type | vs the table in [`08-money-and-metering.md`](08-money-and-metering.md) |
| `cost.per_cycle_usd` | venture | ≤ `budgets.total_usd` |
| `escalation.rate` + `mean_rung_reached` | venture | rising rung = the company is getting stuck higher |
| `memory.retrieval_hit_rate` | department | retrieved-and-used / retrieved ([`05-memory-and-context.md`](05-memory-and-context.md) salience) |
| `bus.fallback_rate` | — | ~0; any sustained value means Band is down |
| `sse.lag_ms` | — | < 500ms, else the Boardroom is lying about "live" |

### Cost telemetry

Cost is not a separate pipeline — it *is* the meters table
([`08-money-and-metering.md`](08-money-and-metering.md)). Observability adds three read paths:

1. **Live burn line** — Redis counter deltas per second, streamed over SSE to the money panel.
2. **Attribution** — every span with `cost_usd` in attrs rolls up: trace → work order →
   department → venture. "This NicheDossier cost $3.81, of which $1.20 was `apify`" is
   `SELECT sum() ... GROUP BY attrs->>'tool'` over one trace.
3. **Anomaly hooks** — `cost.per_artifact_usd > 3× trailing median` raises `error.raised`
   (`class: cost_anomaly`) and pages D13, not the founder.

---

## The immutable audit log

**MVP** — the event store *is* the audit log, hardened three ways beyond
[`04-data-model.md`](04-data-model.md)'s append-only rules:

### 1. Hash chain per venture

```
hash(e_n) = sha256(canonical_json(e_n without hash) || hash(e_{n-1}))
```

`prev_hash` of the first event is `sha256(venture_id)`. Verification walks the chain:

```ts
// apps/kernel/src/audit/verify.ts
export async function verifyChain(ventureId: string): Promise<ChainReport> {
  let prev = sha256(ventureId), n = 0;
  for await (const e of eventStream(ventureId)) {          // ordered by seq
    if (e.prev_hash !== prev) return { ok: false, broken_at_seq: e.seq };
    const recomputed = sha256(canonical(omit(e, 'hash')) + prev);
    if (recomputed !== e.hash) return { ok: false, broken_at_seq: e.seq };
    prev = e.hash; n++;
  }
  return { ok: true, events: n, head: prev };
}
```

The chain head is written hourly to object storage (`audit/heads/{venture}/{ts}.json`) —
an external anchor a DB admin cannot silently rewrite. **POST-MVP:** anchor heads to a
public timestamping service.

### 2. Redaction before append, never after

The redactor ([`07-identity-and-accounts.md`](07-identity-and-accounts.md)) runs on the write
path. There is no "redact later" job because an immutable log cannot be redacted later — that is
the point. What must never enter the log is listed in
[`14-secrets-and-vault.md`](14-secrets-and-vault.md), "forbidden in logs".

### 3. Actor attribution is mandatory

`actor_kind` + `actor_id` are NOT NULL. `system` events name their principal
(`scheduler`, `kernel`, `webhook:stripe`). An event with a vague actor fails schema validation.

### Reconstructing any decision

Every decision in the company is one of four shapes, and each has a deterministic reconstruction
query:

| Decision shape | Reconstruction |
|---|---|
| **An agent chose X** | `agent_runs.decisions[]` (options, chosen, rationale) + the run's `ContextPacket` — `packet_id` is logged in `agent.context_packed`, the packet body is stored in object storage for 90 days. You see exactly what it knew, what it could do, and what it picked. |
| **Policy allowed/denied Y** | The `policy.evaluated` event: subject, resource, `rule_id`, `args_hash`. Deterministic — re-running `evaluate()` on the same inputs must return the same `rule_id` (asserted in CI). |
| **A gate approved Z** | `gate.opened` (frozen action bytes + preview) → `gate.approved` (decider, option) → `gate.executed` (result ref). The founder approved these bytes; here they are. |
| **Treasury moved money** | `money.budget_allocated` + `budget_allocations.rationale` + the deterministic score inputs (`mv_department_spend`, value weights) — recompute the scores from the same cycle's data and they must match ([`08-money-and-metering.md`](08-money-and-metering.md)). |

The Boardroom's "Explain this" drawer runs the recursive causation query from
[`04-data-model.md`](04-data-model.md) (query 3) and renders the chain: *event → causing event →
… → the founder action or cron tick at the root.* Every chain terminates at an external
stimulus. If it doesn't, the log is broken — CI has a property test for this on the demo seed.

---

## Structured logging

**MVP** — logs are for operators; events are for the company. Logs never carry authority.

```ts
// packages/agent-kit/src/log.ts — pino, one JSON line per record
log.info({
  msg: 'tool.invoke',
  trace_id, span_id, venture_id, department_id, agent_run_id,
  tool: 'composio.gmail.send', duration_ms: 412, status: 'ok',
});
```

| Rule | Enforcement |
|---|---|
| Every line carries `trace_id` when in a request/run context | lint rule on the logger wrapper |
| No payload bodies at `info`; bodies only at `debug`, and `debug` is off in demo/prod | logger config |
| The redactor runs on every line (`pino` serializer) | shared serializer |
| Log levels: `error` pages, `warn` dashboards, `info` traces, `debug` local only | alerting config |

---

## Alerting rules

**MVP** — alerts route to three audiences. **The founder is only paged through existing gate and
escalation channels** — alerting never becomes a second, unbatched path to their phone
([`06-human-in-the-loop.md`](06-human-in-the-loop.md), batching).

| Audience | Channel | Alerts |
|---|---|---|
| **D13 Chief of Staff** (first responder) | `cos.gap_detected` / work order | cost anomaly, contested-rate spike, breaker open > 10m, mean rung rising, eval-gate failure |
| **Operators (us)** | console + ntfy webhook | kernel down, DB errors, chain verification failure, SSE lag > 2s, queue depth > 100, dead-letter arrivals |
| **Founder** | existing Linq gates/escalations only | runway < $2 (via D11 card), venture frozen, credential invalid (reconnect card) |

```yaml
# apps/kernel/src/alerts/rules.yaml
- id: tool_circuit_stuck_open
  when: metric(m:circuit:{tool}) == 1 for 10m
  emit: {event: cos.gap_detected, severity: degrading, route: D13}
- id: audit_chain_broken
  when: verifyChain().ok == false
  emit: {event: error.raised, class: integrity, route: operators, page: true}
- id: cost_anomaly
  when: cost.per_artifact_usd > 3 * median_trailing(10)
  emit: {event: error.raised, class: cost_anomaly, route: D13}
- id: sse_lag
  when: sse.lag_ms p95 > 2000 for 5m
  emit: {route: operators}
- id: gate_starvation
  when: gates_pending > 0 and time_to_decision_s p50 > 4 * timeout_s
  emit: {event: escalation.raised, reason: needs_human, route: ladder}
```

Alert dedup: one open alert per `(rule, scope)`; re-firing extends, never re-pages.

---

## Dashboards

**MVP** — the Boardroom *is* the dashboard product; two operator views ride the same projections.

| Dashboard | Contents | Backed by |
|---|---|---|
| **Boardroom floor plan** | room state, spend vs envelope, active agents, escalation chips, thrift-mode chips | floor-plan query ([`04-data-model.md`](04-data-model.md) query 1) via SSE |
| **Money panel** | live burn, per-dept envelopes, runway, cost-per-artifact, Treasury rationale verbatim | `mv_department_spend`, `budgets` |
| **Ops: company health** (operator route `/ops`) | queue depths, breaker states, error rates by class, bus transport mix, SSE lag | Redis gauges + `mv_tool_perf` |
| **Ops: agent quality** | `mv_agent_perf` grid, contested/partial rates, retry rates, eval-gate history | `mv_agent_perf`, [`16-evaluation-framework.md`](16-evaluation-framework.md) results |
| **Trace explorer** | span tree per work order, cost attribution, linked events | `spans` + `events` |

**POST-MVP:** Grafana on the OTLP export for long-horizon trends across ventures.

---

## Log & data retention

**MVP** — retention is a policy table, enforced by a nightly job. The event log's *content* rules
(PII, deletion requests) are in [`12-safety-and-compliance.md`](12-safety-and-compliance.md);
this table is the *durations*.

| Data | Retention | Rationale |
|---|---|---|
| `events` | venture lifetime + 7 years | it is the books of the company |
| `spans` | 30 days full, then downsampled to work-order-level rollups | volume |
| `agent_runs` (incl. `decisions`) | venture lifetime | decision reconstruction |
| ContextPackets (object storage) | 90 days | debugging + evals; big |
| Structured logs | 14 days | operator debugging only |
| Redis counters | cycle + 1 | rebuilt from meters anyway |
| Tool response cache (replay) | 30 days | replay window |
| Call recordings / transcripts | per consent + [`12-safety-and-compliance.md`](12-safety-and-compliance.md) retention map | law, not convenience |
| Audit chain heads | forever | tamper evidence |

Deletion requests (GDPR/CCPA) do **not** delete events — they crypto-shred the PII referenced by
events, per the mechanism in [`12-safety-and-compliance.md`](12-safety-and-compliance.md). The
chain stays intact because hashes cover ciphertext references, not plaintext PII.

---

## SSE: how "live" reaches the Boardroom

**MVP** — one SSE channel per venture (`GET /v1/ventures/:id/stream`,
[`17-api-contracts.md`](17-api-contracts.md)). The kernel fans out from the bus via Redis pub/sub.
Every SSE frame is an event envelope (or a coalesced batch ≤ 100ms window). The client keeps
`last_seq` and reconnects with `Last-Event-ID`; the kernel replays the gap from Postgres. **The
Boardroom never renders anything that is not an event** — restated from
[`03-event-bus.md`](03-event-bus.md) because it is the whole honesty model of the UI.

---

## What D13 reads every day

The daily review (`cos.daily`) is an observability consumer, not a mystical judgment pass:

1. `mv_agent_perf` deltas vs trailing 7 cycles → flag degrading agents to
   [`16-evaluation-framework.md`](16-evaluation-framework.md) regression runs.
2. Treasury's falsifiable predictions (rationale strings) vs actuals → `cos.gap_detected` on miss.
3. Escalation ladder stats → capability gaps (things repeatedly reaching rung 3+ are missing
   capabilities by definition).
4. Gate auto-approve drift → policy recommendations (never policy changes; those gate).

---

## Assumptions & open questions

- **Assumption:** Postgres comfortably holds spans + events for hackathon scale (~20k events,
  ~60k spans per demo venture). The OTLP export path exists so nothing re-architects at scale.
- **Assumption:** hourly chain-head anchoring is enough tamper evidence for the demo; a judge who
  asks gets `verifyChain()` run live.
- **Open:** should `memory.retrieved` be fully logged instead of 1:10 sampled? Full logging makes
  "what did the agent know" exact but adds ~40% event volume. Leaning full-logging for Heads only.
- **Open:** span retention at 30 days may be too short if [`16-evaluation-framework.md`](16-evaluation-framework.md)
  regression suites want to replay months-old traces — may pin spans referenced by golden datasets.
- **Open:** whether `/ops` dashboards ship in the hackathon build or stay local-only. The floor
  plan and money panel are the demo; ops views are for us.
