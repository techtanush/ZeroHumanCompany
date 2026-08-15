# ZEROTH — The AI-Run Agency That Turns Anyone Into a Founder

> Built for the **Zero-Human Company Hackathon by Terac** (Humanmade, 655 Bryant St, SF).
> Challenge: *"build an agent that can run a business on its own: making decisions, handling operations, and executing with little to no human input."*

**ZEROTH** is not an agent. It is a **company** — twelve autonomous departments, a shared kernel
(`CompanyOS`), a treasury that allocates its own budget, and an escalation ladder that ends in
*hiring real humans through Terac* when silicon hits a wall.

You bring an idea (or none at all). Zeroth runs office hours on it, researches the market,
calls real humans in your cloned voice, simulates the ones it can't reach against US Census
microdata, pivots the idea on real evidence, builds the product, finds leads, sells, takes
payment, supports customers, and then — the ambitious part — **notices where it is weak and
writes new agents for itself.**

---

## How to read this repo

Read in this order. Each file is self-contained and written so a *fresh* Claude Code session can
one-shot its slice without asking questions.

| # | Path | What it gives you |
|---|------|-------------------|
| 1 | [`00-vision/01-north-star.md`](00-vision/01-north-star.md) | Why this exists, the thesis, non-negotiables |
| 2 | [`00-vision/02-end-to-end-journey.md`](00-vision/02-end-to-end-journey.md) | The full user flow, scene by scene |
| 3 | [`00-vision/03-org-chart.md`](00-vision/03-org-chart.md) | The 12 departments + who reports to whom |
| 4 | [`00-vision/04-demo-and-judging.md`](00-vision/04-demo-and-judging.md) | The 4-minute demo, track-by-track win strategy |
| 5 | [`00-vision/05-glossary.md`](00-vision/05-glossary.md) | Every noun used in this repo, defined once |
| 6 | [`01-platform/*`](01-platform/) | The kernel: runtime, data model, event bus, memory, HITL, identity, money, observability |
| 7 | [`02-departments/*`](02-departments/) | One spec per department. Agents, prompts, tools, I/O contracts, DoD |
| 8 | [`03-integrations/*`](03-integrations/) | One spec per sponsor/vendor, with the *creative* usage that wins the track |
| 9 | [`04-execution/*`](04-execution/) | Build order, speed playbook, the one-shot build prompt, demo seed data |

**If you are a builder agent and read only one more file after this one, read
[`04-execution/01-build-order.md`](04-execution/01-build-order.md).**

---

## The one-paragraph architecture

A **Next.js control room** (the Boardroom) talks to a **CompanyOS kernel** — a Postgres-backed
event-sourced state machine that owns Ventures, Artifacts, Decisions, Budgets, and Escalations.
Departments are **manifest-defined swarms** of Claude agents (`@anthropic-ai/claude-agent-sdk`)
that execute inside **Superserve** Firecracker sandboxes, coordinate over the **Band** agentic mesh
(with an in-Postgres fallback bus), reach the outside world through **Composio** connectors and
**Solari** computer-use for anything without an API, take money through **Stripe**, and escalate to
the founder over **Linq** — or to a paid human expert over **Terac** — when they cannot proceed.
Everything an agent does is an append-only event; the Boardroom is just a projection of that log.

---

## Non-negotiable invariants

These hold in every file. If a spec ever contradicts one of these, this file wins.

1. **Every side effect is an event.** No agent mutates state directly. `emit()` → reducer → state.
2. **Every irreversible action needs a gate.** Money out, public content, emails to real people,
   and account creation pass through the Approval Protocol (`01-platform/06-human-in-the-loop.md`).
3. **Every claim carries evidence.** Market numbers, personas, and pivots cite a `source_id`.
   Fabricated numbers are a P0 bug, not a rounding error.
4. **Every department is replaceable.** Departments talk only through typed contracts, never
   through each other's internals.
5. **Autonomy is a dial, not a switch.** `venture.autonomy_level ∈ {copilot, supervised, autonomous}`
   changes which gates auto-approve. The demo runs `autonomous` with a kill switch.
6. **The company knows what it costs.** Every LLM call, sandbox-second, and API hit is metered to a
   department budget. An out-of-budget department stops working and files a request with Treasury.

---

## Status

These are **architecture files only**. No implementation lives here yet.
`04-execution/03-one-shot-prompt.md` is the handoff artifact for the session that builds it.
