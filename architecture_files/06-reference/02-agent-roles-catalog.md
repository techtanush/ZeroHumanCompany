# 02 — Agent Roles Catalog

Every agent in the company, in one place. One row per agent role; replicas noted in the role
column. Derived from the department specs in [`../02-departments/`](../02-departments/) where they
exist (D01, D02, D07, D08, D09 at time of writing) and from the canonical roster in
[`00-WORKER-BRIEF.md`](00-WORKER-BRIEF.md) plus the org chart
([`../00-START-HERE/03-org-chart.md`](../00-START-HERE/03-org-chart.md)) for the rest. Rows sourced
from the roster only are marked **(confirm against department file)** — reconcile them when the
department spec lands; the department file wins.

Universal rules (from [`../02-departments/D00-department-template.md`](../02-departments/D00-department-template.md)):

- Every department = exactly 1 **Head**, N **Workers**, exactly 1 **Critic**.
- Heads decompose, dispatch, merge, sign, and report cost. Heads never do the work.
- Workers are stateless and narrow; they cannot call other departments or request budget.
- Critics get one rejection, maximum; second rejection ships `quality: contested`.
- Tools listed are the *hard allowlist* — if it isn't listed, the runtime does not build it.
- Model tiers: `opus` (judgment), `sonnet` (default), `haiku` (volume extraction),
  `pioneer:*` (fine-tuned classifiers, fall back to haiku).

Escalation triggers below are the conditions under which the agent (or its Head, for workers)
raises an `Escalation`; the reasons are always from
`{needs_human, needs_budget, needs_capability, needs_credential, needs_approval}`.

---

## D01 — Intake & Origination

Source: [`../02-departments/D01-intake.md`](../02-departments/D01-intake.md). Input: `RawSubmission`
(Mode A) or nothing (Mode B). Output: `IdeaSeed` (+ `OpportunityCandidate[]` in Mode B).

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `intake.head` | head | One normalized, machine-legible starting point per venture | `RawSubmission` or constraints | signed `IdeaSeed` | memory.read/write, bus.emit, artifact.sign/read, calc | opus | file unparseable after retries (`needs_human`); Mode B finds no candidate ≥ threshold (`needs_approval`) | `IdeaSeed` signed ≤ 3 min, ambiguities enumerated not guessed |
| `intake.parser` ×2 | worker | Voice/PDF/DOCX/image/link → structured summary with `source_id` | asset refs | `ParsedAttachment` | file.read_asset, voice.transcribe, ocr.extract, web_fetch | sonnet | via Head: asset corrupt/undecodable | 100% of attachments summarized or in `gaps[]` |
| `intake.trend-scout` ×4 | worker | Mine one signal surface (complaints / product dissatisfaction / labor postings / regulatory diffs) for pain clusters | lens assignment, constraints | pain evidence with ≥3 verbatim quotes each | web_search, web_fetch, apify.*, solari.browse | sonnet | via Head: surface blocked (`needs_capability` if no scraping path) | ≥2 distinct sources per candidate, zero uncited pain quotes |
| `intake.scorer` | worker | Apply the 8-axis rubric, produce weighted scores + rank | candidates | scored `OpportunityCandidate[]` | calc, memory.read, web_search | sonnet | via Head: two candidates tie within noise (`needs_approval` if not autonomous) | score reproducible from rubric; kill_reasons non-empty |
| `intake.critic` | critic | Reject vague candidates and uncited pain | draft artifact | accept / revise(defects) | memory.read, artifact.read | sonnet | n/a (critics never escalate) | catches 100% of `who_hurts` that name a category instead of a role |

## D02 — Office Hours

Source: [`../02-departments/D02-office-hours.md`](../02-departments/D02-office-hours.md). Port of
the gstack `office-hours` skill. Input: `IdeaSeed`. Output: `SharpenedIdea`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `officehours.partner` | head | Interrogate the idea until it is specific, falsifiable, small. Sole speaker to the founder | `IdeaSeed`, founder presence signal | signed `SharpenedIdea` | linq.send_card/await_reply, boardroom.ask, memory, artifact, bus | opus (never downgrade) | founder unresponsive past gate timeout → proceeds founder-absent; idea fails all six forcing questions (`needs_approval` to kill) | every WMBT falsifiable; ≥3 kill criteria; zero praise emitted |
| `officehours.devils-advocate` | worker | Attack the strongest version of the idea; never speaks to founder | running transcript | objections with evidence | web_search, web_fetch, memory.read | opus (cheap adversary = worse than none) | via Head | ≥1 objection that survives into `open_assumptions` or kills a premise |
| `officehours.scribe` | worker | Verbatim transcript + per-turn claim/number/assumption tagging | session stream | `TranscriptTurn[]`, transcript_ref | memory.write | haiku | via Head | transcript complete; every number tagged |
| `officehours.proxy` | worker (founder-absent only) | Answer as the founder from intake material, marking every invention | `IdeaSeed`, venture memory | proxy answers with `invented_by_agent: true` flags | artifact.read, memory.read, web_search | sonnet | via Head: material too thin to answer a blocking question (`needs_human`) | 100% of invented answers flagged as unverified assumptions |
| `officehours.critic` | critic | Enforce specificity, falsifiability, anti-sycophancy | draft `SharpenedIdea` | accept / revise(defects) | memory.read, artifact.read | sonnet | n/a | rejects any one-liner not matching the enforced format |

## D03 — Market Research **(confirm against department file)**

Roster: `market.head` + `demand`×3, `supply`×3, `money`×2, `niche`×2 (org chart). Manifest excerpt
visible in [`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md). Input:
`SharpenedIdea`. Output: `NicheDossier[]` (min 5).

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `market.head` | head | Ranked, cited niche dossiers where the money actually is | `SharpenedIdea` | signed `NicheDossier[]` ≥5 | memory, bus, artifact, calc | opus | all niches < confidence 0.4 (`needs_approval`); load-bearing claim unverifiable (`needs_human` → Terac expert) | ≥5 dossiers, every TAM/SAM/SOM cited, rank rationale explicit |
| `market.demand` ×3 | worker | Demand signals: search volume, forum velocity, "how do I" queries | niche slice | demand evidence + sources | web_search, web_fetch, apify.run_actor, solari.browse, memory.read | sonnet | via Head: surface blocked | zero uncited demand numbers |
| `market.supply` ×3 | worker | Incumbents, pricing pages, funding, feature gaps | niche slice | competitor sets + sources | web_search, web_fetch, apify.*, solari.browse | sonnet | via Head | every competitor row ≥1 source |
| `market.money` ×2 | worker | Comparable ARR/ACV/CAC/LTV priors by category | niche slice | monetization priors, `cac_math` | web_search, web_fetch, memory.read, calc | sonnet | via Head | arithmetic shown; `method` labeled |
| `market.niche` ×2 | worker | Slice market into 6–10 concrete niches and score | all worker output | niche slices + scores | calc, memory.read | sonnet | via Head | slices are industry × size × geo × trigger, not vibes |
| `market.critic` | critic | Reject uncited numbers and unranked mush | draft dossiers | accept / revise | artifact.read, memory.read | sonnet | n/a | blocks any dossier whose `confidence` has no stated basis |

## D04 — Outreach & Customer Discovery **(confirm against department file)**

Roster: `outreach.head` + `network-miner`, `writer`, `scheduler`, `voice-interviewer`, `analyst`.
Input: `SharpenedIdea`, selected `NicheDossier`. Output: `Interview[]`, `ClaimLedger`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `outreach.head` | head | ≥5 real ICP conversations, claims extracted, consent clean | `SharpenedIdea`, niche | signed `Interview[]`, `ClaimLedger` | memory, bus, artifact, linq | opus | network exhausted below interview quota (`needs_human` → Terac panel via HR); voice consent unobtainable in jurisdiction (`needs_approval`) | ≥5 completed interviews; every claim has speaker + timestamp + verbatim |
| `outreach.network-miner` | worker | Mine founder's 1st/2nd-degree network for ICP matches | Composio LinkedIn/Gmail grants | candidate list with shared context | composio.linkedin.*, composio.gmail.read, memory.read | sonnet | via Head: OAuth grant missing (`needs_credential`) | candidates have a real shared-context hook, not a template |
| `outreach.writer` | worker | Outreach drafts referencing real shared context | candidates | drafts (never sends) | memory.read, artifact.read | sonnet | via Head | gated send only; zero cold-template drafts to warm people |
| `outreach.scheduler` | worker | Book calls into the founder-cloned-voice calendar | replies | booked slots | composio.calendar.*, composio.gmail.send (gated) | haiku | via Head: double-booking, no-show cascade | booked-to-completed rate tracked |
| `outreach.voice-interviewer` | worker | Run Mom-Test discovery calls in the cloned voice, disclosure at open | booked call, script | recording, transcript, consent record | voice.call, elevenlabs.tts, voice.transcribe | sonnet | via Head: interviewee revokes consent mid-call (auto-stop, log) | disclosure on 100% of calls; past-behavior questions ≥70% of script |
| `outreach.analyst` | worker | Extract `Claim`s: verbatim, polarity, strength, evidence_class | transcripts | `Claim[]` rows | memory, artifact.read | sonnet (→ pioneer:claim-strength later) | via Head | claims never paraphrase-only; contradiction counts computed |
| `outreach.critic` | critic | Reject stated-intent-heavy ledgers and consent gaps | draft ledger | accept / revise | artifact.read | sonnet | n/a | flags any interview without consent record |

## D05 — Synthetic Population **(confirm against department file)**

Roster: `simpop.head` + `sampler`, `archetyper`, `pollster`, `calibrator`. Runs against
`services/simpop` (Rust port of simit — see [`05-external-research-notes.md`](05-external-research-notes.md)).
Input: `SharpenedIdea`, niche. Output: `SyntheticPanelResult`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `simpop.head` | head | Population-representative synthetic read, honestly labeled | questions from D02/D03/D06 | signed `SyntheticPanelResult` | simpop.api, memory, artifact, bus | sonnet | PUMS extract missing for region (`needs_capability`); calibration delta > threshold (report, `needs_approval` if load-bearing) | deterministic seed recorded; honesty_note present; CI bounds on every estimate |
| `simpop.sampler` | worker | Sample agents from ACS PUMS microdata with `PWGTP` weights | region, PUMS extract | agent sample | simpop.api | haiku (mostly orchestrates Rust) | via Head | joint distribution matches PUMS marginals (test in simpop) |
| `simpop.archetyper` | worker | Cluster into ~12 demographic archetypes | sample | `archetypes` rows with weights | simpop.api, calc | haiku | via Head | archetype weights sum to population; stable under fixed seed |
| `simpop.pollster` | worker | One batched LLM call per archetype for WTP/message/ICP questions | archetypes, question | per-archetype responses | simpop.api (batched LLM inside service) | sonnet | via Head: cache miss budget exceeded (`needs_budget`) | byte-reproducible on clean re-run (sqlite cache) |
| `simpop.calibrator` | worker | Compare panel vs real `ClaimLedger`; compute delta | panel + ledger | `calibration` block | artifact.read, calc | sonnet | via Head: <3 real interviews to calibrate against (delta shipped as `n/a`, never invented) | delta reported, never silently applied |
| `simpop.critic` | critic | Reject presentation of estimates without CI/weights/label | draft result | accept / revise | artifact.read | haiku | n/a | honesty_note literal enforced |

## D06 — Pivot & Decision **(confirm against department file)**

Roster: `pivot.head` + `synthesizer`, `red-team`. Input: `ClaimLedger`, `SyntheticPanelResult`,
`NicheDossier`. Output: `IdeaDiff[]`, `ProductSpec` (v2+).

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `pivot.head` | head | Evidence-backed decision packet; apply approved diffs into `ProductSpec v2` | all validation artifacts | signed `IdeaDiff[]`, `ProductSpec` | memory, artifact, bus, linq (pivot gate) | opus | contradictory evidence-tied diffs (`needs_human` → Terac tiebreak); kill-criterion met (`needs_approval` to kill venture) | every diff carries evidence + cost + reversibility + rejection condition |
| `pivot.synthesizer` | worker | Confirmed / contradicted / surprised synthesis; draft diffs | ledger, panel, dossiers | draft `IdeaDiff[]` | artifact.read, memory.read, calc | opus | via Head | no `recommended: true` diff on synthetic-only evidence (P4) |
| `pivot.red-team` | worker | Attack each diff: cheapest way this is wrong | draft diffs | `what_would_reject_this` per diff | artifact.read, web_search | sonnet | via Head | every recommended diff has a named falsifier |
| `pivot.critic` | critic | Reject diffs with fuzzy reversibility or missing evidence class | draft packet | accept / revise | artifact.read | sonnet | n/a | one_way_door diffs always ASK regardless of autonomy |

## D07 — Build & QA

Source: [`../02-departments/D07-build.md`](../02-departments/D07-build.md). Input: `ProductSpec`
(v≥2). Output: `Deployment`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `build.architect` | head | Deployed, QA-verified product at a URL in a company-owned repo | `ProductSpec`, `NicheDossier`, `ClaimLedger` | signed `Deployment` | git, task-graph, memory, artifact, bus | opus | GitHub org ceremony fails (`needs_credential`); non-automatable task (`needs_human` → Terac); QA red after descope (`needs_approval`) | URL 200, QA green in Replay, repo pushed, `state.json` current |
| `build.implementer` ×2–4 | worker | One feature branch per task, headless Claude Code, push at every green checkpoint | task slice, worktree | `feat/<n>/F-xx` branches | claude_code.headless, git, fs.workspace, shell.build, web_fetch, memory.read | sonnet (opus on escalated retry) | via Head: acceptance criteria ambiguous | branch green + pushed; worst loss on sandbox death = one task |
| `build.integrator` | worker | Merge feature branches into `build/<n>`, resolve conflicts | branches | integration branch | git, fs.workspace, shell.build, claude_code.headless | sonnet | via Head: conflict beyond mechanical merge | integration branch builds clean |
| `build.qa` ×2 | worker | Run QA scenarios from acceptance criteria + real user workflows, Replay-recorded | deployment candidate, `qa_scenarios` | `qa_runs` rows + recordings | replay.record/query, browser.playwright, shell.build, fs.workspace, memory.read | sonnet | via Head: flaky > threshold | every failure has a shareable Replay URL + founder_summary |
| `build.deployer` | worker | Render services, Lovable marketing site, Whop listing, DNS, health probe | green build | live URLs, service ids | render.api, github.api, lovable.api, whop.api, stripe.products, dns.api, http.probe | sonnet | via Head: deploy gate pending (`needs_approval`), provider outage | health `green` post-deploy; rollback path recorded |
| `build.critic` | critic | Reject deployments with red/skipped QA or spec-feature deltas unflagged | draft `Deployment` | accept / revise | artifact.read, replay.query | sonnet | n/a | scope_delta between spec and shipped is enumerated |

## D08 — Strategy & GTM

Source: [`../02-departments/D08-strategy.md`](../02-departments/D08-strategy.md). Input: full
venture history + `Deployment`. Output: `GTMPlan`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `strategy.head` | head | The one document Sales executes against, grounded in *shipped* scope | everything (only dept that reads all) | signed `GTMPlan` | artifact.read, memory.read, calc | opus | shipped scope contradicts all viable positioning (`needs_approval`); rail choice ambiguous (`needs_approval`) | zero promised-but-not-shipped claims; every channel has `cac_math` |
| `strategy.positioning` | worker | Positioning statement, category, anti-positioning, proof chain | history slice | positioning block | artifact.read, memory.read | opus | via Head | proof chain resolves to claim_ids/sources |
| `strategy.pricing` | worker | Tiers, WTP curve, discount policy, payment rail | panel + dossier + competitor pricing | pricing block | web_search, solari.browse, calc, artifact.read | sonnet | via Head | anchor comparables cited; rail_rationale written |
| `strategy.channel` ×2 | worker | Enumerate + score channels (A: B2B outbound/partnership, B: community/content/marketplace) | ICP tiers | ranked channels | apify, web_search, calc | sonnet | via Head | expected CAC shows arithmetic; rank reproducible |
| `strategy.messaging` | worker | Per-persona matrix in customers' verbatim words | `ClaimLedger` | messaging matrix | artifact.read | sonnet | via Head | every `pain_in_their_words` has a `quote_ref` |
| `strategy.critic` | critic | Enforce evidence + shipped-vs-promised delta | draft plan | accept / revise | artifact.read | sonnet | n/a | rejects plans referencing descoped features |

## D09 — Leads & Prospect Intelligence

Source: [`../02-departments/D09-leads.md`](../02-departments/D09-leads.md). Input: `GTMPlan`,
`Interview[]`, `Deployment`. Output: `LeadBatch` (`Lead[]`, min 25). **Drafts nothing, sends nothing.**

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `leads.head` | head | Deduped, enriched, ICP-scored, consent-clean list; warm pool ranked first | `GTMPlan`, interviews | signed `LeadBatch` | memory, bus, artifact | sonnet (orchestration, not judgment) | cold sources dry (`needs_capability`); regulated population detected (`needs_approval`, never auto) | ≥25 leads (`pipeline_active` threshold); 0 consent-unknown leads released |
| `leads.icp-researcher` ×3 | worker | R1 firmographic, R2 trigger-event, R3 community/social surface mining | ICP tiers | raw candidates + provenance | web_search, web_fetch, apify.run_actor, composio.linkedin.search, solari.browse, memory.read | sonnet | via Head | every candidate has `source_urls` + `how_found` |
| `leads.enricher` ×2 | worker | Contacts, firmographics, deliverability verification | candidates | enriched rows | web_fetch, dns.mx_lookup, email.verify, apify.run_actor, memory.read | haiku | via Head | verified handle rate; zero invented emails |
| `leads.scorer` | worker | ICP-fit scoring with reasons | enriched rows | `scoring` blocks | memory.read, calc | pioneer:lead-fit-v1 (falls back haiku) | via Head | score confidence calibrated vs later reply rates |
| `leads.compliance` | worker | Consent basis, DNC/suppression, jurisdiction rules | scored rows | consent blocks, suppressions | memory.read, dnc.check, suppression.check, web_fetch | sonnet (never downgrade) | via Head: ambiguous lawful basis (`needs_approval`) | 100% of released leads have named lawful basis |
| `leads.critic` | critic | Reject batches with dedup misses or provenance gaps | draft batch | accept / revise | artifact.read | sonnet | n/a | dup rate < 1%; warm pool complete vs D04 roster |

## D10 — Sales & Revenue **(confirm against department file)**

Roster: `sales.head` + `sequencer`, `writer`, `voice-closer`, `objection-analyst`. Resident.
Input: `LeadBatch`, `GTMPlan`. Output: `Deal[]`, `Order`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `sales.head` | head | Move deals through the pipeline; never cold to a warm lead | leads, GTM plan | signed `Deal[]`, `Order` refs | memory, bus, artifact, linq | opus | 3+ losses in one `lost_reason_cluster` (`needs_capability` → D13 signal); discount beyond policy (`needs_approval`) | ≥1 booked call; ≥1 won deal; objections logged to D08 |
| `sales.sequencer` | worker | Multi-channel cadences honoring consent + channel policy | leads | sequence state | composio.gmail.send (gated), linq.send (gated), memory | sonnet | via Head: deliverability collapse | reply rate per pool tracked; DNC honored 100% |
| `sales.writer` | worker | Context-rich drafts quoting the lead's own interview claims | lead + `warm_context` | drafts for gated send | artifact.read, memory.read | sonnet | via Head | warm drafts always cite `claim_ids`; no shipped-scope violations |
| `sales.voice-closer` | worker | Booked sales calls in cloned voice, disclosure at open | booked call | call outcome, next action | voice.call, elevenlabs.tts, voice.transcribe | sonnet | via Head: prospect requests human (`needs_human`) | show-rate and close-rate metered |
| `sales.objection-analyst` | worker | Cluster objections, feed matrix updates to D08 | call/email transcripts | `ObjectionRecord[]` | memory, artifact.read | haiku (→ pioneer later) | via Head | observed objections reconciled with predicted matrix |
| `sales.critic` | critic | Reject sends violating consent, scope, or price policy | outbound batch | accept / revise | artifact.read | sonnet | n/a | zero non-consented sends reach the gate |

## D11 — Finance, HR & Treasury **(confirm against department file)**

Roster: `finance.head` + `reconciler`, `dunning`, `treasurer`, HR sub-dept: `allocator`,
`recruiter`. Resident. Output: `Ledger`, `BudgetAllocation`, `HumanHire`. The only department with
Stripe write access; HR is the only actor that converts requisitions into Terac hires.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `finance.head` | head | Accurate ledger, solvent runway, funded departments | webhooks, meters, deals | signed `Ledger`, allocations | stripe.*, whop.*, dodo.*, memory, bus, artifact | opus | runway < committed spend (`needs_approval` founder top-up); rail dispute (`needs_human`) | ledger reconciles to Stripe within $0.01; runway never negative |
| `finance.reconciler` | worker | Expected vs received; dedup webhook events | Stripe/Whop/Dodo events | ledger entries | stripe.read, artifact.read, calc | haiku | via Head: unmatched payment > 24h | zero unreconciled objects at cycle close |
| `finance.dunning` | worker | Late invoices → polite nudges → deal_lost after N failures | invoice events | dunning drafts (gated send) | stripe.read, composio.gmail.send (gated), memory | haiku | via Head | recovery rate tracked; ≤ policy contact frequency |
| `finance.treasurer` | worker | Allocate cycle envelopes from marginal value per dollar | meters, revenue, liveness | `BudgetAllocation[]` + rationale | calc, memory.read, artifact.read | sonnet | via Head: two departments both starve (`needs_approval`) | every allocation has a written rationale (shown in UI) |
| `hr.allocator` | worker (HR) | Evaluate `HumanWorkRequisition` ROI against budget | requisitions | approve/reject with reasoning | calc, memory.read, artifact.read | sonnet | via Head: requisition exceeds `terac_cap_usd` (`needs_approval`) | zero hires without `why_agent_cannot`; ROI recorded |
| `hr.recruiter` | worker (HR) | Source, screen, hire, QC, pay via Terac | approved requisitions | `terac_hires` rows, output artifacts | terac.api (gated money_out), memory | sonnet | via Head: no qualified match by deadline (`needs_human` → founder) | delivered output passes deliverable schema; payment on verified completion only |
| `finance.critic` | critic | Reject allocations without rationale, hires without ROI test | drafts | accept / revise | artifact.read | haiku | n/a | audit-clean cycle reports |

## D12 — Customer Support & Retention **(confirm against department file)**

Roster: `support.head` + `triage`, `resolver`, `bug-filer`. Resident. Input: inbox, in-app
reports, Stripe dispute events. Output: `Ticket[]`, `ProductSignal[]`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `support.head` | head | Resolve what the repo can answer; route the rest; file recurring pain as signals | tickets, subscription state | signed `Ticket[]`, `ProductSignal[]` | memory, bus, artifact, composio.gmail (gated) | sonnet | licensed-professional question (`needs_human` → Terac expert); refund > policy (`needs_approval`) | first-response < SLA; recurring complaints always become signals |
| `support.triage` | worker | Classify severity/channel/customer tier | raw inbound | triaged queue | memory.read | haiku (→ pioneer:triage) | via Head | priority respects subscription state (enterprise > trial) |
| `support.resolver` | worker | Diagnose from the product's own source; draft replies | ticket + repo access (read) | diagnosis + resolution draft (gated send) | fs.repo_read, artifact.read, memory, web_fetch | sonnet | via Head: root cause needs a deploy (`needs_capability` → D07 via signal) | diagnosis carries `code_refs`; no speculative fixes promised |
| `support.bug-filer` | worker | Convert recurring/critical issues into `ProductSignal` with evidence | resolved+open tickets | `ProductSignal[]` | artifact.read, memory | haiku | via Head | every signal ≥1 evidence ref; revenue_at_risk estimated when computable |
| `support.critic` | critic | Reject replies that promise unshipped scope or leak internals | outbound drafts | accept / revise | artifact.read | haiku | n/a | zero scope-violating promises sent |

## D13 — Chief of Staff **(confirm against department file)**

Roster: `cos.head` + `analyst`, `gap-detector`, `agent-designer`, `shadow-tester`. Resident,
observes everything (read-only Band room `cos↔all`). Output: `CapabilityGap`, new
`DepartmentManifest`.

| Agent | Role | Objective | Inputs | Outputs | Tools | Tier | Escalates when | Success metric |
|---|---|---|---|---|---|---|---|---|
| `cos.head` | head | Find where the company underperforms for lack of a capability; grow the organ | all telemetry | signed `CapabilityGap`, `DepartmentManifest` (gated `new_department`) | artifact.read, memory (T4 write — only agent allowed), bus, manifest.write, prompts.write | opus | new-department gate always ASK (never auto); gap needs founder strategy call (`needs_approval`) | deployed department improves the metric it was built for |
| `cos.analyst` | worker | Mine event log: cost per artifact, loss clusters, escalation hotspots | events, meters, deals | telemetry findings | artifact.read, calc, memory.read | sonnet | via Head | findings reproducible from event queries |
| `cos.gap-detector` | worker | Convert findings into `CapabilityGap` with ≥2 evidence refs | findings | draft gaps | artifact.read, memory | sonnet | via Head | one anecdote never becomes a gap (schema: `detected_from.min(2)`) |
| `cos.agent-designer` | worker | Write the full `DepartmentManifest` + prompts for the missing capability | approved gap | manifest YAML + prompt files | manifest.write (draft), prompts.write (draft), artifact.read | opus | via Head: capability needs tools that don't exist (`needs_capability` → tool-plane work order to D07) | manifest validates against `packages/contracts/manifest.ts` on first parse |
| `cos.shadow-tester` | worker | Run the new department against historical cases, no side effects | manifest + event history | `shadow_result` {cases, would_have_changed, delta_usd} | sandbox.fork, replay, artifact.read | sonnet | via Head: shadow delta negative (recommend `iterate`/`reject`) | shadow report attached before any deploy gate opens |
| `cos.critic` | critic | Attack the gap: is this real, priced, and not already covered? | draft gap/manifest | accept / revise | artifact.read | sonnet | n/a | rejects gaps whose cost_of_absence is unpriced |

---

## Cross-cutting totals

| Measure | Count |
|---|---|
| Departments | 13 (+ HR sub-department inside D11) |
| Head agents | 13 |
| Critic agents | 13 |
| Worker roles | 44 (≈57 replicas at default manifest counts) |
| Roles allowed to touch a real human | 6 (`outreach.voice-interviewer`, `outreach.scheduler`, `sales.sequencer`, `sales.voice-closer`, `finance.dunning`, `support.head`) — all gated |
| Roles allowed to spend real money | 2 (`hr.recruiter`, `finance.head`) — both gated `money_out` |
| Roles allowed to write institutional (T4) memory | 1 (`cos.head`) |
| Opus roles | 11 (heads of judgment departments + devils-advocate, synthesizer, positioning, agent-designer) |
| Pioneer-eligible roles | 3 (`leads.scorer`, `outreach.analyst` claim-strength, `support.triage`) |

## Department I/O quick reference

The contract seams between the rows above. Full schemas in
[`03-artifact-catalog.md`](03-artifact-catalog.md) and
[`../01-platform/04-data-model.md`](../01-platform/04-data-model.md).

| Dept | Consumes | Produces | Resident? | Default envelope |
|---|---|---|---|---|
| D01 | `RawSubmission` / nothing | `IdeaSeed`, `OpportunityCandidate[]` | no | ~$0.30/cycle (est.) |
| D02 | `IdeaSeed` | `SharpenedIdea` | no | $2.00 (manifest) |
| D03 | `SharpenedIdea` | `NicheDossier[]` ≥5 | no | $4.00 (manifest) |
| D04 | `SharpenedIdea`, selected niche | `Interview[]`, `ClaimLedger` | no | ~$9 typical (voice-heavy) |
| D05 | questions from D02/D03/D06 | `SyntheticPanelResult` | no | ~$1.10 typical |
| D06 | `ClaimLedger`, panel, dossiers | `IdeaDiff[]`, `ProductSpec` v2+ | no | ~$2.40 typical |
| D07 | `ProductSpec` v≥2, ledger, dossier | `Deployment` | warm | $12.00 (manifest) |
| D08 | everything + `Deployment` | `GTMPlan` | re-runs | ~$2.60 typical |
| D09 | `GTMPlan`, interviews, `Deployment` | `LeadBatch` ≥25 | yes (30m cron) | $4.00 (manifest) |
| D10 | `LeadBatch`, `GTMPlan` | `Deal[]`, `Order` | yes | ~$4.10 typical |
| D11 | webhooks, meters, requisitions | `Ledger`, `BudgetAllocation`, `HumanHire` | yes | ~$0.60 typical |
| D12 | inbox, disputes, app reports | `Ticket[]`, `ProductSignal[]` | yes | ~$0.80 typical |
| D13 | all telemetry | `CapabilityGap`, `DepartmentManifest` | yes (cron) | ~$2.20 typical |

Envelope figures marked "typical" are the cycle-spend estimates from
[`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md); manifest
figures are `budget.default_envelope_usd` from the department files that exist.

## Escalation reason × department matrix

Which department raises which reasons in practice. ● = primary raiser, ○ = occasional.

| Reason | D01 | D02 | D03 | D04 | D05 | D06 | D07 | D08 | D09 | D10 | D11 | D12 | D13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `needs_human` | ○ | | ● | ● | ○ | ● | ● | | | ○ | ○ | ● | |
| `needs_budget` | | | ○ | ● | ○ | | ● | | ○ | ○ | n/a (grants) | | |
| `needs_capability` | ○ | | | | ● | | ○ | | ● | ● | | ○ | receives them |
| `needs_credential` | | | | ● | | | ● | | ○ | ○ | | | |
| `needs_approval` | ○ | ○ | ● | ○ | ○ | ● | ● | ● | ● | ● | ● | ● | ● |

Reading the matrix: `needs_human` clusters in the validation/build path (that is the Terac story);
`needs_capability` clusters in GTM (that is the D13 story); `needs_approval` is everywhere because
gates are everywhere. D11 never raises `needs_budget` — it *resolves* it.

## Model tier distribution and rationale

| Tier | Roles | Where and why |
|---|---|---|
| `opus` | 11 | Heads of judgment departments (D01, D02, D03, D04, D06, D07, D08, D10, D11, D13) minus the deliberately-sonnet D05/D09/D12 heads; plus `officehours.devils-advocate`, `pivot.synthesizer`, `strategy.positioning`, `cos.agent-designer`. Rule: irreversible calls, synthesis across artifacts, adversarial reasoning that must actually hurt. |
| `sonnet` | ~26 | Default for all research, writing, integration, and compliance workers, and all critics of judgment departments. |
| `haiku` | ~10 | Extraction/formatting at volume: scribe, enrichers, reconciler, dunning, triage, bug-filer, simpop orchestration, cheap critics. Never judgment. |
| `pioneer:*` | 3 | `leads.scorer` (lead-fit), claim-strength for `outreach.analyst`, `support.triage` — once ≥500 labels exist; automatic haiku fallback. |

Downgrade policy: the Budget Meter may downgrade a tier automatically at >80% envelope, except
roles marked "never downgrade" in their manifest (`officehours.partner`, `leads.compliance`).
Downgrades emit `budget.degraded` and are visible in the Boardroom — a feature, not a failure.

## Who can do what (enforcement summary)

Restated from [`../00-START-HERE/03-org-chart.md`](../00-START-HERE/03-org-chart.md) with agent
granularity, because reviews keep asking:

| Capability | Agents | Enforcement |
|---|---|---|
| Send to a real person | D04 scheduler/interviewer (interviews), D10 sequencer/closer, D11 dunning, D12 head | `outbound_to_real_person` gate + tool grant |
| Publish public content | D08/D10 heads only | `public_content` gate — NEVER auto-approves |
| Spend real money | `finance.head`, `hr.recruiter` | `money_out` gate + Stripe/Terac tool grants exist only in D11 manifests |
| Place voice calls | `outreach.voice-interviewer`, `sales.voice-closer` | voice tools granted only to these two; disclosure script required by gate condition |
| Push code / deploy | D07 workers, D13 (via D07) | git/render tools only in D07 manifest; `deploy` gate |
| Create accounts | none directly — Identity service only | `account_creation` gate; departments file requests, ceremonies execute |
| Read another department's memory | nobody (T2 is per-department) | memory service policy; cross-dept context flows via artifacts |
| Write institutional memory | `cos.head` | memory service policy, T4 write ACL |

## Assumptions & open questions

- Rows for D03–D06, D10–D13 are derived from the roster, org chart, journey scenes, and the
  Terac/Stripe/sponsor integration specs — **confirm each against its department file when it
  lands**; the department file wins on tools, token budgets, and replica counts.
- `sales.head` tier is assumed opus (judgment-heavy, deal strategy); the D10 file may choose
  sonnet + opus-on-escalation like D09 did for its head. **(confirm)**
- `support.head` assumed sonnet since triage/resolution is mostly procedural; if D12's file gives
  it refund authority beyond policy, it may warrant opus. **(confirm)**
- Whether `cos.head` may *also* write routing rules (`routing.yaml` append) at deploy time is
  implied by [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) — treat as yes,
  but only inside the `new_department` gate's approved action.
