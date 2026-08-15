# 03 — Artifact Catalog

Every artifact type in the system, in one place. Artifacts are the only currency between
departments: immutable, hashed, HMAC-signed, versioned rows in `artifacts`
([`../01-platform/04-data-model.md`](../01-platform/04-data-model.md)), validated by the Zod
`AnyArtifact` union in `packages/contracts` at signing. This file is the index; the schemas
themselves live in the contracts package and are excerpted in the data-model file and department
specs — links per row.

Universal rules, restated once so per-row notes can be terse:

- **Immutability.** A "change" is a new row: `version+1`, same `lineage_id`, old row
  `quality='superseded'` + `superseded_by`. No exceptions.
- **Versioning.** `schema_version` is `'<Type>@<semver>'`. Adding a field = minor bump, old rows
  keep their version, Zod parses by version, no backfill. Breaking change = major bump + a new
  reducer path.
- **Signing events.** Every artifact's lifecycle emits: `artifact.created` (draft stored) →
  `artifact.signed` (validated + HMAC) → optionally `artifact.superseded` or
  `artifact.contested`. `ArtifactReady` goes on the bus after signing with
  `{type, id, version, hash}` — the hash makes refs tamper-evident.
- **Evidence enforcement.** `registry.sign()` runs the evidence validator: any `Cited<T>` field
  with zero sources blocks signing. `quality='partial'` requires `gaps.length ≥ 1`.
- **Retention.** Nothing is deleted. "Retention" below describes when an artifact stops being
  *routed* (superseded / venture killed), not when it is destroyed. PII inside artifacts follows
  the stricter rules noted per row.
- **Evidence classes.** Artifacts mixing real and synthetic inputs label
  `evidence_class ∈ {real, synthetic, mixed}` at claim level (P4 in
  [`01-product-principles.md`](01-product-principles.md)).

Column key: **Producer** = the signing agent. **Consumers** = departments that declare it as
input. **Evidence req** = what the signing validator demands beyond schema shape.

---

## Discovery artifacts

### IdeaSeed

| Field | Value |
|---|---|
| Owning dept | D01 Intake |
| Producer | `intake.head` |
| Consumers | D02 (primary), D06 (re-reads for pivot context), D08 (founder framing) |
| Schema | Raw + normalized founder input: `raw_statement`, `normalized.{problem, who_hurts, current_workaround, proposed_solution, business_model_guess, category}`, `extracted_entities`, `founder_profile`, `constraints`, `attachments[]` (each with `source_id`), `ambiguities[]`, Mode-B `candidates[]` + `selected_candidate_id`. See [`../02-departments/D01-intake.md`](../02-departments/D01-intake.md) §2. |
| Versioning | v1 only in practice; a founder re-submission is a *new* lineage, not a version bump (the old venture context would be misleading) |
| Evidence req | Every attachment summary and every `numbers_stated` entry carries a `source_id`; ambiguities enumerated, never silently resolved |
| Retention | Venture lifetime; attachments (voice, files) live in object storage under the venture prefix |
| Events | `artifact.created`, `artifact.signed` → routing fires `WorkOrder{to: D02}` |

### OpportunityCandidate

| Field | Value |
|---|---|
| Owning dept | D01 Intake (Mode B) |
| Producer | `intake.head` (scored by `intake.scorer`) |
| Consumers | D02 (the selected one, via `IdeaSeed`), Boardroom (candidate cards at demo 0:00) |
| Schema | `title`, `thesis` (≤600 chars), `pain_evidence[]` (min 3, verbatim + where + when + intensity + `source_id`), `signal_sources[]` (min 2 kinds), `who_hurts` (a role at an org size, never a category), `proposed_wedge`, `monetization_guess`, 8-axis `scores`, `weighted_score`, `rank`, `kill_reasons[]` |
| Versioning | Immutable snapshot; re-scoring produces new candidates in a new run |
| Evidence req | ≥3 cited pain quotes from ≥2 distinct signal-source kinds; regulatory-risk score present |
| Retention | Kept for the venture even when unselected — D06 and D13 mine rejected candidates |
| Events | `artifact.signed`; selection recorded as a `Decision` on the venture |

### SharpenedIdea

| Field | Value |
|---|---|
| Owning dept | D02 Office Hours |
| Producer | `officehours.partner` |
| Consumers | D03, D04, D05 (parallel fan-out on signing), D06 (diff base), D08 (original framing) |
| Schema | `one_liner` (format-enforced), `icp` (role + org_type + trigger + named_examples + disqualifiers), `pain` (statement, frequency, cost_today with basis, status_quo — never "nothing"), `wedge` (`ships_in_hours ≤ 24`), `what_must_be_true[]` (4–8, falsifiable, each with test + tester + blocking flag), `kill_criteria[]` (min 3, measured_by + deadline), `open_assumptions[]` (with `invented_by_agent` flags), `premises[]`, `alternatives_considered[]` (min 2), `transcript_ref`, `assignment`. See [`../02-departments/D02-office-hours.md`](../02-departments/D02-office-hours.md) §2. |
| Versioning | v1 from office hours. Pivots do **not** bump this — they produce `ProductSpec` versions. A re-run of office hours (rare, founder-requested) supersedes it. |
| Evidence req | Founder-absent mode: every invented answer flagged `invented_by_agent: true`; cost_today has a `basis` string or an explicit "unverified estimate" |
| Retention | Venture lifetime; `idea_locked` liveness segment flips on signing |
| Events | `artifact.signed` → routing fans out three WorkOrders (D03/D04/D05); `venture.milestone_reached(idea_locked)` |

### NicheDossier

| Field | Value |
|---|---|
| Owning dept | D03 Market Research |
| Producer | `market.head` (≥5 per run) |
| Consumers | D04 (interview targeting), D06 (pivot evidence), D07 (site copy/pricing names), D08 (TAM/CAC priors), D09 (congregation surfaces) |
| Schema | `label`, `slice` (industry × size × geo × trigger), `tam/sam/som: Cited<Money>`, `mrr_12mo: Cited<Money>`, `pricing_hypothesis` (model + `Cited` price + anchor comparables), `competitors[]` (min 1, each with cited pricing + weakness + sources), `wedge`, `pros/cons`, `reachability` (channels + `Cited` CAC), `confidence`, `rank_rationale` |
| Versioning | New research run = new versions superseding old; the *selected* dossier is marked in the `niches` projection, selection is a gate (`niche_selection`) |
| Evidence req | The heavy one: every TAM/SAM/SOM/MRR/price value must have ≥1 `SourceRef` with excerpt + method; `method='asserted'` cannot back tam/sam/som |
| Retention | Rejected dossiers kept — they define anti-positioning for D08 |
| Events | `artifact.signed` (×N), then `gate.opened(niche_selection)` → `gate.approved` → routing to D04 interviews |

## Validation artifacts

### Interview

| Field | Value |
|---|---|
| Owning dept | D04 Outreach |
| Producer | `outreach.head` (one per completed conversation) |
| Consumers | D06 (evidence), D08 (verbatim language), D09 (the warm pool), D10 (quote-backs) |
| Schema | `subject` (alias only — no raw PII; `kind ∈ {network, terac_panel, inbound, customer}`, `icp_match`, optional `terac_hire_id`), `channel`, `consent` (`ai_disclosed: literal(true)`, disclosure text, recording state, jurisdiction, timestamp), `duration_s`, `transcript_uri`, `recording_uri`, `script_version`, `claims[]` (Claim ids), `surprises[]`, `interviewer_voice_id`, `cost_usd` |
| Versioning | Immutable — an interview happened once. Corrections to claim extraction are new `Claim` versions, not interview edits. |
| Evidence req | `consent.ai_disclosed` is a Zod literal `true` — an undisclosed interview cannot be signed. Recording URI required when `consent.recording='granted'`. |
| Retention | Transcript + recording in object storage, venture lifetime; subject PII only as alias + encrypted handles in `leads`. Opt-out ⇒ suppression recorded, recording flagged for exclusion from future context. |
| Events | `human.call_placed`, `human.consent_recorded`, `human.call_completed`, `artifact.signed` |

### Claim

| Field | Value |
|---|---|
| Owning dept | D04 |
| Producer | `outreach.analyst` |
| Consumers | D06 (diff evidence), D08 (messaging quote refs), D10 (warm openers), D05 (calibration) |
| Schema | `interview_id`, `speaker_alias`, `ts_offset_s`, `verbatim` (exact words, never paraphrased), `normalized`, `theme`, `polarity ∈ {supports, contradicts, neutral}`, `strength (0–1)`, `evidence_class ∈ {past_behavior, current_practice, stated_intent, opinion}`, `targets[]` (links to `what_must_be_true` items) |
| Versioning | Re-extraction supersedes; verbatim text never changes across versions (it is the recording's words) |
| Evidence req | `verbatim` non-empty and present in the transcript at `ts_offset_s` (spot-checked by critic); `evidence_class` mandatory — the Mom-Test hierarchy is schema, not vibes |
| Retention | Venture lifetime; embedded (pgvector) for retrieval |
| Events | `artifact.signed` per batch; claims also project into the `claims` table |

### ClaimLedger

| Field | Value |
|---|---|
| Owning dept | D04 |
| Producer | `outreach.head` |
| Consumers | D06 (primary pivot input), D07 (QA scenarios from real workflows), D08, D09 |
| Schema | `interview_count`, `themes[]` (supports/contradicts/neutral counts, `net_strength`, representative verbatim quotes, `verdict ∈ {confirmed, contradicted, contested, insufficient_data}`), `what_must_be_true_status[]`, `contradictions_with_synthetic[]` (theme, real vs synthetic numbers, delta, note) |
| Versioning | Rolling: each new interview batch produces `version+1`; downstream departments declare a minimum `interview_count` |
| Evidence req | Every theme verdict backed by ≥1 representative quote with `claim_id`; `contradictions_with_synthetic` never empty when a panel exists and disagrees ≥ threshold |
| Retention | Venture lifetime |
| Events | `artifact.signed` → when both ClaimLedger and SyntheticPanelResult are signed, routing fires D06 |

### SyntheticPanelResult

| Field | Value |
|---|---|
| Owning dept | D05 Synthetic Population |
| Producer | `simpop.head` (computed by the Rust service) |
| Consumers | D06 (labeled evidence), D08 (WTP curve by archetype), Boardroom (population grid at 1:25) |
| Schema | `region`, `pums_vintage`, `seed` (deterministic), `archetypes[]` (min 4: cluster label, attributes, `population_weight` = Σ PWGTP), `questions[]` (estimate, `ci` tuple, per-archetype responses + weights), optional `calibration` (n, delta, method — reported, never applied), `honesty_note` (Zod literal: "Model-based estimate from Census PUMS microdata, not a survey of real respondents.") |
| Versioning | New question set = new version; identical seed + model + prompts must reproduce byte-identical estimates (simit's cache inheritance) |
| Evidence req | Seed + vintage recorded; CI present on every estimate; honesty_note literal — the schema physically prevents presenting the panel as a survey |
| Retention | Venture lifetime; the sqlite LLM cache inside simpop is a content store, kept for reproducibility |
| Events | `artifact.signed`; calibration deltas > threshold also emit an informational `Escalation` |

### IdeaDiff

| Field | Value |
|---|---|
| Owning dept | D06 Pivot & Decision |
| Producer | `pivot.head` (drafted by `pivot.synthesizer`, attacked by `pivot.red-team`) |
| Consumers | Founder (gate card), D06 itself (applies approved diffs), D13 (pivot pattern mining) |
| Schema | `op ∈ {ADD, CUT, NARROW, REPRICE, PIVOT}`, `target`, `before/after`, `evidence[]` (min 1: kind ∈ {claim, panel, market, support_signal, sales_loss}, ref, weight), `expected_effect`, `cost` (eng_hours + usd), `reversibility ∈ {reversible, costly, one_way_door}`, `what_would_reject_this`, `recommended` |
| Versioning | Immutable proposals; a revised diff is a new diff. Approval state lives on the gate, not the artifact. |
| Evidence req | `recommended: true` requires ≥1 real-evidence item (P4); `one_way_door` diffs always open an ASK gate regardless of autonomy |
| Retention | All diffs kept, approved or not — rejected diffs with their rejection notes are prime D13/institutional-memory material |
| Events | `artifact.signed` → `gate.opened(pivot_approval)` per diff (batched into one Linq card) → `gate.approved/rejected/redirected` |

### ProductSpec

| Field | Value |
|---|---|
| Owning dept | D06 (v2+); v1 seeded from D02 |
| Producer | `pivot.head` |
| Consumers | D07 (the build contract), D08 (promised scope), D11 (pricing → Stripe products) |
| Schema | `version_label`, `one_liner`, `icp`, `venture_kind`, `geography`, `features[]` (id, user_story, acceptance_criteria ≥1 — becomes QA verbatim, priority p0–p2, `justified_by[]` claim/diff ids), `non_goals[]`, `data_model_sketch`/hints, `integrations_required[]`, `auth_model`, `stack` (hosting literal `render`, payments rail), `qa_scenarios[]` (min 3), `pricing`, `applied_diffs[]` |
| Versioning | The canonical versioned artifact: v1 (office hours) → v2 (post-pivot, build trigger) → v3+ (post-launch signals). Routing requires `version ≥ 2` to fire D07. |
| Evidence req | Every feature's `justified_by` non-empty for p0 features; applied_diffs must reference approved gates |
| Retention | All versions kept; `scope_delta` between spec and `Deployment` is computed by D08's critic |
| Events | `artifact.signed` → routing fires D07 (build) + D08 (GTM) in parallel |

## Build & GTM artifacts

### Deployment

| Field | Value |
|---|---|
| Owning dept | D07 Build |
| Producer | `build.architect` |
| Consumers | D08 (shipped scope), D09 (volume trigger), D12 (repo access for diagnosis), D11 (infra cost), liveness reducer |
| Schema | `repo` (company-owned org, url, release sha + tag), `services[]` (render ids, kind, region), `app_url`, `marketing_url` (Lovable), `storefront_url` (Whop), `stack`, `qa` (totals + per-scenario Replay recordings with founder_summary), `health`, `cost_usd`. See [`../02-departments/D07-build.md`](../02-departments/D07-build.md) §2. |
| Versioning | One per release; rollback emits `build.rolled_back` and re-points to the prior version |
| Evidence req | `app_url` must probe 200 at signing; every failed QA scenario has a `replay_url`; repo/service ids must exist under company-owned accounts |
| Retention | All deployments kept; `product_live` liveness flips on first `health: green` |
| Events | `build.repo_created`, `build.commit_pushed`, `build.qa_*`, `build.deployed`, `artifact.signed`; `deploy` gate precedes public URLs |

### BuildFailure

| Field | Value |
|---|---|
| Owning dept | D07 |
| Producer | `build.architect` (on unrecoverable stage failure) |
| Consumers | Founder (gate/escalation card), D13 (failure pattern mining), D11 (descope cost) |
| Schema | `stage ∈ {architect, implement, integrate, qa, deploy}`, `feature_ids[]`, `summary`, `replay_url`, `recoverable`, `proposed_action ∈ {retry, descope_feature, escalate_founder, requisition_human}` |
| Versioning | Immutable incident record |
| Evidence req | QA-stage failures require the Replay recording ref |
| Retention | Permanent — feeds D13 telemetry |
| Events | `dept.work_failed`, `artifact.signed`, possibly `Escalation` |

### GTMPlan

| Field | Value |
|---|---|
| Owning dept | D08 Strategy |
| Producer | `strategy.head` |
| Consumers | D09 (icp_tiers, channel first_actions), D10 (messaging, objections, pricing), D11 (rail choice, discount policy), D07 (marketing site copy) |
| Schema | `based_on` (spec version + deployment id — grounded in *shipped* scope), `positioning` (strict template + anti_positioning), `icp_tiers[]` (min 2, firmographics + triggers + disqualifiers + expected ACV/close), `channels[]` (min 3, full CAC arithmetic in `cac_math`, rank, first_action), `pricing` (tiers + rail ∈ {stripe, whop, dodo} + rail_rationale + discount policy), `objection_matrix[]` (min 6), `messaging_matrix[]` (min 3, verbatim `quote_ref`s), `plan_90d` (4 windows with KPIs + kill criteria), `scope_delta_warnings[]` |
| Versioning | Re-runs on `ObjectionRecord`/`ProductSignal` clusters and monthly; each supersedes |
| Evidence req | Positioning proof resolves to evidence refs; every `pain_in_their_words` has a claim id; a plan referencing a descoped feature is a P0 critic reject |
| Retention | Venture lifetime |
| Events | `artifact.signed` → D09 lead work orders; `public_content` gates for anything published from it |

### Lead / LeadBatch

| Field | Value |
|---|---|
| Owning dept | D09 Leads |
| Producer | `leads.head` (batch); rows project into the `leads` table |
| Consumers | D10 (the only actor that contacts), D11 (billing identity on conversion), D12 (customer linkage) |
| Schema | `identity` (name/title/company, encrypted handles with deliverability), `firmographics`, `triggers[]` (kind, recency, source_url, strength), `provenance` (pool ∈ {warm, cold}, origin, discovered_by, source_urls, `warm_context` with interview_id + claim_ids + strongest_quote + influenced_features), `consent` (state, named lawful `basis`, jurisdiction, channels_allowed, opt_out), `scoring` (icp_fit 0–100, tier, subscores, scorer + version, reasons ≤4, disqualifiers). See [`../02-departments/D09-leads.md`](../02-departments/D09-leads.md). |
| Versioning | Batch versions; per-lead dedup against prior versions is a critic requirement (<1% dup) |
| Evidence req | Cold leads: provable lawful basis + ≥1 source_url. Warm leads: verified consent record (`human.consent_recorded` event ref), never assumed. Regulated populations block signing pending a never-auto gate. |
| Retention | Handles encrypted at rest; `opted_out`/`dnc` rows retained as suppressions (deleting them would *cause* recontact). PII minimization: alias + handles only, no scraped dossiers beyond firmographics. |
| Events | `sales.lead_created` per lead, `artifact.signed` per batch, `gate.opened(cold_list_release)` before cold handoff |

### Deal

| Field | Value |
|---|---|
| Owning dept | D10 Sales |
| Producer | `sales.head`; rows project into `deals` |
| Consumers | D11 (won → collect), D08 (objections + lost reasons), D13 (loss clusters), D12 (customer context) |
| Schema | `lead_id`, `stage ∈ {new, contacted, replied, meeting_booked, proposal, won, lost}`, `value_usd`, `interactions[]` (channel, direction, summary, gate_id for outbound), `objections[]`, `next_action`, `lost_reason` + `lost_reason_cluster` |
| Versioning | Stage changes are events (`sales.deal_stage_changed`); the artifact re-signs at won/lost |
| Evidence req | Every outbound interaction references its approved gate; `lost_reason_cluster` mandatory on lost (it feeds D13) |
| Retention | Permanent — pipeline history is the company's sales memory |
| Events | `sales.sequence_started`, `sales.reply_received`, `sales.meeting_booked`, `sales.deal_stage_changed`, `sales.deal_won/lost` |

### Order

| Field | Value |
|---|---|
| Owning dept | D10 (created), D11 (reconciled — the authority on money fields) |
| Producer | `sales.head` on close; finalized by `finance.reconciler` from webhooks |
| Consumers | D11 ledger, D12 (subscription state → ticket priority), liveness reducer |
| Schema | `deal_id`, `rail ∈ {stripe, whop, dodo}`, `external_id` (Stripe/Whop/Dodo object id), `amount_usd`, `status ∈ {pending, paid, failed, refunded, disputed}`, `is_test_mode` (labeled — the demo's honest asterisk), `line_items[]`, `paid_at` |
| Versioning | Status transitions via webhook-driven events; refund produces `version+1` with `status='refunded'` |
| Evidence req | `external_id` must resolve against the rail's API during reconciliation; every rail object carries `metadata.{venture_id, deal_id, trace_id}` |
| Retention | Permanent (financial record); `revenue_real` liveness flips on first `paid` |
| Events | `money.revenue_received`, `money.refunded`, `sales.deal_won` (correlated by payment_intent to dedup) |

## Ops & self-improvement artifacts

### Ticket

| Field | Value |
|---|---|
| Owning dept | D12 Support |
| Producer | `support.head` |
| Consumers | D12 lifecycle, D07 (code_refs in diagnosis), D11 (refund path), D13 |
| Schema | `channel ∈ {email, linq, in_app, stripe_dispute}`, `customer_ref`, `subject/body`, `severity`, `status ∈ {open, pending, resolved, escalated}`, `diagnosis` (root_cause, `code_refs[]` with file+line, confidence), `resolution`, `signal_filed` |
| Versioning | Status transitions are events; artifact re-signs at resolution |
| Evidence req | A resolution claiming a code cause must include `code_refs`; licensed-professional topics (medical/legal/tax) cannot be resolved by the agent — `needs_human` escalation is schema-checked by the critic |
| Retention | Venture lifetime; customer PII minimized to `customer_ref` |
| Events | `support.ticket_opened`, `support.ticket_resolved`, possibly `terac.requisition_filed` |

### ProductSignal

| Field | Value |
|---|---|
| Owning dept | D12 (also filed by D10/D07/analytics origins) |
| Producer | `support.bug-filer` (and QA/sales equivalents) |
| Consumers | D06 (reassess routing at severity ≥ high), D07 (bug work orders), D13 |
| Schema | `origin ∈ {support, sales, qa, analytics}`, `summary`, `evidence[]` (min 1: ticket/deal_lost/qa_failure/metric refs + quotes), `frequency`, `severity`, `revenue_at_risk_usd`, `proposed_action ∈ {fix, feature, doc, price_change, no_action}`, `route_to` |
| Versioning | Frequency increments re-sign the signal (same lineage) rather than duplicating |
| Evidence req | ≥1 concrete evidence ref; `revenue_at_risk_usd` computed when a deal/subscription is linkable, else omitted (never guessed) |
| Retention | Permanent — the product's change-pressure history |
| Events | `support.signal_filed` → routing (`severity>=high` → D06 reassess work order) |

### Ledger / BudgetAllocation

| Field | Value |
|---|---|
| Owning dept | D11 Finance |
| Producer | `finance.head` (ledger), `finance.treasurer` (allocations) |
| Consumers | Boardroom money panel, all departments (their envelopes), D13 (value-per-dollar) |
| Schema | Ledger: reconciled revenue/cost entries against rail objects and `meters`. Allocations: per-cycle `envelope_usd`, `hard_cap_usd`, `spent_usd`, `state ∈ {active, degraded, frozen, thawed}`, written `rationale`. Tables in [`../01-platform/04-data-model.md`](../01-platform/04-data-model.md); flows in [`../01-platform/08-money-and-metering.md`](../01-platform/08-money-and-metering.md). |
| Versioning | Per cycle (`cycle_id` unique); prior cycles immutable |
| Evidence req | Ledger entries must reconcile to rail webhooks + meter facts (0.01 tolerance); every allocation has a non-empty `rationale` (rendered in the UI) |
| Retention | Permanent (financial record) |
| Events | `money.metered`, `money.budget_allocated`, `money.budget_exceeded`, `money.revenue_received`, `money.payout` |

### HumanWorkRequisition / HumanHire (Terac)

| Field | Value |
|---|---|
| Owning dept | Filing dept (any Head) → HR (D11 sub) owns conversion |
| Producer | Filing Head; `hr.recruiter` produces the hire record |
| Consumers | HR, founder (gate), the filing department (output artifact returns to it) |
| Schema | Requisition: `kind ∈ {interview_panel, expert_verification, human_only_task}`, `who` (role, must/nice/exclude screens, geo, count ≤50), `task` (brief_md, `deliverable_schema_ref` — QC is mechanical, modality), `justification` (`why_agent_cannot` mandatory, decision_value_usd, alternatives_tried with event ids, confidence with/without), `budget` (per-human + total caps, urgency, deadline). Hire: `terac_job_id`, `worker_alias` (never real PII), status ladder posted→paid, `output_artifact_id` — **the human's output re-enters the same artifact pipeline**. See [`../03-integrations/01-terac.md`](../03-integrations/01-terac.md). |
| Versioning | Requisition immutable once filed; hire status transitions are events |
| Evidence req | Empty `why_agent_cannot` blocks HR approval (schema); payment only on deliverable passing its schema; output stored as both artifact and `sources` row (`kind='human_hire_output'`) |
| Retention | Permanent; worker identity only ever as alias |
| Events | `terac.requisition_filed`, `terac.hire_posted`, `terac.worker_matched`, `terac.work_delivered`, `terac.paid`, plus the `money_out` gate events |

### CapabilityGap

| Field | Value |
|---|---|
| Owning dept | D13 Chief of Staff |
| Producer | `cos.head` |
| Consumers | Founder (the finale gate), D07 (builds the new department), the runtime (instantiates it) |
| Schema | `title`, `detected_from[]` (min 2 — one anecdote is not a gap; deal_lost/ticket/escalation/budget_overrun/qa_failure refs), `frequency`, `cost_of_absence_usd`, `proposed_solution ∈ {new_department, new_worker_role, new_tool, terac_standing_panel}`, `proposed_manifest` (full YAML), `shadow_test` (cases, would_have_changed_outcome, delta_usd, method), `recommendation ∈ {deploy, iterate, reject}` |
| Versioning | Iterations supersede as shadow results accumulate |
| Evidence req | Evidence refs must resolve to real events; `cost_of_absence_usd` must be priced (critic reject otherwise); deploy recommendation requires an attached shadow_test |
| Retention | Permanent — the company's growth log |
| Events | `cos.gap_detected`, `cos.department_designed`, `cos.shadow_test_run`, `gate.opened(new_department)` (never auto), `cos.department_deployed` |

### DepartmentManifest (as artifact)

| Field | Value |
|---|---|
| Owning dept | Seed manifests: humans (`packages/manifests`). Generated: D13. |
| Producer | `cos.agent-designer` (draft) → `cos.head` (sign) |
| Consumers | The runtime (instantiation), Band mesh (registration), routing (appended rules) |
| Schema | Full schema in [`../02-departments/D00-department-template.md`](../02-departments/D00-department-template.md) §3: head/critic/workers `AgentSpec`s, concurrency, budget, io contract, gates, sandbox spec (image, egress allowlist), memory policy, SLA |
| Versioning | `departments.manifest_yaml` freezes the deployed copy + hash per venture; changes = new manifest version + re-instantiation |
| Evidence req | Must parse against the Zod manifest schema at boot — a D13-generated manifest that fails validation cannot instantiate, by construction |
| Retention | Permanent, hash-pinned |
| Events | `cos.department_deployed`, `dept.*` lifecycle events thereafter |

---

## Artifact flow map

```
IdeaSeed ─► SharpenedIdea ─┬─► NicheDossier[] ─┐
 (D01)        (D02)        ├─► Interview[]/Claim/ClaimLedger ─┼─► IdeaDiff[] ─► ProductSpec v2
                           └─► SyntheticPanelResult ──────────┘     (D06)          │
                                                                       ┌───────────┴───────────┐
                                                                       ▼                       ▼
                                                                  Deployment ──────────► GTMPlan
                                                                    (D07)                 (D08)
                                                                       │                       │
                                                                       ▼                       ▼
                    Ticket / ProductSignal ◄── customers ◄── Order ◄── Deal[] ◄── LeadBatch
                        (D12)                                (D10/D11)   (D10)       (D09)
                           │                                                │
                           └────────────► CapabilityGap / DepartmentManifest ◄─ all telemetry
                                                    (D13)
Ledger / BudgetAllocation (D11) meter every arrow above.
HumanWorkRequisition/HumanHire can be filed from any Head and returns an artifact into the same flow.
```

## Assumptions & open questions

- The `AnyArtifact` union in the data-model file omits `Deployment`, `BuildFailure`,
  `LeadBatch`-as-wrapper, and the Terac types — they are defined in their department/integration
  specs. Assume the union grows to include them; reconcile in `packages/contracts` when built.
- Two `ProductSpec` shapes exist (D06-owned in the data model; a slightly richer one quoted in
  D07's spec with `venture_kind`/`geography`/`auth_model`). Treat D07's as the target
  `ProductSpec@2.0.0`; flagged in `CONTRACTS-REQUESTS.md`.
- `Order.amount_usd` vs multi-currency (Dodo MoR): assume USD-normalized with the rail's FX at
  `paid_at`; original currency in `line_items`. **(confirm with D11 file)**
- Retention for call *recordings* under two-party-consent jurisdictions may need venue-specific
  deletion timelines. `consent.jurisdiction` is captured; the policy table lives in
  `12-safety-and-compliance.md` (platform file, in progress by another agent).
