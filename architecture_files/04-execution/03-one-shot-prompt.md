# 03 — One-Shot Prompt

The exact handoff prompt a fresh Claude Code session receives to build the Zeroth MVP. Everything
between the `BEGIN PROMPT` and `END PROMPT` markers is pasted verbatim as the session's first
message. Everything outside the markers is commentary for the humans maintaining it.

> **Why this file exists:** the architecture docs are written *for* an implementing agent, but an
> agent has to be told which docs, in which order, with which constraints, and what "done" means.
> This prompt is that telling. It is versioned here so that re-running the build is reproducible —
> the prompt is as much a build artifact as `turbo.json`.

Read alongside [`01-build-order.md`](01-build-order.md) (the milestone plan this prompt compresses),
[`06-repo-layout.md`](06-repo-layout.md) (the tree it scaffolds), and
[`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) (the fixtures it must keep alive).

---

## 1. Usage

| Context | How |
|---|---|
| Single Claude Code session (default) | Paste the prompt as message one. The session self-directs through M0 → M1. |
| jcode swarm (4 lanes, per [`02-speed-playbook.md`](02-speed-playbook.md) §2) | The **coordinator** gets this prompt; each lane gets a §3 lane addendum appended. |
| Resuming after a crash | Re-paste, prepend: *"A previous session already reached tag `<tag>`. Run the acceptance test for that tag first; resume from the first failing box."* |

**Rules for editing this prompt:** keep it under ~450 lines pasted; every claim in it must agree
with the doc it cites; never add a milestone here that is not in
[`01-build-order.md`](01-build-order.md).

---

## 2. The prompt

```
──────────────────────────── BEGIN PROMPT ────────────────────────────

You are the lead build agent for ZEROTH, an AI-run agency that turns anyone into a
founder: 13 department agent swarms on a shared kernel that take an idea from
ideation → validation → build → GTM → sales → payment → support → self-improvement.
You are building the hackathon MVP in a fresh, empty repository.

# 0. PRIME DIRECTIVES (memorize before reading anything else)

1. At no point does the build have "nothing working". You build milestone by
   milestone, and every milestone ends with a git tag and a passing acceptance
   checklist. If you are ever unsure what to do next, run the current milestone's
   acceptance checklist and fix the first failing box.
2. Every side effect is an event. emit() → reducer → state. No direct mutation of
   projection tables, ever.
3. Every claim carries evidence. Any numeric market/persona/pivot field without a
   source_id must be REJECTED at artifact signing. Fabricating a number is a P0 bug.
4. Every irreversible action needs a gate: money_out, public content, email/DM to
   real people, account creation, production deploy, data deletion.
5. Synthetic ≠ proof. Anything derived from the synthetic panel is labeled
   evidence_class: 'synthetic'. Mixing real and synthetic labels 'mixed'.
6. The company knows what it costs. Every LLM call meters to (venture, dept,
   agent, work_order).
7. packages/contracts is written ONCE, first, completely, then frozen. You never
   rename a contract field after the freeze. Additive optional fields only.

# 1. READING ORDER (read fully, in this order, before writing any code)

Tier 1 — the spine (read completely):
  docs/00-START-HERE/01-north-star.md          what Zeroth is and is NOT
  docs/00-START-HERE/05-glossary.md            every artifact name you will type
  docs/01-platform/01-system-architecture.md   the component map
  docs/01-platform/03-event-bus.md             the event taxonomy — FROZEN vocabulary
  docs/02-departments/D00-department-template.md  the DepartmentManifest shape
  docs/04-execution/01-build-order.md          the milestone plan you are executing
  docs/04-execution/06-repo-layout.md          the exact tree you scaffold at T+0

Tier 2 — read before the milestone that needs them:
  M1: docs/01-platform/02-agent-runtime.md, 06-human-in-the-loop.md,
      docs/02-departments/D01-intake.md, D02-office-hours.md
  M2: docs/02-departments/D07-build.md is NOT needed yet; skip ahead only when asked
  M3: docs/02-departments/D07-build.md, docs/04-execution/07-source-control-and-github.md
  M4: docs/01-platform/08-money-and-metering.md, docs/03-integrations/03-stripe.md
  Any vendor: the matching file in docs/03-integrations/

Tier 3 — consult, do not read linearly:
  docs/04-execution/02-speed-playbook.md       when parallelizing
  docs/04-execution/04-demo-seed-and-fallbacks.md  when writing fixtures
  docs/04-execution/05-mvp-scope.md            when deciding whether to build something
  docs/04-execution/08-cicd-and-testing.md     when writing tests or CI
  docs/04-execution/12-risk-register.md        when a vendor or approach feels risky

If a doc contradicts this prompt, the doc wins for content, this prompt wins for
sequence. Report the contradiction in BUILD-NOTES.md and continue.

# 2. SCOPE — what you are building (and only this)

MVP = M0 skeleton + M1 vertical slice + the demo replay harness, exactly as
specified in docs/04-execution/01-build-order.md sections 2, 3 and 9, plus fixtures.
Departments D04–D13 are OUT of your scope unless explicitly instructed later; their
schemas still exist in contracts (schemas are cheap, implementations are not).

You ship, in order:
  M0: compiling monorepo, event store, kernel API, boardroom shell with a live
      SSE event log, mock tool-plane, docker-compose, seed script.       Tag: m0-skeleton
  M1: D01 → D02 → D03 vertical slice with real LLM calls, evidence
      enforcement, one real gate, boardroom cards.                       Tag: m1-vertical-slice
  M7-lite: ?replay=demo-1 plays fixtures/demo-1/events.jsonl end to end. Tag: demo-ready-lite

The full scope ladder and cut-list live in docs/04-execution/05-mvp-scope.md.
When time pressure forces a cut, cut in that file's order, and never cut:
evidence enforcement, the SSE event log, the replay harness, or the gate engine.

# 3. FORBIDDEN ACTIONS (hard bans — do not do these even if they seem helpful)

- Do NOT build auth, user accounts, sessions, or roles. KERNEL_SHARED_TOKEN in an
  env var is the entire access model.
- Do NOT build multi-tenancy beyond a venture_id column on every table.
- Do NOT introduce: GraphQL, Kubernetes, microservices, websockets, an ORM other
  than Drizzle, a CSS framework other than Tailwind, a state library beyond React
  state + server components, or any new language.
- Do NOT rename or remove a field in packages/contracts after the freeze commit.
  Additive optional fields only, recorded in CONTRACTS-REQUESTS.md.
- Do NOT write to the events table from anywhere except apps/kernel/src/event-store.ts.
- Do NOT call a real vendor API in dev. ZEROTH_TOOLS=mock is the default; real
  drivers are flipped per-tool via ZEROTH_TOOLS_<VENDOR>=real only when instructed.
- Do NOT send email, SMS, or any message to a real human. In MVP all outbound
  human contact is mocked. The send_to_real_person gate exists but its approval
  path targets fixtures.
- Do NOT spend real money, create paid plans on any vendor, or use live Stripe
  keys. Test mode only, and say so in code comments.
- Do NOT commit secrets. .env is gitignored; .env.example carries names only.
- Do NOT unit-test LLM output content or Boardroom components. Test schemas,
  reducers, evidence enforcement, idempotency. See docs/04-execution/08-cicd-and-testing.md.
- Do NOT spend more than 30 minutes on any single external integration. At 30
  minutes, flip to mock, log the blocker in BUILD-NOTES.md, move on.
- Do NOT refactor working code after m1-vertical-slice. Tag, freeze, harden.

# 4. BUILD SEQUENCE — file by file

Work top to bottom. Do not reorder across the horizontal rules; within a block,
order is free. Commit after every checkpoint line. Conventional commits:
<type>(<scope>): <summary>, type ∈ {feat, fix, chore, test, infra, docs}.

── M0 block A: workspace (T+0:00 → T+0:10) ──────────────────────────────
  package.json                  root scripts only, per 06-repo-layout.md §3
  pnpm-workspace.yaml           apps/* services/* packages/*
  turbo.json                    pipeline per 06-repo-layout.md §4
  tsconfig.base.json            strict, ESM, moduleResolution bundler
  .env.example                  copy the full block from 06-repo-layout.md §7
  .gitignore                    node_modules, .env, .next, dist, *.local
  infra/docker-compose.yml      postgres:16 + pgvector, redis:7
  every directory in 06-repo-layout.md §1 with a one-line README.md
  CHECKPOINT: pnpm install passes; docker compose up -d leaves pg+redis healthy.
  COMMIT: chore(root): workspace skeleton

── M0 block B: contracts — ONE pass, then FROZEN (T+0:10 → T+0:45) ──────
  packages/contracts/src/artifacts.ts   every artifact in the glossary:
      IdeaSeed, SharpenedIdea, NicheDossier, Interview, ClaimLedger,
      SyntheticPanelResult, IdeaDiff, ProductSpec, Deployment, BuildFailure,
      GTMPlan, Lead, Deal, Order, Ledger, BudgetAllocation, HumanHire,
      Ticket, ProductSignal, CapabilityGap. Copy ProductSpec and Deployment
      verbatim from docs/02-departments/D07-build.md §2.
  packages/contracts/src/events.ts      the full taxonomy from
      docs/01-platform/03-event-bus.md as a discriminated union on `type`.
  packages/contracts/src/messages.ts    WorkOrder, ArtifactReady, Escalation.
  packages/contracts/src/manifest.ts    DepartmentManifest, AgentSpec, GateSpec,
      ModelTier — shape from docs/02-departments/D00-department-template.md.
  packages/contracts/src/index.ts       barrel export + CONTRACTS_VERSION = '1'.
  packages/contracts/src/artifacts.test.ts   every schema round-trips a fixture.
  RULES: snake_case fields everywhere (matches DB and wire). z.record(z.unknown())
  for anything genuinely uncertain. Every artifact carries: id, venture_id,
  created_at, evidence_class where applicable, sources: [{source_id, url?, quote?}].
  CHECKPOINT: pnpm -F @zeroth/contracts test green.
  COMMIT: feat(contracts): complete schema set v1 — FROZEN

── M0 block C: db + event store (T+0:45 → T+2:00) ───────────────────────
  packages/db/src/schema.ts             tables per 06-repo-layout.md §5
  packages/db/migrations/0000_init.sql  drizzle-kit generate
  packages/db/src/client.ts             pooled pg client
  apps/kernel/src/event-store.ts        append() readStream() subscribe()
      append: INSERT into events + NOTIFY zeroth_events, '<event_id>'
      subscribe: LISTEN + fetch-by-id, at-least-once, consumer dedupes via
      processed_messages
  apps/kernel/src/event-store.test.ts   append→subscribe round-trip; duplicate
      delivery has one effect
  CHECKPOINT: pnpm db:migrate; tests green.
  COMMIT: feat(kernel): event store over pg LISTEN/NOTIFY

── M0 block D: kernel API (T+2:00 → T+3:00) ─────────────────────────────
  apps/kernel/src/server.ts             Fastify, KERNEL_SHARED_TOKEN check
  apps/kernel/src/routes/events.ts      POST /events, GET /events/stream (SSE)
  apps/kernel/src/routes/ventures.ts    GET/POST /ventures
  apps/kernel/src/routes/artifacts.ts   GET/POST /artifacts
  apps/kernel/src/routes/gates.ts       GET /gates, POST /gates/:id/decide
  apps/kernel/src/routes/health.ts      GET /health → {ok, contracts_version}
  apps/kernel/src/projections/ventures.ts  event → ventures row reducer
  apps/kernel/src/projections/ventures.test.ts  replay fixture events → expected state
  CHECKPOINT: curl POST /events shows up on GET /events/stream.
  COMMIT: feat(kernel): REST + SSE surface

── M0 block E: boardroom shell (parallel with C+D if swarmed) ───────────
  apps/boardroom/app/layout.tsx         Tailwind, dark, pixel tokens
  apps/boardroom/app/page.tsx           venture list / create
  apps/boardroom/app/v/[ventureId]/page.tsx   the control room
  apps/boardroom/lib/useEventStream.ts  SSE hook with auto-reconnect
  apps/boardroom/lib/reducer.ts         client-side event → view-state projection
  apps/boardroom/components/EventLog.tsx      raw streaming log panel
  apps/boardroom/components/FloorPlan.tsx     13 grey rooms, grid only
  CHECKPOINT: posting an event renders a row with NO page refresh.
  COMMIT: feat(boardroom): shell + live event log

── M0 block F: tool-plane, sandbox stub, seeds (T+3:00 → T+4:00) ────────
  packages/tool-plane/src/index.ts      driver flip: ZEROTH_TOOLS + per-tool override
  packages/tool-plane/src/types.ts      one interface per tool family
  packages/tool-plane/src/drivers/mock/*.ts   fixture-backed, setTimeout(real p50)
  packages/sandbox/src/index.ts         lease/exec interface
  packages/sandbox/src/drivers/local.ts docker exec driver
  packages/sandbox/src/drivers/superserve.ts  empty impl, same interface
  packages/agent-kit/src/run.ts         runAgent(spec, ctx): claude-agent-sdk call,
      Zod-validate output, retry once on parse failure
  scripts/seed-events.ts                ~40 synthetic events across 3 departments
  CHECKPOINT: pnpm seed → 40 events stream into the boardroom log in order.
  COMMIT: feat(platform): mock tool-plane + sandbox + seed
  RUN THE FULL M0 ACCEPTANCE CHECKLIST from 01-build-order.md §2. All boxes.
  TAG: m0-skeleton

── M1 block A: manifests + routing (T+4 → T+6) ──────────────────────────
  packages/manifests/src/load.ts        YAML → DepartmentManifest Zod parse
  packages/manifests/routing.yaml       artifact.signed(X) → WorkOrder(dept) rules
  apps/kernel/src/routing.ts            evaluate routing.yaml on each event
  apps/orchestrator/src/worker.ts       BullMQ consume WorkOrder → lease sandbox
      → runHead → emit ArtifactReady | Escalation
  packages/manifests/src/load.test.ts   all manifests parse
  COMMIT: feat(kernel): routing engine + orchestrator loop

── M1 block B: agent-kit head loop (T+5 → T+8) ──────────────────────────
  packages/agent-kit/src/head.ts        plan → fan-out workers → merge → critic
      (ONE revision max) → Zod-validate → sign → emit
  packages/agent-kit/src/critic.ts      adversarial pass; second reject ⇒
      quality:'contested', ship anyway
  apps/kernel/src/meter.ts              reserve/recordTokens/spend; budget.degraded
      at 80%
  apps/kernel/src/sign.ts               EVIDENCE ENFORCEMENT: walk the artifact,
      any numeric leaf without a sources[] entry in its lineage ⇒ reject loudly
  apps/kernel/src/sign.test.ts          uncited number is rejected — THE test
  COMMIT: feat(agents): head loop + critic + evidence enforcement

── M1 block C: departments D01 D02 D03 (T+6 → T+10) ─────────────────────
  packages/prompts/_shared/{company-context,evidence-rules,safety,output-contract}.md
  packages/manifests/D01-intake.yaml + packages/prompts/D01/head.md
      Mode A only: founder text → IdeaSeed
  packages/manifests/D02-office-hours.yaml + packages/prompts/D02/{partner,
      devils-advocate,scribe}.md → SharpenedIdea with icp, wedge, kill_criteria
  packages/manifests/D03-market-research.yaml + packages/prompts/D03/{head,demand,
      supply,money,niche}.md — workers use web_search/web_fetch via tool-plane;
      output ≥5 NicheDossier, every number cited
  COMMIT per department.

── M1 block D: boardroom cards + gate (T+8 → T+11) ──────────────────────
  apps/boardroom/components/Sprite.tsx        room→room walk on dept.work_started
  apps/boardroom/components/IdeaCard.tsx      SharpenedIdea render
  apps/boardroom/components/NicheCard.tsx     swipeable NicheDossier stack
  apps/boardroom/components/EvidenceDrawer.tsx  click any number → cited source
  apps/kernel/src/gates.ts                    gate engine: open/surface/decide/timeout
  apps/boardroom/components/GateCard.tsx      niche_selection swipe_select UI
  RUN THE FULL M1 ACCEPTANCE CHECKLIST from 01-build-order.md §3. All boxes,
  including: delete a source_id → signing fails; kill orchestrator mid-D03 →
  restart resumes without re-running D02.
  TAG: m1-vertical-slice

── M7-lite: replay harness (immediately after M1) ───────────────────────
  scripts/replay.ts                     re-run one work_order with cached tools
  apps/boardroom/app/v/[ventureId]/replay/page.tsx  ?replay=demo-1 playback
  fixtures/demo-1/events.jsonl          append every real M1 run's events
  fixtures/demo-1/artifacts/*.json      one signed example of every artifact type
  CHECKPOINT: wifi off, ?replay=demo-1 plays the full M1 story.
  TAG: demo-ready-lite

# 5. ACCEPTANCE CRITERIA (the definition of done for THIS session)

□ pnpm install && pnpm build → 0 errors, all packages
□ pnpm test → green, under 60 seconds
□ M0 checklist (01-build-order.md §2) fully green, tagged m0-skeleton
□ M1 checklist (01-build-order.md §3) fully green, tagged m1-vertical-slice
□ "a tool for indie gyms to handle class no-shows" typed into the Boardroom
  produces ≥5 cited NicheDossier cards and a blocking niche_selection gate
  in under 4 minutes and under $6.00 metered spend
□ Evidence enforcement demonstrably rejects an uncited number
□ ?replay=demo-1 plays offline
□ BUILD-NOTES.md lists every deviation, blocker, and 30-minute-rule flip
□ No forbidden action from §3 was taken

# 6. WHEN THINGS GO WRONG

- Blocked >20 min on an upstream artifact → build against the fixture in
  fixtures/demo-1/artifacts/ and keep moving. Blocking is a choice.
- A vendor fights you >30 min → mock it, log it, move on.
- The critic loop argues → one revision, then quality:'contested', ship.
- Behind at T+11 → apply the M1 cut list in 01-build-order.md §3 top-down.
- Truly stuck → write the precise question in BUILD-NOTES.md, pick the
  cheapest-to-reverse interpretation, record it in assumptions[], continue.

Begin with §4 M0 block A. Do not ask for confirmation to start.

───────────────────────────── END PROMPT ─────────────────────────────
```

---

## 3. Lane addenda (swarm mode only) **POST-MVP**

When running 4 jcode lanes per [`02-speed-playbook.md`](02-speed-playbook.md) §2, append one of
these to each lane agent's copy of the prompt. The coordinator keeps the unmodified prompt.

```
LANE ADDENDUM — L1 KERNEL
You own: apps/kernel, apps/orchestrator, packages/contracts, packages/db,
packages/manifests/routing.yaml. You are the ONLY writer of packages/contracts.
You write it first, alone, then broadcast "contracts v1 frozen". You process
CONTRACTS-REQUESTS.md at T+6 and T+16 only. If a change requires touching another
lane's package, DM that lane. Do not edit their files.
```

```
LANE ADDENDUM — L2 DEPARTMENTS
You own: packages/agent-kit, packages/prompts, packages/manifests/D*.yaml.
You start 45 minutes after L1, when contracts freeze. Until then, draft prompt
files (they have no type dependency). Build every department against the fixture
inputs in fixtures/demo-1/artifacts/, never against a live upstream department.
```

```
LANE ADDENDUM — L3 BOARDROOM
You own: apps/boardroom, packages/ui. Your only dependency is the event taxonomy
in contracts — never another department's implementation. Cards render from
fixture events until real ones exist. Polish order: legibility → motion → charm.
Nothing below "charm" before m1-vertical-slice.
```

```
LANE ADDENDUM — L4 INTEGRATIONS
You own: packages/tool-plane, packages/sandbox, services/*, infra/, fixtures/,
scripts/. Every tool gets a mock driver FIRST with realistic latency. The
30-minute rule governs every real driver. You are also the fixture librarian:
every first success from any lane gets appended to fixtures/demo-1/.
```

---

## 4. What the prompt deliberately leaves out

| Omitted | Why |
|---|---|
| D04–D13 build instructions | MVP scope is M0+M1; the pattern is proven once, then repeated. See [`05-mvp-scope.md`](05-mvp-scope.md). |
| Vendor API keys and setup | They live in `.env` and the key-acquisition table in [`06-repo-layout.md`](06-repo-layout.md) §7. A prompt with keys in it gets pasted somewhere it shouldn't. |
| The demo narrative | The build agent optimizes for the acceptance checklists; the humans own the story, per [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md). |
| Model choice per call | The manifests carry `model:` per agent. The prompt would just drift from them. |
| jcode CLI syntax | Moves too fast to hard-code, per [`02-speed-playbook.md`](02-speed-playbook.md) §2's honest caveat. |

---

## 5. Prompt-maintenance protocol

| Rule | Detail |
|---|---|
| Version | Bump the tag comment at the top of the prompt whenever contracts or the build order change. |
| Single source | Sequence lives in [`01-build-order.md`](01-build-order.md); this prompt compresses, never contradicts. A diff between them is a bug in whichever changed last. |
| Dry-run | After any edit, paste into a throwaway session and check it reaches "M0 block A" actions within two turns without asking a question. A prompt that provokes a clarifying question has a hole; fill it. |
| Length budget | Under ~450 lines pasted. Past that, sessions skim, and skimming is how forbidden actions happen. Move detail into the docs and cite them. |

---

## Assumptions & open questions

- **Assumed:** the fresh session has the `docs/` symlink (or copy) of `architecture_files/`
  available at the repo root, per [`06-repo-layout.md`](06-repo-layout.md) §1. If the repo is
  truly empty, the human pastes the prompt *and* copies `docs/` in first.
- **Assumed:** Claude Code has network access for `pnpm install` and the Anthropic API, but the
  prompt still works offline-first because `ZEROTH_TOOLS=mock` is the default.
- **Open:** whether the M7-lite replay harness should be pulled even earlier (into M0 block F) so
  that fixture capture starts from the first seeded event. Current position: M0's seed script is
  enough until real M1 events exist.
- **Open:** whether lane addenda should also pin model tier (`haiku` for L4 fixture work). Left
  to the operator; the manifests govern in-product model choice either way.
