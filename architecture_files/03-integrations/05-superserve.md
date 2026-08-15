# 05 — Superserve (with sandbox0 as the open-source fallback driver)

> **Tier 1.** The substrate. Every department runs inside one of these; the demo's two best beats
> (the 2:10 counterfactual fork and the 3:30 shadow test) exist *because* of this integration.

---

## What it is

Superserve provides **long-lived agent sandboxes**: isolated execution environments built for agents
that run for hours, days, or months rather than a single request. The primitives we care about:

| Primitive | Why a months-long company needs it |
|---|---|
| **Pause / resume with state** | A venture cycle runs ~90s of compute, then waits hours for a webhook, a human reply, or a cron tick. Paying for idle VMs is how autonomous companies die of cost. |
| **Fork** | Copy a running department, state and all, to ask "what if we'd done the other thing?" without touching the original. |
| **Persistent filesystem** | D07's git repo, Solari session state, and node_modules survive between cycles. |
| **Long lifetime** | The sandbox *is* the department's body across the venture's whole life, not a per-task scratch container. |

The primitive Superserve sells: **"an agent's workspace that survives as long as the agent's job does."**

---

## Our creative angle

Most teams will use sandboxes to run code safely. Ours is structural, in three moves:

**1. Departments are pausable microVMs.** Each of D01–D13 leases exactly one sandbox for the life of
the venture. Between cycles the orchestrator pauses it; on a `WorkOrder`, webhook, or cron tick it
resumes *with the same filesystem, the same shell history, the same half-written analysis*. The
company literally sleeps between heartbeats. Cost drops from 13 always-on VMs to seconds-metered
compute — and the Boardroom's cost panel proves it.

**2. Fork is how the company thinks in counterfactuals.** At 2:10, D06 Pivot doesn't argue about
two `IdeaDiff`s in prose. It **forks the D03+D05 research state twice**, runs each branch's synthetic
panel and pricing scan in parallel, and presents the founder two *evidence-carrying futures* on a
Linq card. The rejected branch is discarded; the chosen one is promoted to mainline. No other
primitive gives you that.

**3. Fork is how the company grows safely.** At 3:30, D13 shadow-tests the new `D14-security-review`
department **in a fork of the live sales sandbox against the three actually-lost deals** before
deploying it to the mesh. New organs are tested on the company's own history, in a copy of the
company's own body, before they touch production.

> The pitch: a company that runs for months is defined by resume-with-state. Ours pauses between
> cycles and forks to ask "what if?"

---

## Which departments use it

All 13, uniformly — plus two special leases:

| Lease | Holder | Lifetime | Fork? |
|---|---|---|---|
| `dept:{D01..D13}` | Each department Head + its workers | Venture lifetime, mostly paused | D06/D13 may request forks of any dept lease |
| `build:{venture}` | D07's Claude Code session ([`15-anthropic-claude.md`](15-anthropic-claude.md)) | Build phase, then paused (not destroyed — bugfixes resume it) | Yes — Replay repro runs in a fork ([`07-replay.md`](07-replay.md)) |
| `browser:{venture}` | Identity service's Solari sessions ([`04-solari.md`](04-solari.md)) | Venture lifetime | Never — authenticated sessions must not be duplicated |

**Fork authority is restricted:** only D06 (counterfactuals) and D13 (shadow tests) may fork, per the
`fork-authority` policy below. A fork of a sandbox holding credentials gets its vault handles
**revoked at fork time** — a forked world may read state, but it may not spend money or send email.
That one rule is what makes counterfactuals safe.

---

## The lease model

The kernel never talks to a vendor SDK directly. `apps/orchestrator` owns leases via
`packages/sandbox` — the same driver-interface pattern as the bus ([`02-band.md`](02-band.md)).

```ts
// packages/contracts/src/sandbox.ts
export const SandboxLease = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  holder: z.string(),                    // 'dept:D03' | 'build:v_123' | 'browser:v_123'
  driver: z.enum(['superserve', 'sandbox0', 'docker']),
  vendor_sandbox_id: z.string(),

  state: z.enum(['provisioning','running','pausing','paused','resuming','forking','destroyed']),
  parent_lease_id: z.string().uuid().optional(),   // set iff this is a fork
  fork_purpose: z.enum(['counterfactual','shadow_test','bug_repro']).optional(),
  fork_ttl_minutes: z.number().int().optional(),   // forks ALWAYS expire; mainline never does

  spec: z.object({
    image: z.string(),                   // 'zeroth/dept-base:22' — Node 22 + agent-kit preinstalled
    cpu: z.number(), memory_mb: z.number(), disk_gb: z.number(),
    egress_allowlist: z.array(z.string()),  // doubles as Solari's domain allowlist
    env_handles: z.array(z.string()),    // vault handles, injected at resume, NEVER at fork
  }),

  metering: z.object({
    running_seconds: z.number(), paused_seconds: z.number(),
    usd_accrued: z.number(),             // → money.metered against the holder's department
  }),
  last_resumed_at: z.string().datetime().optional(),
  idle_pause_after_s: z.number().default(120),
});
```

```ts
// packages/sandbox/src/index.ts — THE interface. Three drivers, zero semantic difference.
export interface SandboxDriver {
  provision(spec: SandboxSpec): Promise<{ vendor_sandbox_id: string }>;
  exec(id: string, cmd: string, opts: { timeout_s: number }): Promise<ExecResult>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;                  // must restore fs + process state
  fork(id: string, opts: { strip_secrets: true }): Promise<{ vendor_sandbox_id: string }>;
  snapshot(id: string): Promise<{ snapshot_ref: string }>;   // durable, for disaster recovery
  destroy(id: string): Promise<void>;
  usage(id: string): Promise<{ running_s: number; usd: number }>;
}
```

**Lease lifecycle, driven by the scheduler:**

```
WorkOrder arrives for D03
   │
   ├─ lease exists, paused ──► resume() ──► inject vault handles ──► run Head loop
   ├─ lease exists, running ─► enqueue on the running loop
   └─ no lease ──────────────► provision() ──► lease row ──► run
                                     │
        Head loop reaches artifact boundary + idle 120s
                                     │
                     snapshot() every Nth pause (durability)
                                     ▼
                                  pause()  ──► metering: paused_seconds accrue at ~0 cost
```

**Metering invariant #6:** every `resume→pause` interval writes `money.metered(kind='sandbox_seconds',
department_id, usd)`. Sandbox time sits in the ledger next to tokens and Terac hires
([`03-stripe.md`](03-stripe.md)). The Boardroom shows "$0.9 sandbox · $3.2 tokens · $155 human".

---

## Fork semantics — the interesting 20%

**MVP** — the two on-stage fork paths:

### D06 counterfactual fork (2:10)

```
D06 Pivot needs to compare IdeaDiff A ("stay, narrow to ER nurses") vs B ("pivot to discharge coordinators")
   │
   ├─ fork(dept:D03, strip_secrets) ×2  → forks F_A, F_B  (ttl 30 min)
   ├─ F_A: re-run pricing scan + D05 synthetic panel under assumption A
   ├─ F_B: same under assumption B                       (parallel, ~60s)
   │
   ├─ Each fork emits artifacts tagged {fork_id, evidence_class: 'synthetic'|'mixed'}
   │     — fork-born artifacts NEVER enter the mainline registry directly
   ├─ D06 composes PivotBrief{a: F_A.summary, b: F_B.summary, recommendation}
   ├─ Linq card to founder with both futures            (06-linq.md)
   └─ on decision: chosen fork's artifacts are re-emitted onto mainline WITH provenance
       {promoted_from_fork: F_A}; loser fork destroyed at ttl. Nothing merges silently.
```

### D13 shadow test (3:30)

```
D13 has written D14-security-review.yaml
   │
   ├─ fork(dept:D10, strip_secrets)  → F_S (ttl 20 min)
   ├─ deploy candidate D14 into F_S only
   ├─ replay the 3 lost-deal WorkOrders from the event store into F_S
   ├─ score: did D14's questionnaire responses pass the rubric gate (≥0.85)?
   │     rubric machinery reused from simit's validate binary (see worker brief)
   ├─ pass → deploy D14 to mainline, register on mesh (02-band.md)
   └─ fail → CapabilityGap stays open; D13 revises the manifest; founder informed, not blocked
```

**Fork rules (all drivers, enforced in `packages/sandbox`, not trusted to the vendor):**

1. **Secrets never fork.** `env_handles` are dropped; the vault refuses handle dereference from any
   lease with `parent_lease_id` set. Forks can read, think, and simulate — not act externally.
2. **Forks always have a TTL.** Reaper destroys expired forks and emits `sandbox.fork_reaped`.
3. **Fork artifacts are quarantined** until explicitly promoted with provenance.
4. **Egress in forks is read-only-allowlist**: research domains yes, `api.stripe.com` no.
5. Every fork emits `sandbox.forked {parent, purpose, ttl}` — the Boardroom draws it as a branching
   timeline, which is exactly the visual the 2:10 beat needs.

**POST-MVP:** fork-diff tooling (what diverged between F_A and mainline), fork trees deeper than 1.

---

## Integration spec

> **ASSUMPTION:** Superserve is a new sponsor and we could not verify a public API reference at the
> time of writing. Everything below the driver interface is our *design* of a plausible surface,
> extrapolated from "long-lived agent sandboxes" positioning. (unverified — confirm at hackathon)
>
> **VERIFY AT HACKATHON (Superserve booth, day one, first hour — this is the substrate, it gates everything):**
> 1. SDK/API: REST, gRPC, or SDK-only? Node/TS support?
> 2. **Does pause/resume preserve process state (true microVM snapshot) or filesystem only?**
>    Fs-only is fine — our Heads checkpoint at artifact boundaries anyway — but it changes the
>    resume path from "continue" to "re-enter loop from checkpoint".
> 3. **Is fork a first-class op?** If not: snapshot + provision-from-snapshot is our fork. Get the
>    latency of both (the 2:10 beat budget is ~10s to fork twice).
> 4. Max sandbox lifetime, idle policies, and whether paused sandboxes cost anything.
> 5. Egress controls: per-sandbox allowlist? (If not, we enforce egress in a sidecar proxy.)
> 6. Pricing per CPU-second and per GB-month of paused state; concurrency limits (we need ~15 live).
> 7. Snapshot export: can we pull a snapshot out (for the sandbox0 fallback path)?

### Assumed HTTP surface

```http
POST /v1/sandboxes                     { image, resources, env, network_policy } → { id }
POST /v1/sandboxes/{id}/exec           { cmd, timeout_s } → { exit_code, stdout, stderr }
POST /v1/sandboxes/{id}/pause          → 202
POST /v1/sandboxes/{id}/resume         → 202
POST /v1/sandboxes/{id}/fork           { strip_env: true } → { id: fork_id }
POST /v1/sandboxes/{id}/snapshots      → { snapshot_id }
GET  /v1/sandboxes/{id}/usage          → { running_seconds, usd }
DELETE /v1/sandboxes/{id}
```

All calls carry `Idempotency-Key: hash(lease_id, op, seq)`; all state transitions are mirrored as
`sandbox.*` events before the vendor call returns (event store first, always).

---

## sandbox0 — the open-source fallback driver

sandbox0 (`github.com/sandbox0-ai/sandbox0`) is an **open-source, Kubernetes-native runtime for
persistent, encrypted sandboxes for long-running AI agents**. Its model matches ours unusually well:
the runtime pod is replaceable while the **sandbox identity, writable rootfs checkpoints, and
`SandboxVolume` data are durable** — which is exactly the "the body is disposable, the state is not"
property our lease model needs.

| Our op | sandbox0 mapping |
|---|---|
| `provision` | Create sandbox with a durable identity + `SandboxVolume` |
| `pause` / `resume` | Rootfs checkpoint + pod teardown / pod recreate from checkpoint. Process state is lost; **our Heads already checkpoint at artifact boundaries, so resume = re-enter loop from checkpoint**. Same behavior we'd adopt if Superserve turns out fs-only. |
| `fork` | Checkpoint → new sandbox from checkpoint with a fresh identity, env stripped. Slower than a native fork (est. tens of seconds — measure) but semantically identical. |
| `snapshot` | Native checkpoint. |
| Metering | Pod CPU-seconds from the k8s metrics API → same `money.metered` writes. |

Why sandbox0 is the *named* fallback rather than plain Docker: it is the only fallback that preserves
the **persistence story** — encrypted durable state that outlives the runtime — so the demo narrative
("the company sleeps and wakes") survives a full Superserve outage. The plain `docker` driver
(snapshot = `docker commit`, fork = commit + run) remains as the local-dev driver only.

**Strategic note (see [`00-sponsor-strategy.md`](00-sponsor-strategy.md)):** sandbox0 is a sponsor,
but we do not pursue it as a separate track. It appears in our story honestly, as the open-source
driver behind the same `SandboxDriver` interface — one `driver: 'sandbox0'` column value, zero
architecture change. If a sandbox0 rep asks, we show them their runtime running D03 for real in the
fallback rehearsal, which is more respect than a logo slide.

---

## Failure modes and fallback

| Failure | Detection | Behavior |
|---|---|---|
| Superserve API down | Circuit breaker, 3 fails / 60s | New leases provision on `sandbox0` driver; existing paused leases restore from the **last exported snapshot** onto sandbox0. `sandbox: degraded` chip in the Boardroom. Heads notice nothing — they wake at a checkpoint either way. |
| Resume loses process state | Booth answer / observed | Already tolerated: Heads are checkpoint-reentrant by design. `last_checkpoint` lives in Postgres, not the sandbox. |
| Fork unsupported or too slow for 2:10 | Measured in rehearsal | Pre-warm: fork both branches during the 1:50 Terac beat (they're independent), reveal results at 2:10. Worst case, fork = snapshot+provision on sandbox0. |
| Fork leaks a secret | Vault audit: dereference attempt from a fork lease | Vault refuses (hard rule), emits `security.fork_secret_denied`, kills the fork. This is a *show-it-on-purpose* seed event, like Solari's allowlist abort. |
| Sandbox dies mid-cycle | exec heartbeat timeout | Lease → `provisioning`, restore from last snapshot, replay the in-flight `WorkOrder` (idempotent by `work_order_id`). One artifact of duplicate cost, zero duplicate side effects. |
| Runaway cost (agent loops hot, never idles) | Budget meter: dept sandbox spend > envelope | `dept.frozen` at next artifact boundary → force-pause. Standard budget invariant; nothing sandbox-specific. |
| Quota: can't hold 15 concurrent | Booth answer | Consolidate: one sandbox per *cluster* (discovery / build / revenue) instead of per department. The lease `holder` field already permits it. |

---

## Costs, permissions, rate limits

| Item | Estimate | Notes |
|---|---|---|
| 13 dept sandboxes, mostly paused, 4-min demo ×~30 rehearsals | **$5–15 total** | (unverified — confirm pricing at hackathon) |
| Build sandbox (Claude Code, hot for ~90s) | dominates compute | 2 vCPU / 4GB |
| Paused-state storage | ~13 × 2GB | Confirm if paused state is billed |
| Permissions | One API key, held by `apps/orchestrator` only | Departments cannot touch the sandbox API — they *live inside* sandboxes; only the orchestrator manages them. That inversion is itself a security boundary. |
| Rate limits | Unknown | Provisioning is the only bursty op; we pre-provision all 13 at venture creation, so steady-state is pause/resume only. |

---

## Demo beats

**Continuous.** The Boardroom's department cards show a sleep/wake glyph. Most of the company is
visibly *asleep* at any moment — that is the cost story told without narration.

**2:10 — the counterfactual.** Timeline branches on screen: two forks spin up, run, and produce two
futures side by side on the founder's Linq card. Narration: *"it didn't debate the pivot — it ran
both futures in forked copies of itself and showed the founder the evidence."*

**2:25 — the build.** Claude Code streams inside `build:{venture}`; the same sandbox pauses when the
deploy goes green and will wake only if Replay files a bug.

**3:30 — the shadow test.** D13's candidate department runs against the three lost deals in a fork
of Sales before it is allowed to exist on the mesh. *"New organs are tested in a copy of the body."*

---

## Contribution to the general prize

The general-prize criterion is "runs a business on its own." Superserve is why that claim survives
scrutiny: a business runs on **calendar time**, not request time. Pause/resume is the difference
between "an agent that did a 4-minute demo" and "a company that was napping between customer emails
and woke up when the webhook landed" — and fork is the difference between a company that *decides*
and one that *experiments*. Both are architecture, not vendor lock: the same claims hold on sandbox0.

---

## Track-winning pitch sentence

> **"A company that runs for months needs resume-with-state. Ours pauses between cycles and forks to
> ask 'what if we'd done the other thing?' — the pivot at 2:10 and the new department at 3:30 were
> both decided by running forked copies of the company against its own history."**

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Entire Superserve HTTP surface, fork latency, paused-state
  pricing, egress controls, concurrency quota.
- sandbox0 fork latency via checkpoint→provision: measure before relying on it for the 2:10 beat.
- Open: do we consolidate the 4 discovery departments into one sandbox if quotas are tight? Leaning
  yes (the lease model supports it), decide after the booth conversation.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`02-band.md`](02-band.md) (room snapshot on pause) ·
[`04-solari.md`](04-solari.md) (browser sessions live here) ·
[`07-replay.md`](07-replay.md) (bug repro in a fork) ·
[`15-anthropic-claude.md`](15-anthropic-claude.md) (Claude Code in the build sandbox)
