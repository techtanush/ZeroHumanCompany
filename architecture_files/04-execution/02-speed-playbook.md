# 02 — Speed Playbook

How to build [`01-build-order.md`](01-build-order.md) in 36 hours without shipping garbage.

The premise: **the bottleneck is not model capability, it is coordination.** Four agents that
disagree about a type produce less than one agent that doesn't. Everything here is a mechanism for
letting many agents work at once while making disagreement structurally impossible.

---

## 1. The one decision that matters: contracts-first

> **`packages/contracts` is written by ONE agent, in one pass, before anything else exists.
> It is then frozen. Everything else in the monorepo is generated against it.**

This is not a style preference. It is the mechanism that makes parallelism safe.

```
                    ┌────────────────────────────┐
   ONE AGENT ──────►│   packages/contracts        │  ← written once, T+0 → T+0:45
   (nobody else)    │   artifacts.ts events.ts     │
                    │   messages.ts manifest.ts    │
                    └──────────────┬──────────────┘
                                   │ FROZEN
       ┌───────────────┬───────────┼────────────┬────────────────┐
       ▼               ▼           ▼            ▼                ▼
   apps/kernel    apps/boardroom  agent-kit  tool-plane      services/*
   (L1)           (L3)            (L2)       (L4)            (L4)
   4 lanes, zero coordination required, because the only shared vocabulary is immutable
```

### Why it works
Every cross-lane bug in a monorepo hackathon is one of: *"you named it `venture_id`, I named it
`ventureId`"*, *"I thought `NicheDossier.mrr` was a number"*, *"who owns the `signed` state?"*.
All three are contract disagreements. Freeze the contract and the class of bug stops existing.

### The freeze protocol
| Rule | Detail |
|---|---|
| **Ownership** | One named agent/human owns `packages/contracts`. Only they commit to it. |
| **Change requests** | Other lanes do **not** edit contracts. They open an issue in `CONTRACTS-REQUESTS.md`, one line, and keep working around it. |
| **Batch window** | The owner processes requests in **two batches only**: `T+6` and `T+16`. Nothing else. |
| **Additive only after T+6** | New optional fields and new schemas: fine. Renames and required-field additions: forbidden. A rename at `T+20` costs 4 lanes an hour each. |
| **Version stamp** | `export const CONTRACTS_VERSION = '1'` — bump only on a batch. Kernel logs it at boot so a stale worker is obvious. |
| **Escape hatch** | `z.record(z.unknown())` on any field you are not sure about yet. Loose beats wrong beats blocked. |

### What "complete" means for the first pass
Every artifact type in [`../00-START-HERE/05-glossary.md`](../00-START-HERE/05-glossary.md), every event in
the taxonomy in [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md), all three
messages, and the full `DepartmentManifest` from
[`../02-departments/D00-department-template.md`](../02-departments/D00-department-template.md).
**Even the ones for departments you may cut.** A schema you never use costs 90 seconds. A schema
missing at `T+20` costs an hour of four-way renegotiation.

---

## 2. jcode — running a swarm of build agents on this repo

[`jcode`](https://github.com/1jehuang/jcode) is a Rust agent harness by **Jesse Huang**
(`1jehuang` on GitHub). It exists because the per-session cost of an agent harness — boot time and
RAM — is what actually caps how many agents you can run at once. jcode drops that cost by
roughly two orders of magnitude, which changes parallel agent work from "a thing you carefully set
up" into "a thing you do by reflex."

### Verified numbers (from the repo's own benchmark table)

| Metric | jcode | Claude Code | Why it matters here |
|---|---|---|---|
| Time to first frame | **~14 ms** (10.1–19.3 ms range) | ~3.4 s | Spawning a throwaway agent for a 2-minute task stops feeling expensive |
| RAM, 1 session, minimal | **27.8 MB** | 140–386 MB across competitors | ~5–14× lighter |
| RAM per *additional* session | **~10 MB** | — | **8 concurrent agents ≈ 100 MB.** This is the whole point. |

### The features that matter for a 4-lane hackathon build

| Feature | What it does | How we use it |
|---|---|---|
| **Swarm file-edit notification** | The server detects when agent A edits a file agent B has read, and notifies B *before* B can ship a stale diff | This is the merge-conflict killer. It replaces "hope the worktrees don't collide." |
| **Agent DM + broadcast** | Agents can message each other directly, broadcast to all, or scope to a repo | `L1` broadcasts "contracts v1 frozen, pull now"; `L2` DMs `L1` a contract request |
| **Autonomous swarm spawning** | An agent can spawn its own teammates; the parent becomes a coordinator | One lane agent fans out to 3 sub-agents for the 13 department manifests |
| **Long-term semantic memory** | Every turn is embedded; similarity retrieval, passive extraction, automatic consolidation | The build agents keep the architecture docs in recall across a 36-hour session |
| **Provider reuse** | Native OAuth to Claude, OpenAI, Copilot, Gemini, Azure, plus ~20 aggregators | Runs on the **subscriptions you already have** — no extra spend on the day |

### Install (verified from the repo)

```bash
# macOS / Linux
curl -fsSL https://jcode.sh/install | bash

# Windows 11 (PowerShell 5.1+)
irm https://jcode.sh/install.ps1 | iex
```

### Verified CLI surface

```bash
jcode                     # interactive TUI
jcode run "…"             # single non-interactive command
jcode --resume <name>     # resume a named session
jcode serve               # background server mode  ← REQUIRED for swarm coordination
jcode connect             # attach a new client to the running server
jcode dictate             # voice input
```

> **Honest caveat.** `serve` + `connect` + the swarm notification behaviour are documented in the
> repo; the exact flag syntax for spawning a named swarm member and for DM/broadcast was **not
> confirmed** at the time of writing and moves fast (the project was at ~v0.75 in Aug 2026).
> Run `jcode --help` and `jcode serve --help` on the day. **Do not spend more than 20 minutes
> getting the swarm working.** If it fights you, fall back to §5 (git worktrees + plain sessions),
> which gets you most of the benefit.

### The concrete setup for this repo

```bash
# once, at T+0, on the machine that will host the swarm
jcode serve &                    # one server, all agents coordinate through it

# then one client per package boundary — NOT one per feature
jcode connect   # → L1  scope: apps/kernel, packages/{contracts,db,manifests}
jcode connect   # → L2  scope: packages/{agent-kit,prompts}, all D0N manifests
jcode connect   # → L3  scope: apps/boardroom, packages/ui
jcode connect   # → L4  scope: packages/tool-plane, services/*, infra/, fixtures/
```

```
                    ┌───────────────────────┐
                    │   jcode serve         │
                    │   (one process)       │
                    │   · file-edit watch   │
                    │   · DM / broadcast    │
                    │   · shared memory     │
                    └──┬────┬────┬────┬─────┘
                       │    │    │    │
                    ┌──▼─┐┌─▼──┐┌▼───┐┌▼───┐
                    │ L1 ││ L2 ││ L3 ││ L4 │   ~10 MB each
                    │kern││dept││room││intg│
                    └────┘└────┘└────┘└────┘
                       └────┴────┴────┴──► ONE repo, ONE main branch
```

**The swarm's actual job is one thing:** when L1 edits `packages/contracts/src/artifacts.ts`,
L2/L3/L4 — who all have that file in their context — get told *immediately*, before they build 40
minutes of code against a schema that no longer exists. That single notification is worth more than
all the speed numbers combined.

### Scope discipline (the part people get wrong)
Assign each agent a **package boundary**, never a feature. "Build the sales flow" touches four
packages and four agents; "own `packages/agent-kit`" touches one. Feature-scoped agents collide;
package-scoped agents don't. Restate the boundary in the agent's opening prompt: *"You own
`apps/boardroom` and `packages/ui`. If a change requires touching anything else, DM the owning
agent, don't do it yourself."*

---

## 3. Where jcode helps vs where Claude Code stays in charge

Be honest about this or you will waste hours in the wrong tool.

| Use jcode swarm for | Keep the Claude Code session for |
|---|---|
| Bulk generation of 13 near-identical department manifests + prompt files | Deciding what goes in `packages/contracts` |
| Boilerplate: routes, Drizzle schema, React card components, tool-plane driver stubs | The Head loop, the critic loop, the gate engine — the parts where a subtle design error is expensive |
| Writing the fixture JSON for every artifact type | Anything touching the demo narrative |
| Repetitive porting (simit → `services/simpop`) | Debugging cross-service failures with full-repo context |
| Test scaffolding, `.env.example`, docker-compose, CI | The one-shot prompt in [`03-one-shot-prompt.md`](03-one-shot-prompt.md) and the M7 rehearsal |
| Running 4 lanes overnight while humans sleep | Merge arbitration when two lanes disagree |

**Rule of thumb:** jcode for *volume*, Claude Code for *judgment*. The moment a task needs someone
to hold the whole architecture in their head and make a tradeoff, it is not a swarm task.

**And the meta-rule:** the tooling is a means. If at `T+2` you are still configuring the swarm, you
have already lost more time than the swarm will save. Ship M0 first, parallelize second.

---

## 4. Parallelism discipline

### 4.1 Package boundaries as the unit of work
The monorepo layout in [`06-repo-layout.md`](06-repo-layout.md) is drawn so that the four lanes in
[`01-build-order.md`](01-build-order.md) §11 have **near-zero file overlap**. That is a design
constraint, not a coincidence. The only shared file is `packages/contracts`, which is frozen and
single-owner. Corollary: if you find yourself wanting a fifth lane, find a fifth package boundary
first — don't split a lane in half.

### 4.2 Git worktrees per agent

```bash
git worktree add ../zeroth-L1 -b lane/kernel
git worktree add ../zeroth-L2 -b lane/departments
git worktree add ../zeroth-L3 -b lane/boardroom
git worktree add ../zeroth-L4 -b lane/integrations
```

Each agent gets its own checkout, its own `node_modules` (or a shared pnpm store — pnpm's
content-addressed store makes four worktrees cheap), its own dev server on its own port.
No agent ever sees another's half-finished file on disk.

> jcode's file-edit notification works *within* one repo view. Worktrees give you isolation;
> the notification gives you awareness. Use both: worktrees so nobody stomps, notification on the
> shared `packages/contracts` path so nobody drifts. If you must pick one, pick worktrees.

### 4.3 Merge cadence

**Every 45 minutes. To `main`. Always green.**

```
T+0:45  L1 merges (contracts lands first, always)
T+1:00  L2, L3, L4 rebase onto main
T+1:30  all lanes merge
T+2:15  all lanes merge
…
```

| Rule | Reason |
|---|---|
| Rebase, never merge-commit, on lane branches | The `main` history stays readable at 4am |
| `pnpm build && pnpm test` before every merge | Red `main` blocks 4 lanes; the arithmetic is 4× |
| A lane that can't merge for 90 minutes **splits its branch** | Long-lived branches are how monorepo hackathons die |
| Contracts merge **first** in every window | Everyone else rebases onto the new truth |
| Tag every milestone | Rollback points, per [`01-build-order.md`](01-build-order.md) §13 |

### 4.4 The daily-standup-equivalent
A broadcast on the jcode mesh (or a pinned message) at each merge window, three lines:
`done / doing / blocked-on-whom`. If a lane is blocked on another lane for >20 minutes, it switches
to a **fixture** and unblocks itself. Blocking is a choice.

---

## 5. Accelerators

### 5.1 Schema-driven codegen from Zod
`packages/contracts` is Zod, so generate rather than hand-write:

| Generate | From | Tool |
|---|---|---|
| Postgres tables + migrations | Zod artifact schemas | `drizzle-zod` (or a 40-line script) |
| JSON Schema for LLM structured output | Zod | `zod-to-json-schema` — feed straight into the Agent SDK output contract |
| TS types for the Boardroom | Zod | `z.infer` — no duplication, ever |
| Fixture skeletons | Zod | a script that walks the schema and emits a filled example |
| Fake data for the seeded event log | Zod | same script with a faker |

**One source, five outputs.** The hour spent writing the generator pays back by `T+8`.

### 5.2 Seeded fixtures over live APIs during dev
Nobody develops against a live vendor API. Every department is built against a committed fixture
input in `fixtures/demo-1/artifacts/`, and only pointed at the real upstream once it works. This
is what makes the DAG in [`01-build-order.md`](01-build-order.md) §1 parallel instead of serial,
and it doubles as the demo safety net ([`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md)).

### 5.3 Mock-first tool plane with a one-line flip

```ts
// packages/tool-plane/src/index.ts
const driver = process.env.ZEROTH_TOOLS === 'real' ? realDrivers : mockDrivers;
```

Every tool — Composio, Solari, Stripe, Terac, Whop, Apify, ElevenLabs, Render, Replay — has two
implementations behind one interface. Mocks return **fixture data with realistic latency** (a
`setTimeout` of the real p50), so timing bugs surface in dev, not on stage.

| Flip | Where |
|---|---|
| `ZEROTH_TOOLS=mock` | default, local, all four lanes, 90% of the build |
| `ZEROTH_TOOLS=real` | integration spikes, M7 rehearsal, stage |
| Per-tool override `ZEROTH_TOOLS_STRIPE=real` | the demo runs *most* things live and a couple mocked |

The per-tool override is the single most valuable line in this document. It is also exactly the
switch the fallback table in [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) pulls.

### 5.4 Prompts as data, not code
`packages/prompts/**/*.md` are read from disk at run time, not compiled in. Consequences:

- Iterating on a department's behaviour is **editing a markdown file**, no rebuild, no redeploy.
- Two lanes can tune prompts and manifests concurrently with zero merge risk (different files).
- D13 can *write* new prompts at runtime — the finale in
  [`01-build-order.md`](01-build-order.md) §8 depends on this.
- A human can review a diff of the company's own reasoning.

Same for `packages/manifests/*.yaml` and `routing.yaml`. **Behaviour lives in data; only mechanism
lives in code.** During the demo, a prompt tweak is a 3-second fix instead of a 3-minute deploy.

### 5.5 Turborepo remote caching

```bash
npx turbo login && npx turbo link
```

Four lanes × four worktrees × a rebuild every merge window = a lot of duplicated compilation.
Remote cache means L3's `pnpm build` reuses L1's contracts build artifact. Set it up at `T+0:15`;
it takes five minutes and saves multiple hours across 36.

Pipeline shape (full version in [`06-repo-layout.md`](06-repo-layout.md) §4): `contracts#build`
is the root dependency of everything, so it caches once and fans out.

### 5.6 `haiku` for the boring 80%
Per the model tiering policy in
[`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md):

| Tier | Share of calls | Used for |
|---|---|---|
| `haiku` | ~80% | extraction, dedup, classification, formatting, claim tagging, lead scoring, ticket triage |
| `sonnet` | ~18% | workers, critics, writing |
| `opus` | ~2% | Heads, D06 pivot synthesis, D13 agent design |

This is both a cost lever and a **latency** lever, and latency is what the demo actually feels. A
D03 fan-out of 10 haiku workers returns in a fraction of the time 10 sonnet workers would, and the
floor plan lighting up fast is the visual. Reserve judgment models for judgment.

### 5.7 Small compounding wins
- **One `pnpm dev`** that boots everything (turbo + `concurrently`). Four lanes × 36 hours ×
  fumbling with four terminals is real time.
- **Log the event, not the prose.** Debugging an event-sourced system means reading the log; make
  `pnpm log --venture=demo-1 --tail` exist on day one.
- **`scripts/replay.ts <work_order_id>`** re-runs a single agent with cached tool responses.
  Iterating on a D03 prompt without re-running D01 and D02 is a 10× loop-speed win.
- **Write `demo-1` fixtures as you go.** Every first success gets appended to
  `fixtures/demo-1/events.jsonl`. M7 becomes assembly, not capture.

---

## 6. Anti-patterns that eat hackathon hours

Each of these has killed a real hackathon project. They are ordered by how much time they cost.

### 6.1 Unbounded critic loops — *cost: 3h and your token budget*
A Head and a Critic will happily argue until 2am. **One revision loop, maximum.** Critic rejects
twice ⇒ ship `quality: contested` and render it in the UI as a chip. Already an invariant in
[`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md); repeated here because
it is the one people re-litigate at 3am when output quality feels off. The fix for bad output is a
better prompt, not another loop.

### 6.2 Building auth — *cost: 4h, wins: nothing*
There is one founder. There is no login. `venture_id` in the URL is the entire access model. A
judge has never once asked "but how do you handle sessions." If you need to gate the Boardroom on a
public URL, use a single shared bearer token in an env var and move on.

### 6.3 Premature multi-tenancy — *cost: 3h, spread invisibly*
Every table gets a `venture_id` column — that is the *entire* multi-tenancy story, and it is enough
for `?replay=demo-1` to coexist with a live run. No orgs, no roles, no RLS policies, no tenant
middleware. [`../00-START-HERE/01-north-star.md`](../00-START-HERE/01-north-star.md) declares this a
non-goal in writing. Believe it.

### 6.4 Chasing a flaky vendor API — *cost: 2–5h, and it is always the same 2 hours*
The failure mode: a sponsor API is undocumented or rate-limited or the key doesn't arrive, and
someone burns the afternoon on it because the track is worth winning.

**The 30-minute rule.** Start a timer when you begin integrating any vendor. At 30 minutes, if you
do not have one successful round-trip:
1. Flip that tool to `mock` with realistic fixture output.
2. Log the exact blocker in [`12-risk-register.md`](12-risk-register.md).
3. Go find the sponsor's engineer at the venue and hand them the blocker. **They are in the room.**
4. Move to the next task. Return only if they unblock you.

Every integration spec in [`../03-integrations/`](../03-integrations/) documents a fallback. Use it.
The demo narrative never depends on a single vendor being up — see the fallback table in
[`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md).

### 6.5 Polishing the UI before the vertical slice works — *cost: 5h, the most seductive one*
The Boardroom is beautiful and building it is fun, and it will absorb unlimited hours. The order is
fixed: **M0 shell → M1 real cards → then polish.** Isometric sprites are M1 §1.10, not M0. Shadows,
easing, and particle effects are M7 or never.

The counter-question that settles every argument: *"does this change what a judge understands in
the first four seconds?"* Room lighting up: yes. Sprite walk animation: yes. Easing curve on the
budget bar: no.

### 6.6 The runners-up
| Anti-pattern | Instead |
|---|---|
| Writing tests for LLM output | Test the *schema validation* and the *reducers*. Prompts are tuned by eye. |
| A generic plugin/extension system | 13 hardcoded manifests. D13 generates a 14th; that is the only extensibility that earns its keep. |
| Real-time collaborative anything | One founder, one browser. |
| Perfecting the Rust `simpop` port | It needs to return a correctly weighted `SyntheticPanelResult`. It does not need to be idiomatic Rust. |
| Refactoring at `T+28` | Tag, freeze, harden. Refactoring during M7 is how demos break. |
| Debating a name for 15 minutes | It is in [`../00-START-HERE/05-glossary.md`](../00-START-HERE/05-glossary.md). Look it up. |

---

## 7. The speed checklist

Pin this. Tick it in the first hour.

```
□ pnpm + Turborepo workspace up, `pnpm build` green
□ `npx turbo link` — remote cache on
□ packages/contracts written by ONE agent, complete, tagged, broadcast to all lanes
□ CONTRACTS-REQUESTS.md exists; batch windows T+6 and T+16 agreed out loud
□ 4 git worktrees, 4 lane branches, 4 ports
□ jcode installed (curl -fsSL https://jcode.sh/install | bash), `jcode serve` running,
  4 clients connected, package boundaries stated in each agent's opening prompt
  — TIMEBOXED TO 20 MINUTES, then fall back to plain sessions + worktrees
□ ZEROTH_TOOLS=mock is the default and every tool has a mock
□ fixtures/demo-1/ exists and is being appended to from the first working department
□ 45-minute merge alarm set, on every machine
□ Model tiers assigned per agent in the manifests (haiku for the boring 80%)
□ Somebody owns the clock and calls the cuts from 01-build-order.md
```

---

## Sources

- [github.com/1jehuang/jcode](https://github.com/1jehuang/jcode) — install command, benchmark
  table (14 ms TTFF, 27.8 MB baseline, ~10 MB/session), swarm file-edit notification, DM/broadcast,
  semantic memory, provider list, CLI surface.
- [I Ran 4 Claude Code Agents in 1 Repo on 18 Tasks](https://pub.towardsai.net/i-ran-4-claude-code-agents-in-1-repo-on-18-tasks-jcodes-14ms-boot-killed-my-sequential-workflow-cc32509ab67c)
  — reported 3.8× wall-clock speedup (6h12m → 1h38m) on 18 tasks with 4 parallel agents; notes the
  article does not document exact swarm CLI syntax.
- [jcode Rust Agent Harness — Swarm & Memory](https://explainx.ai/blog/jcode-agent-harness-swarm-memory-performance-july-2026)
  — autonomous swarm spawning (parent becomes coordinator, spawned agents become workers).
