# Build Tutorial

Purpose: give the coding agent one exact reading and build path for turning these architecture files into the actual ZEROTH product.

> Rule: do not start coding from a department file. Start with the contracts, event spine, gates, and Boardroom projection. Departments are replaceable; the kernel is not.

## 0. Operating mode for the coding agent

1. Read the files in the order below.
2. Build in milestones, not by folder.
3. Keep `packages/contracts` ahead of every other package.
4. Every user-visible or external side effect must go through an event and, where required, a gate.
5. If an integration is unavailable, use the documented mock or replay fixture and label it honestly in the UI.
6. At the end of each milestone, commit a working state with a short message and run the checks listed in [`04-execution/08-cicd-and-testing.md`](04-execution/08-cicd-and-testing.md).

## 1. First read: product, demo, and current status

Read these before writing code. They define what must be true on stage.

| Order | File | What to extract |
|---:|---|---|
| 1 | [`00-START-HERE/00-README-INDEX.md`](00-START-HERE/00-README-INDEX.md) | The one-paragraph architecture and non-negotiable invariants |
| 2 | [`00-START-HERE/01-north-star.md`](00-START-HERE/01-north-star.md) | Product thesis, ambition, what not to compromise |
| 3 | [`00-START-HERE/02-end-to-end-journey.md`](00-START-HERE/02-end-to-end-journey.md) | Full founder-to-revenue journey |
| 4 | [`00-START-HERE/03-org-chart.md`](00-START-HERE/03-org-chart.md) | Department roster and reporting model |
| 5 | [`00-START-HERE/04-demo-and-judging.md`](00-START-HERE/04-demo-and-judging.md) | The 4-minute demo sequence and sponsor-track strategy |
| 6 | [`00-START-HERE/05-glossary.md`](00-START-HERE/05-glossary.md) | Canonical names for artifacts, events, and concepts |
| 7 | [`00-START-HERE/06-BUILD-STATUS.md`](00-START-HERE/06-BUILD-STATUS.md) | What architecture is complete and what implementation remains |
| 8 | [`06-reference/00-WORKER-BRIEF.md`](06-reference/00-WORKER-BRIEF.md) | Shared context for every build agent |
| 9 | [`06-reference/01-product-principles.md`](06-reference/01-product-principles.md) | The product rules that should shape every tradeoff |
| 10 | [`06-reference/06-decision-log.md`](06-reference/06-decision-log.md) | Architecture decisions already accepted |

Deliverable after this read: a short implementation note in the PR/commit body confirming the build will prioritize event spine, gates, and Boardroom before live integrations.

## 2. Second read: execution plan and repository scaffold

These files tell you how to build without getting lost.

| Order | File | What to do with it |
|---:|---|---|
| 11 | [`04-execution/01-build-order.md`](04-execution/01-build-order.md) | Treat this as the master milestone plan |
| 12 | [`04-execution/02-speed-playbook.md`](04-execution/02-speed-playbook.md) | Follow its contracts-first and parallel-lane rules |
| 13 | [`04-execution/05-mvp-scope.md`](04-execution/05-mvp-scope.md) | Cut scope against this file, not by instinct |
| 14 | [`04-execution/06-repo-layout.md`](04-execution/06-repo-layout.md) | Scaffold the monorepo exactly from this layout |
| 15 | [`04-execution/10-roadmap-and-milestones.md`](04-execution/10-roadmap-and-milestones.md) | Confirm what is hackathon MVP vs post-MVP |
| 16 | [`04-execution/11-dependency-graph.md`](04-execution/11-dependency-graph.md) | Use the DAG to avoid fake blockers |
| 17 | [`04-execution/12-risk-register.md`](04-execution/12-risk-register.md) | Add fallback switches before live-vendor work |

Build after this read:

1. Create the monorepo skeleton from [`04-execution/06-repo-layout.md`](04-execution/06-repo-layout.md).
2. Add `pnpm-workspace.yaml`, root scripts, TypeScript config, lint/format config, `.env.example`, and Docker Compose.
3. Create empty package/app directories with short `README.md` files naming owner and milestone.
4. Do not implement departments yet.

Checkpoint: `pnpm install`, `pnpm build`, and `docker compose up -d` should succeed or fail only on documented missing secrets.

## 3. Build M0: contracts, event store, kernel API, Boardroom shell

Read these platform files in order, then implement the base system.

| Order | File | Build output |
|---:|---|---|
| 18 | [`01-platform/01-system-architecture.md`](01-platform/01-system-architecture.md) | Service boundaries and runtime topology |
| 19 | [`01-platform/04-data-model.md`](01-platform/04-data-model.md) | Drizzle/Postgres schema and projections |
| 20 | [`01-platform/03-event-bus.md`](01-platform/03-event-bus.md) | Event taxonomy, message shape, routing |
| 21 | [`01-platform/17-api-contracts.md`](01-platform/17-api-contracts.md) | REST, SSE, webhook, and auth API contracts |
| 22 | [`01-platform/18-state-machines.md`](01-platform/18-state-machines.md) | Reducer transition rules |
| 23 | [`01-platform/10-observability.md`](01-platform/10-observability.md) | Trace ids, logs, metrics, audit trail |
| 24 | [`01-platform/09-boardroom-ui.md`](01-platform/09-boardroom-ui.md) | UI shell, floor plan, timeline, cards |

Build:

1. Implement `packages/contracts` first: artifacts, events, messages, manifests, API DTOs, state enums.
2. Implement `packages/db` schema and migrations.
3. Implement `apps/kernel`: event append, artifact registry, work orders, reducers, SSE, health endpoint.
4. Implement `apps/boardroom`: venture route, event log, room grid, projection cards, SSE reconnect.
5. Add seed events so the Boardroom has life before agents exist.

M0 acceptance:

- `pnpm build` passes.
- Kernel `/health` returns healthy.
- A posted event appears in the Boardroom without refresh.
- Seed trace renders rooms, timeline, and artifact cards.

## 4. Build M1: agent runtime and first discovery slice

Read these files, then implement the repeatable department pattern.

| Order | File | Build output |
|---:|---|---|
| 25 | [`01-platform/02-agent-runtime.md`](01-platform/02-agent-runtime.md) | Head/worker/critic loop |
| 26 | [`02-departments/D00-department-template.md`](02-departments/D00-department-template.md) | Manifest schema and prompt structure |
| 27 | [`03-integrations/15-anthropic-claude.md`](03-integrations/15-anthropic-claude.md) | Claude model routing and Claude Code policy |
| 28 | [`01-platform/05-memory-and-context.md`](01-platform/05-memory-and-context.md) | Venture memory and context windows |
| 29 | [`01-platform/11-evidence-and-truth.md`](01-platform/11-evidence-and-truth.md) | Source capture and anti-hallucination enforcement |
| 30 | [`02-departments/D01-intake.md`](02-departments/D01-intake.md) | Intake manifest, prompts, `IdeaSeed` |
| 31 | [`02-departments/D02-office-hours.md`](02-departments/D02-office-hours.md) | Office-hours interrogation and `SharpenedIdea` |
| 32 | [`02-departments/D03-market-research.md`](02-departments/D03-market-research.md) | Research swarm and `NicheDossier` |

Build:

1. Implement `packages/manifests` loader and validator.
2. Implement `packages/agent-kit` Head/worker/critic runner with one revision loop.
3. Implement mock tools for web search/fetch and memory reads.
4. Implement D01-D03 manifests and prompts.
5. Enforce evidence on signed numeric claims.
6. Render `IdeaSeed`, `SharpenedIdea`, and `NicheDossier` cards in the Boardroom.

M1 acceptance:

- Text idea -> D01 -> D02 -> D03 produces signed artifacts.
- Evidence drawer opens cited sources.
- Missing `source_id` blocks signing.
- A `niche_selection` gate blocks the next work order until approved.

## 5. Build M2: validation, synthetic population, pivot decision

Read:

| Order | File | Build output |
|---:|---|---|
| 33 | [`02-departments/D04-outreach-validation.md`](02-departments/D04-outreach-validation.md) | Outreach/customer discovery workflow |
| 34 | [`02-departments/D05-synthetic-population.md`](02-departments/D05-synthetic-population.md) | simit-derived synthetic panel service |
| 35 | [`02-departments/D06-pivot-decision.md`](02-departments/D06-pivot-decision.md) | Product diffs, approval, and `ProductSpec` |
| 36 | [`05-journeys/01-founder-journey.md`](05-journeys/01-founder-journey.md) | Founder-facing flow details |
| 37 | [`05-journeys/02-founder-messaging-flows.md`](05-journeys/02-founder-messaging-flows.md) | Approval card copy and messaging behavior |
| 38 | [`05-journeys/05-account-ceremony.md`](05-journeys/05-account-ceremony.md) | CAPTCHA, 2FA, payment, account-ownership blockers |

Build:

1. Add D04-D06 contracts, prompts, and fixtures.
2. Port minimum `services/simpop` from `simit`: PUMS weights, archetype clustering, weighted polling, cache.
3. Label synthetic evidence clearly and prevent it from being the only proof for a pivot.
4. Implement founder approval cards for pivot decisions.

M2 acceptance:

- Interview claims and synthetic panel results both render.
- `ProductSpec` is produced only after D06 approval.
- Synthetic-only evidence cannot pass a load-bearing decision.

## 6. Build M3: product build, QA, deployment

Read:

| Order | File | Build output |
|---:|---|---|
| 39 | [`02-departments/D07-build.md`](02-departments/D07-build.md) | Build department, Claude Code, QA, deployment handoff |
| 40 | [`04-execution/07-source-control-and-github.md`](04-execution/07-source-control-and-github.md) | Branch, commit, PR, and deployment rules |
| 41 | [`04-execution/08-cicd-and-testing.md`](04-execution/08-cicd-and-testing.md) | Test pyramid, CI, Replay gates |
| 42 | [`04-execution/09-deployment-architecture.md`](04-execution/09-deployment-architecture.md) | Render/deployment architecture and rollback |
| 43 | [`03-integrations/07-replay.md`](03-integrations/07-replay.md) | Replay QA integration |
| 44 | [`03-integrations/08-render.md`](03-integrations/08-render.md) | Render deployment integration |
| 45 | [`03-integrations/09-lovable.md`](03-integrations/09-lovable.md) | Optional marketing/build split |

Build:

1. Implement D07 manifest and Build artifacts.
2. Implement source-control adapter: branch creation, commit trailers, PR creation, no force-push to main.
3. Implement deployment artifact and health checks.
4. Add Replay or Playwright smoke checks for the MVP flow.
5. Render deployment/QA status in the Boardroom.

M3 acceptance:

- D07 consumes `ProductSpec` and emits a `Deployment`.
- Failed QA creates a visible bug report and fix loop.
- Production deploy requires a gate.

## 7. Build M4: GTM, leads, sales, revenue

Read:

| Order | File | Build output |
|---:|---|---|
| 46 | [`02-departments/D08-strategy.md`](02-departments/D08-strategy.md) | GTM plan, messaging, pricing, experiment design |
| 47 | [`02-departments/D09-leads.md`](02-departments/D09-leads.md) | Lead sourcing, enrichment, consent, scoring |
| 48 | [`02-departments/D10-sales.md`](02-departments/D10-sales.md) | Sales sequences, deals, objections, order requests |
| 49 | [`02-departments/D11-finance-hr.md`](02-departments/D11-finance-hr.md) | Ledger, Stripe, budget allocation, HR/Terac |
| 50 | [`03-integrations/03-stripe.md`](03-integrations/03-stripe.md) | Stripe payment lifecycle |
| 51 | [`03-integrations/06-linq.md`](03-integrations/06-linq.md) | Founder approval and messaging cards |
| 52 | [`03-integrations/13-composio.md`](03-integrations/13-composio.md) | Gmail, Calendar, CRM, connector routing |
| 53 | [`03-integrations/10-whop.md`](03-integrations/10-whop.md) | Whop alternative rail |
| 54 | [`03-integrations/11-dodo-payments.md`](03-integrations/11-dodo-payments.md) | Dodo merchant-of-record rail |
| 55 | [`05-journeys/03-customer-journey.md`](05-journeys/03-customer-journey.md) | Customer conversion and support journey |

Build:

1. Implement D08 `GTMPlan`.
2. Implement D09 `LeadBatch` with suppression/consent checks.
3. Implement D10 `Deal`, sequence state, outbound gates, and `OrderRequest`.
4. Implement D11 ledger, Stripe test-mode checkout/payment-link flow, and budget reallocation.
5. Render pipeline, deal, payment, and treasury cards.

M4 acceptance:

- Warm lead email quotes an interview `claim_id`.
- Outbound send opens an approval gate.
- Stripe test payment reconciles into the ledger.
- Treasury reallocates budget based on revenue and spend.

## 8. Build M5: support, retention, continuous improvement

Read:

| Order | File | Build output |
|---:|---|---|
| 56 | [`02-departments/D12-support.md`](02-departments/D12-support.md) | Ticketing, support, retention, product signals |
| 57 | [`02-departments/D13-chief-of-staff.md`](02-departments/D13-chief-of-staff.md) | Capability gaps and self-improvement loop |
| 58 | [`01-platform/16-evaluation-framework.md`](01-platform/16-evaluation-framework.md) | Evaluations for agents and generated capabilities |
| 59 | [`03-integrations/02-band.md`](03-integrations/02-band.md) | Agent mesh, rooms, governance |
| 60 | [`03-integrations/12-pioneer-fastino.md`](03-integrations/12-pioneer-fastino.md) | Fine-tuned small-model promotion |

Build:

1. Implement D12 support inbox/ticket fixture and product-signal generation.
2. Implement D13 gap detection from sales/support/build signals.
3. Implement shadow-test -> eval -> canary -> rollback state machine.
4. Render the "new department proposal" finale.

M5 acceptance:

- A repeated sales/support failure becomes a `CapabilityGap`.
- Founder can approve or reject the improvement.
- A generated department manifest validates before it is registered.

## 9. Build M6: integrations, security, permissions, money controls

Read these before enabling real tools.

| Order | File | Build output |
|---:|---|---|
| 61 | [`01-platform/06-human-in-the-loop.md`](01-platform/06-human-in-the-loop.md) | Approval protocol |
| 62 | [`01-platform/07-identity-and-accounts.md`](01-platform/07-identity-and-accounts.md) | Account ownership and identity boundaries |
| 63 | [`01-platform/08-money-and-metering.md`](01-platform/08-money-and-metering.md) | Cost meter and department budgets |
| 64 | [`01-platform/12-safety-and-compliance.md`](01-platform/12-safety-and-compliance.md) | Safety rules and compliance posture |
| 65 | [`01-platform/13-permissions-and-policy.md`](01-platform/13-permissions-and-policy.md) | Permission engine |
| 66 | [`01-platform/14-secrets-and-vault.md`](01-platform/14-secrets-and-vault.md) | Secrets handling |
| 67 | [`01-platform/15-error-handling-and-fallbacks.md`](01-platform/15-error-handling-and-fallbacks.md) | Degradation/fallback behavior |
| 68 | [`03-integrations/00-sponsor-strategy.md`](03-integrations/00-sponsor-strategy.md) | Which sponsors are load-bearing |
| 69 | [`03-integrations/01-terac.md`](03-integrations/01-terac.md) | Human escalation and HR flow |
| 70 | [`03-integrations/04-solari.md`](03-integrations/04-solari.md) | Computer-use boundaries |
| 71 | [`03-integrations/05-superserve.md`](03-integrations/05-superserve.md) | Long-lived sandbox driver and sandbox0 fallback |
| 72 | [`03-integrations/14-elevenlabs-voice.md`](03-integrations/14-elevenlabs-voice.md) | Voice disclosure and consent |

Build:

1. Turn mock tool drivers into real drivers one by one.
2. Wrap every real tool call in permission checks, budget checks, and event emission.
3. Add vault references instead of raw secrets.
4. Add account-ceremony gates for CAPTCHA, 2FA, identity, payment entry, legal terms, and phone verification.
5. Verify fallbacks for every live demo dependency.

M6 acceptance:

- No real side effect can happen without the required event/gate.
- No raw secret appears in logs, artifacts, or commits.
- Kill switch pauses all side effects.

## 10. Build M7: demo seed, QA, launch rehearsal

Read last, then harden.

| Order | File | Build output |
|---:|---|---|
| 73 | [`04-execution/03-one-shot-prompt.md`](04-execution/03-one-shot-prompt.md) | Handoff prompt for a full build agent |
| 74 | [`04-execution/04-demo-seed-and-fallbacks.md`](04-execution/04-demo-seed-and-fallbacks.md) | Seed data, replay mode, vendor fallbacks |
| 75 | [`06-reference/02-agent-roles-catalog.md`](06-reference/02-agent-roles-catalog.md) | Agent roster validation |
| 76 | [`06-reference/03-artifact-catalog.md`](06-reference/03-artifact-catalog.md) | Artifact coverage validation |
| 77 | [`06-reference/04-kpi-dictionary.md`](06-reference/04-kpi-dictionary.md) | KPI cards and demo metrics |
| 78 | [`06-reference/05-external-research-notes.md`](06-reference/05-external-research-notes.md) | Research context and source notes |

Build:

1. Create `fixtures/demo-1` with event trace, artifacts, source snapshots, webhook snapshots, and fallback states.
2. Add `?replay=demo-1` mode to the Boardroom.
3. Add smoke tests for the 4-minute path.
4. Rehearse the exact beats in [`00-START-HERE/04-demo-and-judging.md`](00-START-HERE/04-demo-and-judging.md).
5. Freeze feature work and fix only demo blockers.

M7 acceptance:

- Fresh clone -> install -> seed -> Boardroom demo works.
- Live mode and replay mode are visibly labeled.
- Every sponsor shown in the demo has a load-bearing reason.
- The app can survive one vendor outage during rehearsal.

## 11. Final build checklist

Before the final push/deploy:

1. `pnpm build`
2. `pnpm test`
3. `pnpm lint`
4. Database migration smoke test.
5. Boardroom replay smoke test.
6. Kernel `/health` check.
7. Secret scan.
8. Markdown architecture link check.
9. Demo rehearsal with live integrations disabled.
10. Demo rehearsal with selected live integrations enabled.

## 12. When stuck

Use this cut order:

1. Cut live integrations to replay fixtures.
2. Cut cold outbound; keep warm lead Sales.
3. Cut full simpop; keep labeled synthetic fixture.
4. Cut D12 support depth; keep one ticket -> product signal.
5. Cut D13 hot registration; keep validated proposal and shadow-test card.
6. Never cut event sourcing, gates, evidence labels, or the Boardroom timeline.

## 13. The intended first coding prompt

```text
Read architecture_files/BUILD-TUTORIAL.md first, then follow its order.
Implement M0 and M1 only unless they are already complete.
Do not build live integrations before the event spine, gates, and Boardroom stream work.
Commit after each milestone with tests passing.
```
