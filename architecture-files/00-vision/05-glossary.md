# 05 — Glossary

Every noun in this repo, defined once. If a spec uses a word not in here, add it here.

## Core entities

| Term | Definition |
|---|---|
| **Venture** | One company being built. The top-level tenant object. Everything else hangs off a `venture_id`. |
| **Founder** | The human who owns a Venture. Identified by phone (Linq) + email. |
| **Department** | A bounded capability with a Head, Workers, a Critic, a budget envelope, and a typed I/O contract. Defined by a `DepartmentManifest`. |
| **Agent** | One LLM-driven actor with a role prompt, a tool allowlist, a model tier, and a token budget. |
| **Swarm** | N workers of the same role fanned out in parallel under one Head. |
| **Artifact** | An immutable, signed, versioned output (e.g. `SharpenedIdea`, `NicheDossier`). Artifacts are the only currency between departments. |
| **WorkOrder** | A typed request from one department to another: input artifact ref, budget, deadline, success criteria. |
| **Event** | An append-only fact. The single source of truth. State is a projection of events. |
| **Decision** | A recorded choice with: options considered, chosen option, rationale, decider (agent or founder), reversibility, and cost. |
| **Escalation** | A blocked-work record with a `reason ∈ {needs_human, needs_budget, needs_capability, needs_credential, needs_approval}`. |
| **Approval Gate** | A point where an irreversible action waits for a decision. Auto-approvable depending on `autonomy_level`. |

## Money & resources

| Term | Definition |
|---|---|
| **Budget Envelope** | A department's spendable allocation for a cycle, denominated in USD, covering tokens + tools + sandbox time. |
| **Cycle** | The allocation period. Demo: 5 minutes. Production: 24 hours. |
| **Meter** | A recorded unit of consumption (tokens, sandbox-seconds, API call, Terac hire) attributed to `(venture, department, agent, work_order)`. |
| **Treasury** | The D11 function that allocates envelopes and can freeze a department. |
| **HumanWorkRequisition** | A department's formal request for human labor. HR converts it to a Terac hire. |
| **Runway** | Founder-funded balance + realized Stripe revenue − committed spend. |

## Discovery & validation

| Term | Definition |
|---|---|
| **IdeaSeed** | Raw founder input, normalized: text, transcripts of voice, parsed files, links. |
| **OpportunityCandidate** | A self-originated idea (Mode B) with thesis, signal sources, and score. |
| **SharpenedIdea** | Office Hours output: one-liner, ICP, pain, wedge, "what must be true", kill criteria, open assumptions. |
| **NicheDossier** | One concrete niche with cited TAM/SAM/SOM, MRR@12mo model, pricing hypothesis, competitors, wedge, pros/cons, confidence, sources. |
| **Claim** | A single assertion extracted from a human interview, with speaker, timestamp, verbatim quote, polarity, and strength. |
| **ClaimLedger** | All Claims for a Venture, clustered into themes, with agreement/contradiction counts. |
| **Archetype** | A demographic cluster derived from Census PUMS microdata (~12 per region), carrying a population weight. |
| **SyntheticPanelResult** | Post-stratified population estimate for a question, with per-archetype breakdown and confidence. |
| **Calibration** | Adjusting synthetic panel outputs using real interview outcomes; reported as a delta, never hidden. |
| **IdeaDiff** | A proposed change to the product idea: `ADD | CUT | NARROW | REPRICE | PIVOT`, with evidence, cost, reversibility. |
| **ProductSpec** | The build-ready spec. Versioned; `v1` from Office Hours, `v2+` after pivots. |

## Build & GTM

| Term | Definition |
|---|---|
| **Deployment** | A live URL + commit sha + health status, owned by D07. |
| **QA Recording** | A Replay session for one QA scenario, linked to pass/fail and any filed bug. |
| **GTMPlan** | D08 output: positioning, ICP tiers, channels ranked by expected CAC, pricing, objection matrix, 90-day plan. |
| **Lead** | A person or company with contact handles, ICP fit score, source, consent state, and warm/cold provenance. |
| **Deal** | A Lead in the pipeline with stage, value, next action, and full interaction history. |
| **Order** | A closed deal with a Stripe object attached. |
| **ProductSignal** | Evidence from Support or Sales that the product should change. Feeds D06. |

## Platform

| Term | Definition |
|---|---|
| **CompanyOS** | The kernel: event store, artifact registry, bus, scheduler, budget meter, gate engine. |
| **Boardroom** | The Next.js control room. A projection of the event log rendered as an isometric office floor plan. |
| **Bus** | Message transport for `WorkOrder` / `ArtifactReady` / `Escalation`. Band primary, Postgres fallback. |
| **Sandbox** | A Superserve Firecracker microVM hosting a department's runtime. Pausable, forkable. |
| **AccountCeremony** | The protocol for the company acquiring its own credentials (Solari + Linq handoff). |
| **Identity Vault** | Encrypted credential store; agents receive scoped, short-lived handles, never raw secrets. |
| **Autonomy Level** | `copilot` (approve everything) → `supervised` (approve irreversible) → `autonomous` (approve only money-out + public content). |
| **Kill Switch** | Founder action that halts all agents for a Venture within one tick and freezes spend. |
| **CapabilityGap** | D13's finding that the company lacks an ability, with the evidence and the cost of not having it. |
| **DepartmentManifest** | The YAML that fully defines a department. D13 generates these. Used by the runtime to instantiate agents. |
| **Shadow Mode** | Running a new agent/department against historical inputs without side effects, to compare against what actually happened. |

## Vendors (shorthand used throughout)

| Term | What it is here |
|---|---|
| **Terac** | API to source, screen, hire, verify, and pay real humans. The last rung of the escalation ladder. |
| **Band** | Multi-agent mesh: discovery, rooms, delegation, shared context, governance. |
| **Solari** | Agentic browser / computer use, by Pinetree Research. The company's hands. |
| **Superserve** | Durable Firecracker sandboxes for long-running agents. Pause/resume/fork. |
| **Linq** | Rich interactive iMessage — the founder's approval surface and a sales channel. |
| **Replay** | Time-travel debugging recordings for QA. |
| **Render** | Hosting for Zeroth and for the ventures it builds. |
| **Lovable** | Fast AI site builder — marketing sites. |
| **Whop** | Marketplace/storefront rail for consumer & community products. |
| **Dodo Payments** | Merchant-of-record payment rail for international ventures. |
| **Pioneer (Fastino)** | Small-model fine-tuning + adaptive inference for our high-volume classifiers. |
| **Composio** | Managed OAuth + tool connectors (Gmail, LinkedIn, Calendar, GitHub, Slack, …). |
| **simit / sim-francisco** | The Census-PUMS synthetic population project we adapt for D05. |
| **jcode** | Fast Rust agent harness used to accelerate *our own* build during the hackathon. |
