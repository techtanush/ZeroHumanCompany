# Build Status

Snapshot after the architecture completion pass. The repository now contains **78 architecture files** under `architecture_files/`.

## Complete coverage

| Area | Files |
|---|---|
| Start here | Index, north star, end-to-end journey, org chart, demo/judging, glossary, this status file |
| Platform | System architecture, agent runtime, event bus, data model, memory, HITL, identity, money/metering, Boardroom UI, observability, evidence/truth, safety/compliance, permissions, secrets, fallbacks, evaluation, API contracts, state machines |
| Departments | D00 template plus D01-D13, including D10 Sales and D13 continuous improvement |
| Integrations | Sponsor strategy plus Terac, Band, Stripe, Solari, Superserve/sandbox0, Linq, Replay, Render, Lovable, Whop, Dodo, Pioneer, Composio, ElevenLabs, Anthropic Claude |
| Execution | Build order, speed playbook, one-shot prompt, demo seed/fallbacks, MVP scope, repo layout, GitHub workflow, CI/testing, deployment, roadmap, dependency graph, risk register |
| Journeys | Founder journey, founder messaging, customer journey, account ceremony |
| Reference | Worker brief, product principles, agent roles, artifacts, KPIs, external research notes, decision log |

## What changed in this completion pass

- Added [`../02-departments/D10-sales.md`](../02-departments/D10-sales.md), the missing Sales & Revenue department spec.
- Added [`../03-integrations/15-anthropic-claude.md`](../03-integrations/15-anthropic-claude.md) for Claude API, Agent SDK, model routing, prompt caching, and Claude Code policy.
- Added [`../01-platform/17-api-contracts.md`](../01-platform/17-api-contracts.md) and [`../01-platform/18-state-machines.md`](../01-platform/18-state-machines.md).
- Added [`../04-execution/10-roadmap-and-milestones.md`](../04-execution/10-roadmap-and-milestones.md), [`../04-execution/11-dependency-graph.md`](../04-execution/11-dependency-graph.md), and [`../04-execution/12-risk-register.md`](../04-execution/12-risk-register.md).
- Added [`../06-reference/06-decision-log.md`](../06-reference/06-decision-log.md).
- Fixed stale cross-links from the old `00-vision/` directory name to `00-START-HERE/`.

## Remaining implementation work

These are not architecture gaps; they are build tasks for the next coding session.

1. Scaffold the repo layout in [`../04-execution/06-repo-layout.md`](../04-execution/06-repo-layout.md).
2. Implement shared schemas from [`../01-platform/04-data-model.md`](../01-platform/04-data-model.md), [`../01-platform/17-api-contracts.md`](../01-platform/17-api-contracts.md), and all department contract sections.
3. Build the kernel event store, reducer projections, gate engine, and SSE stream.
4. Build the Boardroom UI and seed trace from [`../04-execution/04-demo-seed-and-fallbacks.md`](../04-execution/04-demo-seed-and-fallbacks.md).
5. Connect MVP integrations in this order: Stripe test mode, Linq approvals, Composio Gmail/Calendar, Replay, Render.
6. Port the minimum simit service described in [`../02-departments/D05-synthetic-population.md`](../02-departments/D05-synthetic-population.md).

## Known cleanup

- Link check should be run whenever files move.
- Sponsor APIs, prices, and model names should be re-verified at implementation time because they change.
