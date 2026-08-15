# 01 — System Architecture

## The whole picture

```
                            ┌──────────────────────────────────────┐
   FOUNDER ── iMessage ────►│  LINQ gateway  (rich approval cards) │
      │                     └──────────────┬───────────────────────┘
      │ browser                            │ webhook
      ▼                                    ▼
┌─────────────────────┐          ┌────────────────────────────────────────────┐
│  BOARDROOM (Next.js)│◄── SSE ──│              COMPANY OS  (kernel)          │
│  isometric floorplan│          │                                            │
│  approval cards     │──REST───►│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  evidence drawer    │          │  │ Event    │ │ Artifact │ │ Gate       │  │
└─────────────────────┘          │  │ Store    │ │ Registry │ │ Engine     │  │
                                 │  └──────────┘ └──────────┘ └────────────┘  │
                                 │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                                 │  │Scheduler │ │ Budget   │ │ Identity   │  │
                                 │  │ + Queue  │ │ Meter    │ │ Vault      │  │
                                 │  └──────────┘ └──────────┘ └────────────┘  │
                                 └───────────────┬────────────────────────────┘
                                                 │  BUS  (Band mesh ▸ PG fallback)
        ┌────────────────────────────────────────┼────────────────────────────────┐
        ▼                    ▼                   ▼                ▼               ▼
 ┌────────────┐      ┌────────────┐      ┌────────────┐   ┌────────────┐  ┌────────────┐
 │ D01 Intake │      │ D03 Market │      │ D07 Build  │   │ D10 Sales  │  │ D13 CoS    │  ...
 │ sandbox    │      │ sandbox    │      │ sandbox    │   │ sandbox    │  │ sandbox    │
 │ (Superserve Firecracker microVM, pausable, forkable)                                  │
 └─────┬──────┘      └─────┬──────┘      └─────┬──────┘   └─────┬──────┘  └─────┬──────┘
       │                   │                   │                │               │
       └───────────────────┴─────────┬─────────┴────────────────┴───────────────┘
                                     ▼
                        ┌───────────────────────────┐
                        │      TOOL PLANE           │
                        ├───────────────────────────┤
                        │ Composio (Gmail, LinkedIn,│
                        │  Calendar, GitHub, Slack) │
                        │ Solari (computer use)     │
                        │ Apify / search / scrape   │
                        │ ElevenLabs (voice)        │
                        │ Stripe · Whop · Dodo      │
                        │ Terac (hire humans)       │
                        │ Replay · Render · Lovable │
                        │ Pioneer (small models)    │
                        │ SimPop service (Rust)     │
                        └───────────────────────────┘
```

## Services and what each owns

| Service | Runtime | Owns |
|---|---|---|
| `apps/boardroom` | Next.js 15 (App Router), React 19, Tailwind | UI, SSE stream, approval UX, evidence drawer |
| `apps/kernel` | Node 22, Fastify | Event store API, artifact registry, gates, scheduler, budget meter, vault |
| `apps/orchestrator` | Node 22 worker | Pulls WorkOrders, provisions sandboxes, runs Heads, enforces budgets |
| `services/simpop` | **Rust + axum + SQLite** (ported from `simit`) | Census PUMS sampling, archetype clustering, post-stratified polling |
| `services/voice` | Node + ElevenLabs + telephony | Outbound calls, live transcription, claim extraction hooks |
| `services/gateway-linq` | Node | Linq webhooks in/out, card rendering, reply routing |
| `packages/agent-kit` | TS lib | Agent base classes on `@anthropic-ai/claude-agent-sdk`, tool allowlists, retries |
| `packages/contracts` | TS lib | **Zod schemas for every artifact, event, and message. The single source of truth.** |
| `packages/manifests` | YAML | `DepartmentManifest` for D01–D13 |

## Data stores

| Store | Use |
|---|---|
| **Postgres 16** (Supabase or Render PG) | Event store, artifacts, projections, budgets, leads, deals, tickets. `pgvector` for semantic memory. |
| **Redis** | BullMQ queues, rate limits, sandbox lease locks, SSE fan-out |
| **Object storage** (S3-compatible / Supabase Storage) | Call recordings, transcripts, uploaded founder files, generated assets, PUMS extracts |
| **SQLite (inside simpop)** | Archetype + LLM response cache, exactly as `simit` does it |

## Request/work lifecycle (the one loop that matters)

```
1. Trigger            founder action | schedule tick | ArtifactReady event | webhook
2. Route              kernel matches trigger → routing rule → target department
3. Admit              Budget Meter checks envelope. No budget → Escalation(needs_budget) → D11
4. Provision          orchestrator leases a Superserve sandbox (or reuses a warm one)
5. Head runs          decompose → fan out N workers (parallel) → merge
6. Critic             one adversarial pass; on reject, one revision loop
7. Sign               artifact validated against Zod schema + evidence rules → stored, versioned
8. Meter              all consumption written to `meters`
9. Gate?              if the artifact implies an irreversible action → Gate Engine → Linq card
10. Emit              ArtifactReady → bus → next department(s) per routing rules
11. Pause             sandbox paused (Superserve) so state survives to next cycle
```

Every step writes events. If the process dies at step 6, restart replays to step 6.

## Concurrency model

- **Within a department:** workers run in parallel, capped by `manifest.concurrency` and budget.
- **Across departments:** a DAG with fan-out. D03 (market), D04 (outreach) and D05 (simpop) run
  concurrently after D02. D07 (build) and D08 (strategy) can overlap once `ProductSpec` is signed.
- **Long-running:** Sales, Support, Finance, and Chief of Staff are **resident** — they never
  "finish," they wake on schedule or webhook.

```
D01 ─► D02 ─┬─► D03 ─┐
            ├─► D04 ─┼─► D06 ─► D07 ─┬─► D08 ─► D09 ─► D10 ─► D11 ─► D12
            └─► D05 ─┘               └─► (Lovable site, Whop listing)
                                                                    │
                    D13 observes everything and writes back ◄───────┘
```

## Failure & recovery

| Failure | Behavior |
|---|---|
| Worker LLM error / timeout | 2 retries with backoff, then Head reassigns to a sibling worker with the partial context |
| Head fails | WorkOrder returns to queue with `attempt+1`; after 3, `Escalation(needs_human)` |
| Sandbox dies | Orchestrator re-leases; department resumes from last event, not from scratch |
| Band mesh unavailable | Bus transparently falls back to Postgres LISTEN/NOTIFY; a `bus.degraded` event fires |
| External API down | Circuit breaker per tool; department reports `partial` artifact with `gaps[]` rather than fabricating |
| Budget exhausted mid-run | Work suspends at the last artifact boundary; requisition to Treasury; resumes on grant |
| Founder unreachable at a gate | After `gate.timeout`, apply `gate.on_timeout ∈ {auto_approve, auto_reject, hold}` from manifest |

## Environments

| Env | Notes |
|---|---|
| `local` | Everything in Docker Compose. Sandboxes → local containers. Stripe test. Linq → console log. Terac → mock. |
| `demo` | Render. Real Stripe test mode, real Linq, real Terac sandbox, real Solari, seeded venture available at `?replay=demo-1`. |
| `prod` | Not required for the hackathon. Documented so the design doesn't paint us in. |

## Deployment topology (Render)

- `boardroom` — Web Service (Node)
- `kernel` — Web Service (Node), private network
- `orchestrator` — Background Worker ×2
- `simpop` — Web Service (Docker, Rust)
- `voice`, `gateway-linq` — Web Services
- `postgres`, `redis` — Render managed
- Ventures the company builds get their **own** Render services, created via the Render API by D07
  under the company's own Render account.
