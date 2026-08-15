# 15 — Error Handling & Fallbacks: How the Company Fails Well

One sentence: every failure is classified, retried on a known policy, circuit-broken per tool,
degraded per dependency, and — when all else fails — shipped as a `partial` artifact with honest
`gaps[]`, because **a company that fabricates under pressure is worse than one that stops**.

```
        error raised
             │ classify (taxonomy below)
             ▼
   transient? ──yes──► retry w/ backoff ──exhausted──► escalation ladder (06-human…)
             │no                                            │
             ▼                                              ▼
   tool down? ──yes──► circuit breaker ──► degraded mode per dependency
             │no                                            │
             ▼                                              ▼
   poison?  ──yes──► quarantine + DLQ            partial artifact + gaps[]
             │no
             ▼
   invariant broken? ──► freeze + page (never auto-recover a broken invariant)
```

Upstream: [`01-system-architecture.md`](01-system-architecture.md) (failure table),
[`03-event-bus.md`](03-event-bus.md) (idempotency), [`06-human-in-the-loop.md`](06-human-in-the-loop.md)
(the ladder). Downstream: [`10-observability.md`](10-observability.md) (`error.*` events, alerts),
[`18-state-machines.md`](18-state-machines.md) (failure transitions per machine).

---

## Failure taxonomy

**MVP** — every caught error is classified into exactly one class; the class determines the
policy. Unclassifiable errors default to `internal_bug` (fail safe, alert loud).

```ts
// packages/contracts/src/errors.ts
export const FailureClass = z.enum([
  /* transient — retry is correct */
  'net_transient',        // ECONNRESET, DNS blip, 502/503/504
  'rate_limited',         // 429 or provider-specific throttle
  'llm_overloaded',       // model 529/overloaded_error
  'lock_contention',      // FOR UPDATE timeout, Redis lock lost

  /* deterministic — retrying the same input is useless */
  'validation_failed',    // Zod parse fail on agent output or message
  'evidence_rejected',    // 11-evidence-and-truth check failed
  'policy_denied',        // 13-permissions decision; NOT an error to retry
  'auth_invalid',         // 401/403 — credential problem, not network
  'not_found',            // 404 on a resource we expected
  'insufficient_budget',  // 08-money admission failed

  /* capability — the input exceeds what we can do */
  'context_overflow',     // 05-memory rung 5
  'tool_unavailable',     // circuit open or tool not deployed
  'needs_human',          // ceremony pause, CAPTCHA, judgment call

  /* systemic */
  'timeout',              // soft_deadline or hard tool timeout
  'sandbox_lost',         // lease died, VM unreachable
  'poison_message',       // crashes its consumer reproducibly
  'internal_bug',         // unhandled exception, invariant violation
  'cost_anomaly',         // spend >3× expected (10-observability)
]);

export const FailureEvent = z.object({    // events: error.raised
  class: FailureClass,
  origin: z.string(),                     // 'tool:apify.run_actor' | 'agent:market.head' | 'kernel:reducer'
  message: z.string(),                    // redacted, ≤500 chars
  retryable: z.boolean(),
  attempt: z.number().int(),
  work_order_id: z.string().uuid().optional(),
  agent_run_id: z.string().uuid().optional(),
  provider_code: z.string().optional(),   // '429' | 'overloaded_error' — never the raw body
  trace_id: z.string(),
});
```

| Class group | Policy |
|---|---|
| transient | retry with backoff (below) |
| deterministic | **no retry.** Route: `validation_failed`/`evidence_rejected` → one revision with the violation in context ([`02-agent-runtime.md`](02-agent-runtime.md)); `auth_invalid` → credential flow ([`14-secrets-and-vault.md`](14-secrets-and-vault.md)); `policy_denied` → the agent proceeds without the action; `insufficient_budget` → `Escalation(needs_budget)` |
| capability | escalation ladder at the appropriate rung ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) |
| systemic | per-class runbook below; `internal_bug` never auto-retries side effects |

---

## Retry & backoff policy

**MVP** — one shared implementation (`packages/agent-kit/src/retry.ts`); nobody hand-rolls retry
loops.

```ts
export const RETRY_POLICY: Record<string, RetrySpec> = {
  net_transient:   { max: 3, base_ms: 500,  factor: 4, jitter: 'full', cap_ms: 30_000 },
  rate_limited:    { max: 4, base_ms: 2_000, factor: 3, jitter: 'full', cap_ms: 120_000,
                     honor_retry_after: true },              // provider header wins over our math
  llm_overloaded:  { max: 3, base_ms: 1_000, factor: 4, jitter: 'full', cap_ms: 60_000,
                     downgrade_on_final: true },             // last attempt may drop a model tier
  lock_contention: { max: 5, base_ms: 100,  factor: 2, jitter: 'full', cap_ms: 2_000 },
  timeout:         { max: 1, base_ms: 0,    factor: 1, jitter: 'none', cap_ms: 0 },
  // deterministic classes: max: 0 — the registry refuses a retry spec for them
};
```

Rules that keep retries safe:

| Rule | Why |
|---|---|
| Full jitter (`sleep = rand(0, min(cap, base·factor^n))`) | herds of workers retrying in sync is self-DDoS |
| Retry budget: ≤ 20% of a work order's wall clock may be spent sleeping | retries must not eat the SLA; exceeding it converts to `timeout` handling (`on_timeout` per manifest) |
| **Side-effecting calls retry only with the same idempotency key** | at-least-once delivery + exactly-once effect (below) |
| Each retry emits `error.retried` with attempt count | the Boardroom's "retrying…" chip and D13's retry-rate metric are real |
| Agent-level retries (whole run) follow the ladder rungs 0–1, not this table | LLM nondeterminism means a rerun *is* a different attempt; 2 tries then sibling ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) |
| `honor_retry_after` caps at 120s; longer ⇒ treat as circuit-open | a 15-minute Retry-After is an outage, not a retry |

---

## Circuit breakers per tool

**MVP** — one breaker per `(tool, venture)` in Redis, evaluated by the tool plane before every
invocation.

```ts
// apps/kernel/src/tools/breaker.ts
export const BREAKER = {
  window_s: 60,
  min_calls: 5,                 // no verdicts on tiny samples
  open_when: { error_rate: 0.5, or_consecutive: 4, or_p95_ms_over: 4 * baseline },
  open_for_s: 120,              // then half-open
  half_open_probes: 2,          // successes to close; any failure re-opens at 2× duration (cap 30m)
} as const;
```

```
CLOSED ──error threshold──► OPEN ──after open_for_s──► HALF_OPEN ──2 ok──► CLOSED
   ▲                                                        │ any failure
   └────────────────────────────────────────────────────────┘ (re-open, 2× duration)
```

| Behavior | Detail |
|---|---|
| Open breaker ⇒ `tool_unavailable` immediately | no queueing behind a dead tool; the agent gets the error in-context and can re-plan (different tool, or gap) |
| State transitions emit `error.circuit_opened` / `error.circuit_closed` | Boardroom chip + D13 alert at 10 min ([`10-observability.md`](10-observability.md)) |
| Breakers are per-venture | one venture hammering Apify must not blind another |
| LLM tiers are breaker-scoped too (`llm:opus`, `llm:sonnet`) | opus outage ⇒ automatic tier fallback, same path as budget degradation ([`08-money-and-metering.md`](08-money-and-metering.md)) |
| Gate-executed actions never trip on policy denials | `policy_denied` is not a tool failure |

---

## Degraded-mode behavior per dependency

**MVP** — the pre-decided plan for every dependency. "What happens when X is down" is a table,
not an incident-time debate.

| Dependency | Detection | Degraded behavior | Recovered by |
|---|---|---|---|
| **Band mesh** | publish error / health ping | transparent fallback to PG LISTEN/NOTIFY + BullMQ; `bus.degraded` chip ([`03-event-bus.md`](03-event-bus.md)) | auto; `bus.recovered` |
| **Claude API (a tier)** | breaker `llm:<tier>` | tier fallback opus→sonnet→haiku for workers; Heads hold one tier of headroom; if **all** tiers down: work orders park `queued`, sandboxes pause, nothing fails | breaker close |
| **Pioneer models** | breaker | documented fallback to `haiku` ([`02-agent-runtime.md`](02-agent-runtime.md)) | auto |
| **Superserve** | lease API errors | new leases go to local Docker driver (same interface); existing paused VMs wait — **fork/pause semantics degrade**: resident departments restart from last event instead of resuming warm | operator flag flip back |
| **Postgres** | connection pool errors | **hard stop.** The event store is the truth; without it nothing may act. Kernel returns 503, orchestrator suspends, in-flight agent output buffered to sandbox FS and replayed on recovery | reconnect + replay |
| **Redis** | conn errors | queues and counters degrade: scheduler falls back to PG polling (30s tick), real-time budget checks fall back to `mv_department_spend` (stale ≤5s), SSE fan-out falls back to per-client PG polling | reconnect |
| **Composio** | breaker per connector | affected tools unavailable; email-dependent departments ship partial with `gaps:['email_unavailable']`; **inbound** replies queue at the provider (Gmail holds mail) | breaker close |
| **Solari** | session create fails | ceremonies pause (`paused_for_human` optional path); scraping falls back to `web_fetch` where the target allows; D03 records `dead_source` in T2 | breaker close |
| **Stripe/Whop/Dodo webhooks** | webhook silence + reconcile job | hourly `finance.reconcile` polls the APIs; orders eventually consistent; revenue recognition delayed, never lost | webhook resumes |
| **Terac** | API errors | requisitions queue in `filed`; rung-5 escalations hold at rung 4 with the founder informed | auto |
| **Linq** | send failures | founder cards fall back to the Boardroom inbox + (if configured) plain SMS; gate `timeout_s` **pauses** while no delivery channel works — a gate must not time out unseen | send succeeds |
| **ElevenLabs / telephony** | call setup errors | voice interviews reschedule (calendar hold kept); D04 switches affected subjects to email interviews with a lower evidence tier | breaker close |
| **Render deploys** | deploy API errors | D07 ships preview-only; `deploy` gate blocked with `gaps:['prod_deploy_unavailable']` | breaker close |
| **Object storage** | put/get errors | snapshots buffer on sandbox FS (cap 100MB) and flush on recovery; evidence checks that need snapshots defer signing (artifact stays `draft`) | flush |
| **Embeddings (Voyage)** | job failures | already async — lexical retrieval carries on; `memory.degraded` chip ([`05-memory-and-context.md`](05-memory-and-context.md)) | backlog drain |

**The invariant under degradation:** evidence rules never relax. A department missing its tool
ships `partial` with `gaps[]`; it does not lower the bar
([`11-evidence-and-truth.md`](11-evidence-and-truth.md)).

---

## Partial artifacts and `gaps[]`

**MVP** — the universal pressure-release valve. Rules:

```ts
// packages/contracts/src/gaps.ts
export const Gap = z.string();            // machine-parseable: '<kind>:<pointer-or-name>'
// kinds: 'no_evidence:/tam_usd' | 'tool_down:apify' | 'no_budget:voice_minutes'
//        'unresolved_escalation:<id>' | 'coverage:dso_buyers' | 'context_overflow:<wo>'
```

| Rule | Effect |
|---|---|
| A required output field with no value ⇒ either the run fails validation **or** the field is null + a matching gap | no silent absence |
| `quality='partial'` requires `gaps.length > 0`; `signed` requires zero *blocking* gaps | enforced at sign time |
| Gaps propagate: `ArtifactReady.gaps` → downstream Heads receive them in inputs and must either close them, carry them forward, or mark them accepted | a gap cannot silently vanish; the critic checks gap accounting |
| Gate previews render inherited gaps | the founder approves knowing what's missing ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) |
| D13's daily review clusters recurring gaps → `CapabilityGap` | gaps are the raw material of self-improvement |

---

## Idempotency and exactly-once side effects

**MVP** — at-least-once delivery everywhere, exactly-once *effect* at the edges. Three layers,
extending [`03-event-bus.md`](03-event-bus.md):

### 1. Message consumption

`processed_messages (consumer, message_id)` — a consumer that has processed a message ACKs and
skips duplicates. Insert happens **in the same transaction** as the consumer's state change.

### 2. Side-effecting tools

```
idempotency_key = hash(work_order_id, action, target)      // 03-event-bus.md
```

| Provider | Mechanism |
|---|---|
| Stripe | native `Idempotency-Key` header |
| Terac | `terac_hires.idempotency_key UNIQUE` + provider-side job dedup |
| Composio email | our `sent_messages (idempotency_key UNIQUE, provider_message_id)` ledger — insert-before-send; a retry that finds the row with `provider_message_id` set skips; finds it unset ⇒ **status unknown** ⇒ query the provider Sent folder before resending |
| Render deploys | keyed on `(service, commit_sha)` — redeploying the same sha is naturally idempotent |
| Gate execution | `gates.idempotency_key UNIQUE (venture_id, …)` — an approved gate executes at most once ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)) |

The email row is the hard one and gets the full **write-ahead intent** pattern:

```ts
// send path: intent → send → confirm
await db.sent_messages.insert({ idempotency_key, status: 'intent' });    // unique violation ⇒ dedup
const r = await composio.gmail.send(args);
await db.sent_messages.update(idempotency_key, { status: 'sent', provider_message_id: r.id });
// crash between send and confirm ⇒ recovery finds status='intent' ⇒ reconcile against provider
```

### 3. Event append

`events.id` is client-generated (UUID) and the append is `ON CONFLICT DO NOTHING` — replaying a
producer cannot double-append.

---

## Poison-message handling and dead-letter queues

**MVP**

A **poison message** is one that reproducibly crashes or fails its consumer
(`validation_failed` on a bus message, reducer throw, or 2 consecutive `internal_bug` on the same
`message_id`).

```
BullMQ job fails ── attempt < max ──► standard backoff retry
        │ attempt = max, or poison signature detected early
        ▼
   DEAD-LETTER QUEUE  dlq:{queue_name}
        │  entry: {message, error_history[], first_seen, consumer, trace_id}
        ├──► emit error.dead_lettered  → operator alert (10-observability.md)
        ├──► blocked work order → status 'failed' → escalation ladder picks it up
        └──► weekly sweep: unclaimed DLQ entries > 7 days → archived to object storage
```

| Rule | Why |
|---|---|
| DLQ entries never auto-retry | a poison message that auto-retries is an infinite loop with extra steps |
| Replay is explicit: `pnpm kernel dlq replay <id> [--patched]` — optionally with a patched payload, recorded as a new event `error.replayed {original_id, patched: bool}` | audit trail of human intervention |
| A poison **event** (breaks a reducer) never blocks the log | the reducer skips it, records `(projection, seq)` in `projection_skips`, alerts; the fix is a reducer patch + projection version bump + rebuild ([`04-data-model.md`](04-data-model.md)) — the event is immutable and stays |
| Schema-invalid inbound webhooks go straight to DLQ, 200-ACKed where the provider retries aggressively (Stripe) | our bug shouldn't cause provider retry storms; the DLQ preserves the payload |
| One consumer's poison never blocks siblings | per-message dedup keys, not per-queue halts |

---

## Recovery & replay procedures

**MVP** — the operator runbook, each step scripted:

| Scenario | Procedure |
|---|---|
| **Kernel crash/restart** | boot → run migrations → verify chain heads → resume projections from `projection_offsets` → scheduler re-arms crons → in-doubt gates (`pending`, past `expires_at` during downtime) get `expires_at` extended by the downtime (timeouts must not fire unseen) |
| **Orchestrator crash** | on boot, reconcile leases: sandboxes with a live lease resume; orphaned `running` work orders (heartbeat > 2 min stale) → `attempt+1`, re-queued; agent output salvage from working-memory snapshots ([`05-memory-and-context.md`](05-memory-and-context.md)) |
| **Sandbox lost mid-run** | `sandbox_lost` → re-lease → resume from last event + WM snapshot; the run's reserved budget is re-checked (not double-reserved) via the existing reservation id |
| **Projection corruption** | `pnpm kernel rebuild --venture <id> [--projection <name>]` — truncate + replay (~4s per demo venture, [`04-data-model.md`](04-data-model.md)) |
| **Work-order replay (debugging)** | `replay(work_order_id)` re-runs with cached tool responses ([`02-agent-runtime.md`](02-agent-runtime.md)); side-effecting tools are **stubbed to their recorded results** — replay can never re-send an email |
| **In-doubt side effect** (crash between send and confirm) | reconciliation per tool: query provider state (Sent folder, Stripe API, Terac job) → confirm or mark failed → resume |
| **Full venture restore** | events are the backup: restore Postgres base + replay events → rebuild projections → re-verify chain → re-issue credential grants (old ones expired naturally) → resume sandboxes or cold-start departments |
| **Budget in-doubt** | expired `reservations` (`held` past `expires_at`) auto-release on a 60s sweep; `committed` without matching meters triggers a reconcile against `agent_runs.cost_usd` |

**The recovery invariant** (restated from [`01-system-architecture.md`](01-system-architecture.md)):
if the process dies at step N, restart replays to step N. Nothing restarts from zero; nothing
replays a side effect.

---

## What never auto-recovers

**MVP** — fail-frozen, human required:

| Condition | Behavior |
|---|---|
| Audit chain verification failure | freeze venture, page operators ([`10-observability.md`](10-observability.md)) — the log's integrity outranks uptime |
| `policy.scope_violation` (cross-venture access attempt) | freeze the offending department, page — this is a bug, not a retry |
| Canary secret resolution attempt | full credential rotation runbook ([`14-secrets-and-vault.md`](14-secrets-and-vault.md)), page |
| Two identical `internal_bug`s from the same agent in one cycle | freeze that agent's replica set for the cycle, file `cos.gap_detected` |
| Spend cap breach detected post-hoc (metering lag) | venture-wide freeze + founder card — never quietly absorb an overdraft |

---

## Assumptions & open questions

- **Assumption:** BullMQ's retry/backoff is configured per-queue from `RETRY_POLICY`, so queue
  behavior and in-process behavior share one policy table.
- **Assumption:** provider status pages are not polled; breakers infer health from our own
  traffic. Low-traffic tools may flap — `min_calls: 5` mitigates, tune from real usage.
- **Open:** should `llm_overloaded` final-attempt tier-downgrade apply to Heads? Currently workers
  only — a downgraded Head making judgment calls cheaply feels wrong; parking feels slow. Leaning:
  park Heads, downgrade workers.
- **Open:** DLQ replay with a patched payload edits reality post-hoc — it is evented and audited,
  but should it require a founder-visible note for messages that carry money or outbound content?
  Probably yes, POST-MVP.
- **Open:** the Linq-down + Boardroom-unwatched case pauses gate timeouts indefinitely; a venture
  can stall silently for days. POST-MVP: an email fallback channel of last resort for founder
  notification.
- **POST-MVP:** chaos testing (kill the orchestrator mid-fan-out in CI and assert recovery),
  cross-region Postgres failover, and per-tool synthetic canary probes to close the low-traffic
  breaker gap.
