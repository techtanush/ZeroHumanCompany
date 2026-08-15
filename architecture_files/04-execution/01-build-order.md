# 01 — Build Order

The single most important file in this repo. Everything else describes *what* Zeroth is; this
describes **the order in which it comes into existence** so that at every hour mark there is a
thing you could demo.

> **The rule that governs this file:** at no point does the build have "nothing working."
> M0 gives you a compiling monorepo with a rendering event log. M1 gives you one venture flowing
> end-to-end through three departments. **Every milestone after M1 is repetition of a proven
> pattern.** If you are behind, you cut departments — never the kernel, never the Boardroom.

Read alongside [`02-speed-playbook.md`](02-speed-playbook.md) (how to parallelize this),
[`06-repo-layout.md`](06-repo-layout.md) (what to scaffold), and
[`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) (the safety net that lets you cut).

---

## 0. Time budget & assumptions

| Assumption | Value |
|---|---|
| Wall clock from kickoff to demo | **36 hours** (`T+0` … `T+36`) |
| Hard stop for feature work | `T+31`. Everything after is hardening. |
| Parallel lanes (humans + jcode agents) | **4** — `L1 kernel`, `L2 departments`, `L3 boardroom`, `L4 integrations` |
| Effective agent-hours | ~4× wall clock, minus merge tax. Budget **110 usable agent-hours**. |
| Sleep | Two people sleep `T+14 → T+19`, two sleep `T+19 → T+24`. Lanes never all go dark. |

Hours below are **lane-hours**, not wall-clock hours. A milestone marked *8h across 3 lanes*
finishes in ~3 wall-clock hours.

---

## 1. The dependency DAG

```
                        ┌──────────────────────────────────────┐
                        │ M0  SKELETON                          │
                        │ contracts · event store · kernel API  │
                        │ boardroom shell · seeded event log    │
                        └──────────────┬───────────────────────┘
                                       │  HARD BARRIER — nothing starts before this
                        ┌──────────────▼───────────────────────┐
                        │ M1  VERTICAL SLICE   D01 → D02 → D03  │
                        │ agent-kit · manifests · routing ·      │
                        │ tool-plane(mock) · real cards render   │
                        └──────────────┬───────────────────────┘
                                       │  SOFT BARRIER — pattern is now provable
        ┌──────────────┬───────────────┼────────────────┬──────────────────┐
        ▼              ▼               ▼                ▼                  │
┌──────────────┐ ┌───────────┐ ┌──────────────┐  ┌──────────────┐          │
│ M2 VALIDATION│ │ M3 BUILD  │ │ M4 REVENUE   │  │ M5 OPS       │          │
│ D04 D05 D06  │ │ +GTM      │ │ D09 D10 D11  │  │ D12          │          │
│ voice·simpop │ │ D07 D08   │ │ Stripe·Whop  │  │ support      │          │
└───────┬──────┘ └─────┬─────┘ └──────┬───────┘  └──────┬───────┘          │
        │              │              │                 │                  │
        └──────────────┴──────────────┴─────────────────┘                  │
                                       ▼                                   │
                        ┌──────────────────────────────────────┐           │
                        │ M6  FINALE — D13 self-improvement     │◄──────────┘
                        │ needs ≥3 depts of telemetry to mine   │
                        └──────────────┬───────────────────────┘
                                       ▼
                        ┌──────────────────────────────────────┐
                        │ M7  DEMO HARDENING                    │
                        │ replay=demo-1 · fallbacks · rehearsal │
                        └──────────────────────────────────────┘
```

**Real edges (the only ones that actually block):**

| Edge | Why |
|---|---|
| `M0 → everything` | `packages/contracts` is imported by every other package. Nothing typechecks without it. |
| `M1 → M2,M3,M4,M5` | These are copies of the M1 department pattern. Building them before M1 proves the pattern = 4× rework. |
| `M2(D06) → M3(D07)` | D07 consumes `ProductSpec v2`. Can be unblocked early with a **fixture** `ProductSpec v2`. |
| `M3(D07 deploy) → M4(D09)` | D09 routes off `build.deployed`. Unblock with a fixture `Deployment`. |
| `M4(Stripe webhook) → M6` | D13's headline gap ("we lose deals at security review") is mined from `sales.deal_lost`. Seedable. |
| `M2..M5 → M7` | You can only harden what exists. |

**Fake edges — do NOT serialize on these:** D05 simpop does not depend on D04. D08 does not depend
on D07. D11 does not depend on D10. The Boardroom does not depend on any department — it depends
only on the event taxonomy in [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md),
which is frozen at M0.

**The unblocking trick, stated once:** every downstream milestone starts against a **fixture
artifact** committed in `fixtures/`, not against the real upstream department. Lane 2 builds D07
against `fixtures/demo-1/artifacts/product-spec.v2.json` at `T+15` even though D06 does not finish
until `T+18`. This is what makes the DAG mostly-parallel instead of mostly-serial.

---

## 2. M0 — Skeleton

> **`T+0 → T+4` wall clock · ~10 lane-hours · all 4 lanes · HARD BARRIER**
> *Nothing works, but everything compiles and the event log renders.*

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 0.1 | pnpm + Turborepo workspace, tsconfig base, biome/eslint, one `pnpm build` that passes | L1 | `/`, `turbo.json`, `pnpm-workspace.yaml` |
| 0.2 | **`packages/contracts` — ALL Zod schemas, complete, frozen** | **L1 solo** | `packages/contracts/src/{artifacts,events,messages,manifest,index}.ts` |
| 0.3 | Drizzle schema + first migration: `events`, `artifacts`, `ventures`, `work_orders`, `gates`, `meters`, `processed_messages` | L1 | `packages/db/src/schema.ts`, `packages/db/migrations/0000_init.sql` |
| 0.4 | Event store: `append()`, `readStream()`, `subscribe()` over PG `LISTEN/NOTIFY` | L1 | `apps/kernel/src/event-store.ts` |
| 0.5 | Kernel Fastify API: `POST /events`, `GET /events/stream` (SSE), `GET/POST /ventures`, `GET/POST /artifacts`, `GET /gates`, `POST /gates/:id/decide`, `GET /health` | L1 | `apps/kernel/src/routes/*.ts` |
| 0.6 | Boardroom shell: Next.js 15 App Router, Tailwind, `/`, `/v/[ventureId]`, SSE hook, **raw event log panel that streams live** | L3 | `apps/boardroom/app/**` |
| 0.7 | Isometric floor-plan grid with 13 empty rooms, all grey. No sprites yet. | L3 | `apps/boardroom/components/FloorPlan.tsx` |
| 0.8 | `packages/agent-kit` stub: `runAgent(spec, ctx)` that calls the Claude Agent SDK with a hardcoded prompt and returns validated JSON | L2 | `packages/agent-kit/src/run.ts` |
| 0.9 | `packages/tool-plane` with **mock driver only** + the `ZEROTH_TOOLS=mock\|real` flip | L4 | `packages/tool-plane/src/index.ts`, `drivers/mock/*` |
| 0.10 | `packages/sandbox` with the **local Docker driver only**; Superserve driver is an empty file with the same interface | L4 | `packages/sandbox/src/{index,drivers/local.ts,drivers/superserve.ts}` |
| 0.11 | `docker-compose.yml`: postgres 16 + pgvector, redis | L4 | `infra/docker-compose.yml` |
| 0.12 | `.env.example` complete (see [`06-repo-layout.md`](06-repo-layout.md) §7) | L4 | `.env.example` |
| 0.13 | `scripts/seed-events.ts` — writes ~40 synthetic events so the log has something to render | L1 | `scripts/seed-events.ts` |

### Acceptance test — "done when…"

```
□ pnpm install && pnpm build   → 0 errors across all packages
□ docker compose up -d && pnpm db:migrate  → tables exist
□ pnpm dev  → kernel :4000 healthy, boardroom :3000 loads
□ curl -X POST localhost:4000/events -d '{"type":"venture.created",...}'
      → the Boardroom event log shows the row WITHOUT a page refresh
□ pnpm seed  → 40 events stream into the log in order
□ Every schema in packages/contracts imported at least once from another package
□ git tag m0-skeleton
```

### Dependencies
None. This is the root.

### Cut list if behind at `T+4`
| Cut | Keep |
|---|---|
| Isometric floor plan (0.7) → ship a plain 13-row table | The SSE stream |
| Superserve stub file (0.10) | Local docker driver |
| pgvector extension | Plain Postgres |
| **Nothing else.** M0 is load-bearing for every other hour. |

### Parallelism note
0.2 is **one agent, alone, first**. L2/L3/L4 idle for the first ~40 minutes or work on
non-type-dependent scaffolding (docker-compose, Tailwind theme, README). Attempting to parallelize
contracts is the #1 way this build dies — see [`02-speed-playbook.md`](02-speed-playbook.md) §3.

---

## 3. M1 — Vertical Slice ⭐ THE CRITICAL MILESTONE

> **`T+4 → T+11` wall clock · ~22 lane-hours · L1+L2+L3 · SOFT BARRIER**
> *One venture goes `D01 → D02 → D03` with real LLM output rendered as real Boardroom cards.*

This is the de-risking milestone. Everything after it is the same shape with different prompts.
**If M1 slips past `T+13`, stop building departments and go straight to M7 with fixtures.**

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 1.1 | Manifest loader + validator (`DepartmentManifest` Zod from `02-departments/D00`) | L1 | `packages/manifests/src/load.ts` |
| 1.2 | `routing.yaml` + the routing engine: `artifact.signed(X)` → `WorkOrder` | L1 | `packages/manifests/routing.yaml`, `apps/kernel/src/routing.ts` |
| 1.3 | Orchestrator worker loop: BullMQ consume `WorkOrder` → lease sandbox → run Head → emit | L1 | `apps/orchestrator/src/worker.ts` |
| 1.4 | **The Head loop** end to end: plan → fan-out workers → merge → critic (1 pass max) → Zod-validate → sign → emit `ArtifactReady` | L2 | `packages/agent-kit/src/head.ts`, `critic.ts` |
| 1.5 | Budget Meter: `reserve()`, `recordTokens()`, `spend()`, `budget.degraded` on >80% | L1 | `apps/kernel/src/meter.ts` |
| 1.6 | **D01 Intake** — Mode A parse only (text box → `IdeaSeed`). Mode B origination is M1-optional. | L2 | `packages/manifests/D01-intake.yaml`, `packages/prompts/D01/*` |
| 1.7 | **D02 Office Hours** — port the gstack `office-hours` interrogation into `partner` + `devils-advocate` + `scribe`. Output signed `SharpenedIdea`. | L2 | `packages/manifests/D02-office-hours.yaml`, `packages/prompts/D02/*` |
| 1.8 | **D03 Market Research** — `demand`×3 / `supply`×3 / `money`×2 / `niche`×2 with `web_search` + `web_fetch` live. Output ≥5 `NicheDossier`. | L2 | `packages/manifests/D03-market-research.yaml`, `packages/prompts/D03/*` |
| 1.9 | Evidence enforcement: artifact signing **rejects** any numeric field lacking a `source_id` | L1 | `apps/kernel/src/sign.ts` |
| 1.10 | Boardroom: sprites animate room→room on `dept.work_started`; rooms light up; `SharpenedIdea` card; swipeable `NicheDossier` cards; **evidence drawer** that opens the cited source | L3 | `apps/boardroom/components/{Sprite,IdeaCard,NicheCard,EvidenceDrawer}.tsx` |
| 1.11 | Gate Engine + one real gate: `niche_selection` (`swipe_select`), surfaced in Boardroom | L1+L3 | `apps/kernel/src/gates.ts` |
| 1.12 | `packages/prompts/_shared/{company-context,evidence-rules,safety,output-contract}.md` | L2 | as listed |

### Acceptance test — "done when…"

```
□ Type "a tool for indie gyms to handle class no-shows" into the Boardroom idea box
□ Within 4 minutes and under $6.00 of metered spend:
    → D01 room lights, IdeaSeed artifact appears
    → D02 room lights, 3 real interrogation questions stream, SharpenedIdea card renders
      with ICP, wedge, kill-criteria
    → D03 room lights, 10 worker sprites appear, sources stream into the drawer
    → ≥5 NicheDossier cards render, each with a cited MRR@12mo figure
    → clicking any number opens the evidence drawer with a real URL
    → the niche_selection gate appears and blocks
□ Approving the gate emits gate.approved and the log shows the next WorkOrder queued
□ Deliberately delete a source_id from a worker output → artifact signing FAILS loudly
□ Kill the orchestrator mid-D03, restart → resumes from last event, does not re-run D02
□ git tag m1-vertical-slice
```

### Dependencies
M0 complete, specifically 0.2 (contracts) and 0.5 (kernel API).

### Cut list if behind at `T+11`
| Cut | Keep | Cost of cutting |
|---|---|---|
| D01 Mode B origination swarm | D01 Mode A parse | Demo loses its 15-second cold open → use the `demo-1` recording |
| D03 `money` + `niche` worker roles | `demand` + `supply` | Fewer dossiers, still ≥3 |
| Sprite walking animation | Room light-up | Loses charm, keeps legibility |
| Critic pass in D01/D02 | Critic in D03 | D03 is where fabrication risk lives |
| **Never cut:** evidence enforcement (1.9). It is the answer to the loudest judge question. |

### Parallelism
L1 (kernel: 1.1,1.2,1.3,1.5,1.9,1.11) ∥ L2 (departments: 1.4,1.6,1.7,1.8,1.12) ∥
L3 (boardroom: 1.10, 1.11-UI). L2 and L3 both consume contracts, never each other.
L4 goes ahead to M4 integration spikes (Stripe test account, Composio auth, Linq webhook echo).

---

## 4. M2 — Validation

> **`T+11 → T+18` wall clock · ~20 lane-hours · L2 + L4**
> *D04 Outreach, D05 Synthetic Population, D06 Pivot. The emotional peak of the demo.*

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 2.1 | **`services/simpop`** — Rust + axum, ported from `simit`: PUMS loader → k-means archetypes → batched LLM poll → PWGTP post-stratification. SQLite cache. Deterministic seed. | L4 | `services/simpop/src/{main,pums,archetype,poll,weight}.rs` |
| 2.2 | **PUMS extract pre-baked** to a single region, ≤80 MB, committed to `fixtures/pums/` or object storage. **Do not download PUMS on the day.** | L4 | `fixtures/pums/ca-2023-slim.parquet` |
| 2.3 | **D05 Synthetic Population** — head/sampler/archetyper/pollster/calibrator calling `simpop` over HTTP → `SyntheticPanelResult` | L2 | `packages/manifests/D05-*.yaml` |
| 2.4 | **D04 Outreach** — network mining via Composio (LinkedIn/Gmail), outreach writer, scheduler, claim extraction → `Interview[]` + `ClaimLedger` | L2 | `packages/manifests/D04-*.yaml` |
| 2.5 | **`services/voice`** — ElevenLabs cloned voice + telephony, live transcript, consent preamble, DNC check | L4 | `services/voice/src/*` |
| 2.6 | **D06 Pivot** — synthesizer + red-team → `IdeaDiff[]` → approved diffs rewrite `ProductSpec v2` | L2 | `packages/manifests/D06-*.yaml` |
| 2.7 | Boardroom: pixel population grid, per-archetype bars, waveform + live transcript with claim chips, pivot-diff card with attached verbatim quotes | L3 | `apps/boardroom/components/{PopulationGrid,CallPanel,PivotDiff}.tsx` |
| 2.8 | Gate: `pivot_approval` (`multi_approve`, per-diff) | L1 | `apps/kernel/src/gates.ts` |

### Acceptance test — "done when…"

```
□ POST a SharpenedIdea → D04 and D05 both start, concurrently, in separate rooms
□ simpop returns a SyntheticPanelResult in <45s with:
    - ≥10 archetypes, each carrying a PWGTP-derived population weight
    - a headline like "68% of Segment 3 would pay $29/mo"
    - same seed → byte-identical result (run it twice, diff the JSON)
□ One real outbound call places, plays the consent preamble, transcribes, and produces
  ≥5 Claims each with speaker + timestamp + verbatim quote
□ D06 emits ≥3 IdeaDiffs, each carrying ≥1 quote OR ≥1 archetype stat as evidence
□ Approving 2 of 3 diffs produces ProductSpec v2 with exactly those 2 applied
□ Calibration delta between real interviews and the synthetic panel is REPORTED, not hidden
□ git tag m2-validation
```

### Dependencies
M1. D06 depends on D04+D05 artifacts — but is built against `fixtures/demo-1/artifacts/claim-ledger.json`
and `synthetic-panel.json` from hour one, so all three are built in parallel.

### Cut list if behind at `T+18`
| Cut | Keep | Note |
|---|---|---|
| Live outbound telephony (2.5) | The **recorded** call in `fixtures/demo-1/calls/` | Biggest single time-sink; the recording is indistinguishable on stage |
| D04 real Composio network mining | Seeded contact list in fixtures | |
| simpop LLM polling per archetype | Cached poll results in SQLite, shipped | Keeps the pixel grid and the weights, which is the visual |
| Terac panel path in D04 | The Terac path in D11/HR (M4) | Terac must appear *somewhere* live |
| **Never cut:** the population grid UI (2.7) and the calibration delta. That is the differentiator. |

---

## 5. M3 — Build + GTM

> **`T+15 → T+22` wall clock · ~16 lane-hours · L2 + L4 · starts on a FIXTURE ProductSpec**

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 3.1 | **D07 Build** — architect → 2–4 implementers in separate git worktrees → integrator → QA → deployer | L2 | `packages/manifests/D07-build.yaml` |
| 3.2 | Headless Claude Code inside the sandbox: repo init, commit, push to the company's GitHub org | L4 | `packages/sandbox/src/claude-code.ts` |
| 3.3 | Render API deploy: create service, set env, deploy, poll health, return URL | L4 | `packages/tool-plane/src/drivers/real/render.ts` |
| 3.4 | Replay-recorded QA: run scenarios, on failure attach the Replay session URL to `build.qa_failed` | L4 | `packages/tool-plane/src/drivers/real/replay.ts` |
| 3.5 | Lovable marketing site spun in parallel with the app | L4 | `packages/tool-plane/src/drivers/real/lovable.ts` |
| 3.6 | **D08 Strategy** — positioning, ICP tiers, channels ranked by expected CAC, pricing, objection matrix → `GTMPlan` | L2 | `packages/manifests/D08-strategy.yaml` |
| 3.7 | Boardroom: live build log tail, commit ticker, deploy URL button, Replay link chip | L3 | `apps/boardroom/components/BuildPanel.tsx` |

### Acceptance test — "done when…"

```
□ Feed fixtures/demo-1/artifacts/product-spec.v2.json to D07
□ Within 10 minutes: a NEW public GitHub repo exists under the company org, with ≥8 commits
  authored by distinct implementer agents
□ A Render URL returns HTTP 200 and renders the product's core screen
□ QA runs; ONE seeded bug is caught; the Replay recording URL is attached to the event;
  the implementer fixes it and the re-run passes
□ D08 emits a GTMPlan whose channel ranking cites CAC numbers with source_ids
□ Clicking the deploy URL in the Boardroom opens the real product
□ git tag m3-build-gtm
```

### Cut list if behind at `T+22`
| Cut | Keep |
|---|---|
| Lovable site (3.5) | The app deploy |
| Multi-worktree parallel implementers | One implementer, sequential |
| Replay live recording (3.4) | A pre-recorded Replay session linked from fixtures |
| D08 objection matrix + 90-day plan | Positioning + pricing + channels |
| **Never cut:** the real repo + real deployed URL. "It shipped" is unfakeable and judges click it. |

---

## 6. M4 — Revenue

> **`T+18 → T+25` wall clock · ~18 lane-hours · L2 + L4 · starts on a FIXTURE Deployment**

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 4.1 | **D09 Leads** — warm pool from D04 interviewees + cold ICP research, enrich, dedupe, score, consent-check → `Lead[]` | L2 | `packages/manifests/D09-leads.yaml` |
| 4.2 | **D10 Sales** — sequencer, writer (quotes the lead's own interview line back at them), voice-closer, objection-analyst → `Deal[]`, `Order` | L2 | `packages/manifests/D10-sales.yaml` |
| 4.3 | **D11 Finance & HR** — reconciler, dunning, treasurer + HR allocator & recruiter → `Ledger`, `BudgetAllocation`, `HumanHire` | L2 | `packages/manifests/D11-finance-hr.yaml` |
| 4.4 | **Stripe**: Payment Link creation, Checkout, webhook receiver → `money.revenue_received` | L4 | `apps/kernel/src/routes/webhooks/stripe.ts` |
| 4.5 | **Treasury reads real Stripe revenue and reallocates envelopes.** Emits `money.budget_allocated`. | L2 | `packages/prompts/D11/treasurer.md` |
| 4.6 | **Terac**: `HumanWorkRequisition` → post → match → deliver → pay, with the hired human's output entering the artifact pipeline | L4 | `packages/tool-plane/src/drivers/real/terac.ts` |
| 4.7 | **Whop** listing rail + **Dodo** MoR fallback, rail chosen by venture geography | L4 | `.../real/{whop,dodo}.ts` |
| 4.8 | **Linq** gateway: rich approval cards out, replies routed back to gates | L4 | `services/gateway-linq/src/*` |
| 4.9 | Boardroom: revenue ring animating $0 → first charge, budget bars re-animating on reallocation, Terac requisition → hired-panel card | L3 | `apps/boardroom/components/{RevenueRing,BudgetBars,TeracCard}.tsx` |
| 4.10 | Gates: `money_out`, `public_content`, `send_to_real_person` | L1 | `apps/kernel/src/gates.ts` |

### Acceptance test — "done when…"

```
□ D09 produces ≥25 leads, ≥3 of them warm (traceable to a real D04 interview)
□ D10 drafts an email that quotes a real ClaimLedger verbatim quote with its date
□ The send_to_real_person gate fires and renders as a Linq card on an actual phone
□ Approving from the phone sends the email; gate.approved appears in the event log
□ A Stripe test-mode charge completes; the webhook lands; the revenue ring animates
□ Treasury reallocates: Sales envelope UP, Build envelope DOWN, both visible as events
□ A HumanWorkRequisition posts to Terac and returns a matched worker
□ git tag m4-revenue
```

### Cut list if behind at `T+25`
| Cut | Keep |
|---|---|
| Whop + Dodo (4.7) | Stripe only |
| Voice-closer in D10 | Email sequencer |
| D09 cold ICP research swarm | Warm pool only — it is the better story anyway |
| Dunning + reconciliation detail | Revenue ingest + Treasury reallocation |
| **Never cut:** the live Stripe charge, the Linq approval card, and the Terac hire. Three sponsor tracks in one milestone. |

---

## 7. M5 — Ops

> **`T+24 → T+27` wall clock · ~6 lane-hours · L2**

### Deliverables

| # | Deliverable | Lane |
|---|---|---|
| 5.1 | **D12 Support** — triage, resolver (has repo read access, can cite the actual bug line), bug-filer → `Ticket[]`, `ProductSignal[]` | L2 |
| 5.2 | `support↔build` Band room: a ticket becomes a bug report becomes a commit | L4 |
| 5.3 | Routing rule: `support.signal_filed(severity>=high)` → D06 `reassess_product` | L1 |
| 5.4 | Boardroom: ticket queue, signal chips feeding back into the pivot room | L3 |

### Acceptance test — "done when…"

```
□ POST a support email fixture → a Ticket opens, is triaged, and is resolved with a citation
  into the venture's own repo (file + line)
□ Filing 2 tickets of the same cluster emits a ProductSignal that routes to D06
□ git tag m5-ops
```

### Cut list
Cut D12 entirely if `T+27` arrives with M6 unstarted. **M6 outranks M5** — the finale is worth
more than the support loop. Support can be shown from `demo-1` replay.

---

## 8. M6 — Finale (D13 self-improvement)

> **`T+25 → T+31` wall clock · ~14 lane-hours · L2 + L3 · THIS IS THE PRIZE**

Everything else proves competence. This proves the thesis. Guard these hours ruthlessly.

### Deliverables

| # | Deliverable | Lane | Path |
|---|---|---|---|
| 6.1 | **Telemetry reader** — D13 queries the event store for loss patterns: `sales.deal_lost` clustered by `reason_cluster`, `dept.work_failed` rates, escalation frequency | L2 | `packages/prompts/D13/analyst.md` |
| 6.2 | **`gap-detector`** → `CapabilityGap` artifact: the missing ability, the evidence, and the **cost of not having it in dollars** | L2 | `packages/prompts/D13/gap-detector.md` |
| 6.3 | **`agent-designer`** → writes a complete, Zod-valid `DepartmentManifest` **plus** its prompt files into `packages/prompts/D14/` | L2 | `packages/prompts/D13/agent-designer.md` |
| 6.4 | **Shadow tester** — forks a sandbox, replays the historical losing cases through the new department, produces a before/after comparison | L2+L4 | `apps/orchestrator/src/shadow.ts` |
| 6.5 | **Hot registration** — the new manifest is loaded, routing rules are appended, Band discovery makes it reachable **with no redeploy** | L1 | `apps/kernel/src/routing.ts`, `packages/manifests/src/load.ts` |
| 6.6 | Gate: `deploy_new_department` → Linq card | L1 | |
| 6.7 | **A new room appears on the floor plan**, a new sprite walks into it, the org chart re-renders to 14 boxes | L3 | `apps/boardroom/components/FloorPlan.tsx` |

### Acceptance test — "done when…"

```
□ Seed 3 sales.deal_lost events with reason_cluster="security_review"
□ Trigger cos.daily
□ D13 emits a CapabilityGap naming security-questionnaire handling, citing all 3 lost deals
  and stating the dollar value lost
□ D13 writes packages/manifests/D14-security-review.yaml that PASSES DepartmentManifest
  validation on first try (if it doesn't, D13 gets one repair loop — no more)
□ Shadow mode replays the 3 lost deals through D14 and reports a before/after
□ Founder approves via Linq
□ WITHOUT a restart: a 14th room renders, a sprite walks in, and a real WorkOrder routes to D14
  and produces a real artifact
□ git tag m6-finale
```

### Cut list if behind at `T+31`
| Cut | Keep |
|---|---|
| Shadow-mode fork + comparison (6.4) | The gap → manifest → deploy chain |
| D14 doing *useful* work | D14 existing, being routable, and returning **one** real artifact |
| Org-chart re-render | The new room appearing |
| **Never cut:** the new room appearing on the floor plan. That single animation is the demo's closing image. |

---

## 9. M7 — Demo hardening

> **`T+31 → T+36` wall clock · ~14 lane-hours · ALL LANES · zero new features**

### Deliverables

| # | Deliverable | Lane |
|---|---|---|
| 7.1 | `?replay=demo-1` plays the entire pre-run venture from `fixtures/demo-1/events.jsonl` at a configurable speed | L1+L3 |
| 7.2 | Every fixture in [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) present and loading | L4 |
| 7.3 | Per-beat fallback switch — a keyboard chord that swaps any live beat to its recording without leaving the page | L3 |
| 7.4 | `time_scale=0.001` verified: cron-driven beats fire on stage in ~90s | L1 |
| 7.5 | Kill switch works and is visible | L1 |
| 7.6 | **Three full rehearsals**, timed to the second, on the venue network | ALL |
| 7.7 | Offline mode: local Postgres snapshot + all recordings on the presenting laptop | L4 |
| 7.8 | Judge Q&A prep: click-through paths for "is that hallucinated" and "is that scripted" | ALL |

### Acceptance test — "done when…"

```
□ Unplug the wifi. Load ?replay=demo-1. The ENTIRE 4-minute story still plays.
□ Three rehearsals in a row land inside 4:00 with no operator improvisation
□ Every beat has a tested fallback keystroke
□ git tag demo-ready
```

---

## 10. The degraded path — "if you only have 6 hours left"

Use this the moment you look at the clock and know M2–M6 are not all happening. It still tells
**the entire story**, because the story is *idea → evidence → product → money → the company
improving itself*, and every one of those beats can be told from a signed artifact whether that
artifact was produced live or ten hours ago.

### Build exactly this, in this order

| Hr | Build | Why it is in the 6 |
|---|---|---|
| **1** | `packages/contracts` + event store + kernel SSE + `POST /events` | Nothing renders without it |
| **2** | Boardroom: floor plan, event log, artifact card renderer for **5 types** — `SharpenedIdea`, `NicheDossier`, `SyntheticPanelResult`, `Deployment`, `CapabilityGap` | The card renderer IS the demo |
| **3** | `?replay=demo-1`: read `fixtures/demo-1/events.jsonl`, replay at `speed=8×` with correct causal timing | Turns fixtures into a live-looking company |
| **4** | **D02 Office Hours, live, for real** — the one department that runs on the judge's idea | The un-fakeable beat. Judges believe the whole thing if this one is real. |
| **5** | **One live Stripe test charge** wired to the revenue ring, triggered by a button | Money on stage is unfakeable and wins the Stripe track |
| **6** | **D13 finale, semi-live**: `CapabilityGap` from seeded events → a real Zod-valid manifest written to disk by a real LLM call → the 14th room appears | The closing image. Generating a valid manifest live is cheap and looks impossible. |

### What you consciously give up
Live market research, live calls, live simpop, live build, live sales. **All of it is shown from
`demo-1` recordings** and you say so once, in one honest sentence: *"the research, the call, and
the build you're seeing are from a run we did this morning — the office hours, the charge, and the
new department are happening right now."* Judges reward that sentence. They punish the discovery
that you weren't honest about it.

### The three things that must be live no matter what
1. **Office Hours on the judge's own idea** — proves judgment.
2. **A Stripe charge** — proves money.
3. **A new department appearing** — proves the thesis.

Everything else is a supporting recording.

---

## 11. Lane assignment summary

| Lane | Owns | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|---|---|
| **L1 kernel** | `apps/kernel`, `packages/{contracts,db,manifests}`, orchestrator | ●●● | ●●● | ○ | ○ | ● | ● | ●● | ●●● |
| **L2 departments** | `packages/{agent-kit,prompts}`, all `D0N` manifests | ● | ●●● | ●●● | ●● | ●●● | ●● | ●●● | ● |
| **L3 boardroom** | `apps/boardroom`, `packages/ui` | ●● | ●●● | ●● | ● | ●● | ● | ●● | ●●● |
| **L4 integrations** | `packages/tool-plane`, `services/*`, `infra/`, fixtures | ●● | ○ | ●●● | ●●● | ●●● | ○ | ● | ●●● |

`●●●` primary · `●●` active · `●` light · `○` idle-or-ahead

**Merge cadence: every 45 minutes, to `main`, always green.** See
[`02-speed-playbook.md`](02-speed-playbook.md) §4.

---

## 12. Milestone summary table

| M | Name | Wall clock | Lane-hrs | Gate to proceed | Cuttable? |
|---|---|---|---|---|---|
| M0 | Skeleton | T+0 → T+4 | 10 | `pnpm build` green + live event in UI | **No** |
| M1 | Vertical slice | T+4 → T+11 | 22 | D01→D02→D03 with cited numbers | **No** |
| M2 | Validation | T+11 → T+18 | 20 | Deterministic panel + real claims | Partially |
| M3 | Build + GTM | T+15 → T+22 | 16 | Live repo + live URL | Partially |
| M4 | Revenue | T+18 → T+25 | 18 | Live Stripe charge + Terac hire | Partially |
| M5 | Ops | T+24 → T+27 | 6 | Ticket → ProductSignal → D06 | **Yes, entirely** |
| M6 | Finale | T+25 → T+31 | 14 | 14th room appears live | **No** |
| M7 | Hardening | T+31 → T+36 | 14 | Full story plays offline | **No** |

**Total: 120 lane-hours against a 110-hour budget.** You are 10 hours over on purpose. M5 is the
designated sacrifice; the M2–M4 cut lists cover the rest.

---

## 13. Standing rules for the whole build

1. **`main` is always green.** A red `main` blocks four lanes at once; the arithmetic is brutal.
2. **Fixtures before integrations.** Every department is built against a committed fixture input
   first, then pointed at the real upstream. This is what makes the DAG parallel.
3. **Every milestone ends with a git tag.** Tags are your rollback points at 3am.
4. **No milestone starts before its predecessor's acceptance test passes.** Half-done M1 plus
   half-done M2 demos worse than done-M1 alone.
5. **The Boardroom renders only real events.** If a UI element has no event behind it, delete it
   ([`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md)).
6. **Record `demo-1` as you go, not at the end.** Every time a department works for the first time,
   its events are appended to `fixtures/demo-1/events.jsonl`. M7 then becomes assembly, not capture.
