# 03 — Org Chart

Zeroth is modeled as a real company on purpose. Same reporting lines, same handoff friction,
same budget fights — except every box is an agent swarm.

```
                        ┌───────────────────────────┐
                        │        FOUNDER (human)     │
                        │   approves · redirects ·   │
                        │        kills               │
                        └─────────────┬─────────────┘
                                      │ Linq / Boardroom
                        ┌─────────────▼─────────────┐
                        │   D13 · CHIEF OF STAFF     │◄──── reads all telemetry
                        │  self-improvement · spawns │      writes new departments
                        │  new departments           │
                        └─────────────┬─────────────┘
                                      │
        ┌───────────────┬─────────────┼─────────────┬────────────────┐
        │               │             │             │                │
┌───────▼──────┐ ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐ ┌───────▼───────┐
│  DISCOVERY   │ │ VALIDATION  │ │  BUILD   │ │ GO-TO-MKT  │ │ OPS & MONEY   │
│   cluster    │ │   cluster   │ │ cluster  │ │  cluster   │ │   cluster     │
├──────────────┤ ├─────────────┤ ├──────────┤ ├────────────┤ ├───────────────┤
│ D01 Intake   │ │ D04 Outreach│ │ D07 Build│ │ D08 Strategy│ │ D11 Finance   │
│ D02 OfficeHrs│ │ D05 SynthPop│ │          │ │ D09 Leads   │ │  └ HR (sub)   │
│ D03 Market   │ │ D06 Pivot   │ │          │ │ D10 Sales   │ │ D12 Support   │
└──────────────┘ └─────────────┘ └──────────┘ └────────────┘ └───────────────┘
```

> **Numbering note.** The founder's brief describes 12 departments. We ship **13 department
> specs** because Synthetic Population (D05) is large enough to deserve its own file, and
> because HR is documented inside Finance (D11) as a sub-department, exactly as briefed.
> Clusters exist only for the UI floor plan — they are not a routing layer.

---

## Department roster

| ID | Department | Head agent | Workers | Primary output artifact |
|----|-----------|------------|---------|------------------------|
| D01 | Intake & Origination | `intake.head` | `parser`, `trend-scout` ×4, `scorer` | `IdeaSeed`, `OpportunityCandidate[]` |
| D02 | Office Hours | `officehours.partner` | `devils-advocate`, `scribe` | `SharpenedIdea` |
| D03 | Market Research | `market.head` | `demand`×3, `supply`×3, `money`×2, `niche`×2 | `NicheDossier[]` |
| D04 | Outreach & Validation | `outreach.head` | `network-miner`, `writer`, `scheduler`, `voice-interviewer`, `analyst` | `Interview[]`, `ClaimLedger` |
| D05 | Synthetic Population | `simpop.head` | `sampler`, `archetyper`, `pollster`, `calibrator` | `SyntheticPanelResult` |
| D06 | Pivot & Decision | `pivot.head` | `synthesizer`, `red-team` | `IdeaDiff[]`, `ProductSpec` |
| D07 | Build | `build.architect` | `implementer`×2-4, `integrator`, `qa`, `deployer` | `Deployment`, repo URL |
| D08 | Strategy | `strategy.head` | `positioning`, `pricing`, `channel`×2, `messaging` | `GTMPlan` |
| D09 | Leads | `leads.head` | `icp-researcher`×3, `enricher`, `scorer`, `compliance` | `Lead[]` |
| D10 | Sales | `sales.head` | `sequencer`, `writer`, `voice-closer`, `objection-analyst` | `Deal[]`, `Order` |
| D11 | Finance & HR | `finance.head` | `reconciler`, `dunning`, `treasurer` **· HR:** `allocator`, `recruiter` | `Ledger`, `BudgetAllocation`, `HumanHire` |
| D12 | Customer Support | `support.head` | `triage`, `resolver`, `bug-filer` | `Ticket[]`, `ProductSignal[]` |
| D13 | Chief of Staff | `cos.head` | `analyst`, `gap-detector`, `agent-designer`, `shadow-tester` | `CapabilityGap`, new `DepartmentManifest` |

---

## The three universal roles

Every department, without exception, instantiates these three roles. This is what makes D13 able
to *generate* a new department mechanically — it fills a known shape.

1. **Head** — owns the department's contract. Receives a `WorkOrder`, decomposes it, dispatches to
   workers, merges results, signs the output artifact, reports cost. Never does the work itself.
2. **Workers** — stateless, parallel, narrow. Each has a tool allowlist and a token budget.
   Workers may not call other departments; only the Head may.
3. **Critic** — an adversarial reviewer with a rubric. Rejects the Head's artifact once, maximum,
   with specific defects. Prevents the "confident nonsense" failure mode. Cheap model is fine here.

```
WorkOrder ──► Head ──fan-out──► Worker ×N ──► Head merges ──► Critic
                ▲                                                │
                └──────────── one revision loop, max ────────────┘
                                      │ signed
                                      ▼
                                  Artifact + Cost report
```

---

## Inter-department protocol

Departments never call each other's functions. They exchange three message types on the bus:

| Message | Meaning | Example |
|---|---|---|
| `WorkOrder` | "Do this, here's the input artifact, here's your budget and deadline" | D02 → D03: research this SharpenedIdea |
| `ArtifactReady` | "I'm done, here's the signed output" | D03 → D06: NicheDossier[] |
| `Escalation` | "I'm blocked" (`needs_human`, `needs_budget`, `needs_capability`, `needs_credential`) | D09 → D11/HR: need Apollo credits |

Routing is declarative — see [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md).
The **Band** mesh carries these when available; the Postgres bus is the fallback and the audit log.

---

## Who can spend money

| Actor | Authority |
|---|---|
| Worker | Burns its assigned token/tool budget only. Cannot request more. |
| Head | Can request budget increase from Treasury; can approve worker retries. |
| Treasury (D11) | Allocates envelopes per cycle; can freeze a department. |
| HR (D11 sub) | Authorizes Terac spend for human work up to founder-set cap. |
| Founder | Unlimited; sets caps; single kill switch. |

## Who can talk to the outside world

| Capability | Departments allowed |
|---|---|
| Send email / iMessage to a real person | D04, D09 (drafts only), D10, D12 |
| Publish public content | D08, D10 — always gated |
| Place a voice call | D04, D10 |
| Spend real money | D11 only (others file requisitions) |
| Create an account / use a browser as a human | D-any via the Identity service, never directly |
| Push code / deploy | D07, D13 |

Enforcement is not honor-system: the tool allowlist per agent is in the department manifest and
enforced by the runtime ([`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md)).
