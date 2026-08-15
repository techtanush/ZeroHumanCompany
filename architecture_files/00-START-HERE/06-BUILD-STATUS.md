# Build status — what exists and what is still missing

Snapshot taken when authoring was stopped. 63 files, ~25k lines.

## Complete
- `00-START-HERE/` — index, north star, end-to-end journey, org chart, demo/judging, glossary
- `01-platform/` — 01 system architecture, 02 agent runtime, 03 event bus, 04 data model,
  05 memory, 06 human-in-the-loop, 07 identity, 08 money/metering, 09 boardroom UI,
  10 observability, 11 evidence & truth, 12 safety & compliance, 13 permissions,
  14 secrets & vault, 15 error handling & fallbacks
- `02-departments/` — D00 template, D01 intake, D02 office hours, D03 market research,
  D04 outreach & validation, D06 pivot & decision, D07 build, D08 strategy, D09 leads,
  D11 finance & HR, D12 support
- `03-integrations/` — 00 sponsor strategy, 01 Terac, 02 Band, 03 Stripe, 04 Solari,
  05 Superserve, 06 Linq, 07 Replay, 08 Render, 09 Lovable, 10 Whop, 11 Dodo
- `04-execution/` — 01 build order, 02 speed playbook, 03 one-shot prompt,
  04 demo seed & fallbacks, 05 MVP scope, 06 repo layout, 07 source control & GitHub
- `05-journeys/` — 01 founder journey, 02 founder messaging flows, 03 customer journey
- `06-reference/` — 00 worker brief, 01 product principles, 02 agent roles catalog,
  03 artifact catalog, 04 KPI dictionary

## Still to write (next session — briefs are in `06-reference/00-WORKER-BRIEF.md`)
| Path | Content |
|---|---|
| `02-departments/D05-synthetic-population.md` | simit port: PUMS sampling, PWGTP weights, archetype clustering, post-stratified polling, rubric validation, axum API, synthetic-evidence labeling rule |
| `02-departments/D10-sales.md` | sequences, objections, deal state machine, CRM schema, forecasting, Linq deal cards |
| `02-departments/D13-chief-of-staff.md` | review cycles, CapabilityGap taxonomy, shadow-test → eval → canary → rollback pipeline |
| `03-integrations/12-pioneer-fastino.md` | fine-tuned small models for high-volume classification |
| `03-integrations/14-elevenlabs-voice.md` | voice interviewer, cloning consent, disclosure |
| `03-integrations/15-anthropic-claude.md` | Agent SDK, model routing, prompt caching, Claude Code in D07 |
| `01-platform/17-api-contracts.md` | kernel REST + SSE surface, webhook receivers |
| `01-platform/18-state-machines.md` | every state machine in one place (mermaid) |
| `04-execution/08-cicd-and-testing.md` | CI, test pyramid, Replay gating, release/rollback |
| `04-execution/10-roadmap-and-milestones.md` | hour-by-hour, then W1/M1/Q1 |
| `04-execution/11-dependency-graph.md` | build DAG + critical path |
| `04-execution/12-risk-register.md` | risk table with mitigations and owners |
| `05-journeys/05-account-ceremony.md` | blocked-credential workflow (CAPTCHA, 2FA, ID, payment) |
| `06-reference/06-decision-log.md` | ADRs for the decisions already baked in |

## Known cleanup
- `02-departments/D06-pivot-and-decision.md` may exist as a duplicate of `D06-pivot-decision.md`;
  keep the latter (it is the cross-linked name) and delete the former.
- Run a link check across all files; several docs link to files in the "still to write" list.
