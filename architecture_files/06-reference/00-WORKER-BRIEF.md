# Worker Brief — shared context for every authoring session

Product codename: **ZEROTH**. An AI-run agency that turns anyone into a founder: 13 department
agent swarms on a shared kernel (`CompanyOS`) that take an idea from ideation → validation →
build → GTM → leads → sales → payment → support → self-improvement.

Built for the **Zero-Human Company Hackathon by Terac**, Humanmade, 655 Bryant St, SF.
Challenge: "build an agent that can run a business on its own: making decisions, handling
operations, and executing with little to no human input."

## Sponsors (confirmed from the Luma page)
Terac (host, expert-labor API/MCP, 180k+ verified humans), Stripe, Lovable, Whop, Render, Linq
(AI in iMessage/SMS), Superserve (long-lived agent sandboxes), Replay (auto QA), Pioneer by
Fastino Labs (fine-tune/deploy small OSS models), Band (multi-agent + human interaction
infrastructure with governance), Dodo Payments (merchant-of-record billing), sandbox0
(open-source secure sandboxes), Solari by Pinetree Research (computer-use agents), Interview
Cake, Nucleate.

Judges are founders/CTOs from Touchmark (YC S26), Olam Labs (YC S26), xAI, Brekfuz.

## Department roster (canonical, do not renumber)
| ID | Department | Head agent | Primary artifact |
|----|-----------|------------|------------------|
| D01 | Intake & Origination | `intake.head` | `IdeaSeed`, `OpportunityCandidate[]` |
| D02 | Office Hours (idea sharpening) | `officehours.partner` | `SharpenedIdea` |
| D03 | Market Research | `market.head` | `NicheDossier[]` |
| D04 | Outreach & Customer Discovery | `outreach.head` | `Interview[]`, `ClaimLedger` |
| D05 | Synthetic Population (simit port) | `simpop.head` | `SyntheticPanelResult` |
| D06 | Pivot & Decision | `pivot.head` | `IdeaDiff[]`, `ProductSpec` |
| D07 | Build & QA | `build.architect` | `Deployment`, repo URL |
| D08 | Strategy & GTM | `strategy.head` | `GTMPlan` |
| D09 | Leads & Prospect Intelligence | `leads.head` | `Lead[]` |
| D10 | Sales & Revenue | `sales.head` | `Deal[]`, `Order` |
| D11 | Finance, HR & Treasury | `finance.head` | `Ledger`, `BudgetAllocation`, `HumanHire` |
| D12 | Customer Support & Retention | `support.head` | `Ticket[]`, `ProductSignal[]` |
| D13 | Chief of Staff (continuous improvement) | `cos.head` | `CapabilityGap`, new `DepartmentManifest` |

HR is a sub-department of D11. Terac requisitions are owned by HR.

## Non-negotiable invariants (repeat them, never contradict them)
1. **Every side effect is an event.** `emit()` → reducer → state. No direct mutation.
2. **Every irreversible action needs a gate.** money_out, public content, email/DM to real
   people, account creation, production deploy, data deletion, legal commitment.
3. **Every claim carries evidence.** Any market number, persona, or pivot cites a `source_id`.
   Fabricated numbers are a P0 bug. Missing evidence → `gaps[]`, never invention.
4. **Every department is replaceable**; departments talk only via typed contracts.
5. **Autonomy is a dial**: `venture.autonomy_level ∈ {copilot, supervised, autonomous}`.
6. **The company knows what it costs.** Every LLM call, sandbox-second and API hit meters to a
   department budget. Out-of-budget departments stop and requisition Treasury.
7. **Synthetic ≠ proof.** simit-derived personas complement, never replace, real customers.
   Any artifact mixing them must label `evidence_class ∈ {real, synthetic, mixed}`.

## Stack (assume this everywhere)
- `apps/boardroom` Next.js 15 / React 19 / Tailwind, SSE.
- `apps/kernel` Node 22 + Fastify: event store, artifact registry, gate engine, scheduler,
  budget meter, identity vault.
- `apps/orchestrator` Node 22 worker: leases sandboxes, runs Heads, enforces budgets.
- `services/simpop` Rust + axum + SQLite, ported from the `simit` repo.
- `packages/contracts` Zod schemas — single source of truth for every artifact/event/message.
- `packages/agent-kit` on `@anthropic-ai/claude-agent-sdk`.
- Postgres 16 + pgvector, Redis (BullMQ), S3-compatible object storage.

## The `simit` repo (github.com/Mahin2076/simit)
Rust/axum/SQLite "sim francisco": a distributionally accurate synthetic population sampled from
real ACS PUMS person microdata for SF's 8 PUMAs. Each agent carries PUMS weight `PWGTP`; every
population estimate is post-stratified `p_hat(k) = Σ w_i·a_i(k) / Σ w_i`. Agents are clustered
into ~12 demographic archetypes so one batched LLM call answers the whole population cheaply;
a SQLite cache keyed on `(model, exact prompt)` makes clean runs byte-reproducible. Religion
layered from Pew metro figures. Backtested leakage-free with GPT-4o (Oct 2023 cutoff):
2024 presidential SF 83.8% actual vs 81.3% predicted; March 2024 Prop A 70.38% vs 70%.
Key crates: `sim-core` (persona, pums, predict, aggregate, rubric, sim), `sim-maps`.
Also has a `validate` binary scoring a `rubric.yaml` with a headline gate ≈0.85.
We reuse: persona sampling, archetype clustering, post-stratified polling, rubric validation.
We add: business questions (willingness-to-pay, message testing, ICP sizing) instead of ballots.

## House style for every file
- Start with a one-line purpose, then a diagram or table. No filler prose.
- Every schema is a real TypeScript/Zod or SQL block, not prose description.
- Every department file follows `02-departments/D00-department-template.md`.
- Cross-link with relative markdown links; state upstream/downstream deps explicitly.
- Mark hackathon scope with `**MVP**` / `**POST-MVP**` tags on every subsection.
- Record open questions in an `## Assumptions & open questions` section at the end.
- Write for a fresh Claude Code session that must implement it without asking questions.
