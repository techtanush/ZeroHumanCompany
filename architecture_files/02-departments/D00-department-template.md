# D00 — Department Template & `DepartmentManifest` Schema

This file is two things at once:

1. **The canonical section order** every file in `02-departments/` follows. If a department spec is
   missing a section, it is incomplete.
2. **The full schema of `DepartmentManifest`** — the YAML the runtime consumes to instantiate a
   department, and the exact shape **D13 Chief of Staff** fills in when it *generates a new
   department at runtime*.

> If this file and a department spec disagree about structure, this file wins.
> If this file and [`../README.md`](../README.md) disagree about an invariant, the README wins.

Related: [`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md) (how a manifest
is executed), [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) (the three
messages), [`../00-vision/03-org-chart.md`](../00-vision/03-org-chart.md) (Head/Workers/Critic).

---

## 1. The mandatory section order

Every `D0N-*.md` file has these twelve sections, in this order, with these headings.

| # | Heading | Must contain |
|---|---|---|
| 1 | `## 1. Mission` | One sentence. Plus **the single question this department answers.** |
| 2 | `## 2. Contract — Inputs & Outputs` | Artifact types in/out, with Zod-ish schema blocks |
| 3 | `## 3. DepartmentManifest` | The complete YAML, valid against §3 of this file |
| 4 | `## 4. Agent Roster` | Table: role, model tier, replicas, tools, token budget |
| 5 | `## 5. System Prompts` | Real prompt text for Head, each worker role, and the Critic |
| 6 | `## 6. Execution Flow` | Numbered steps + one ASCII diagram |
| 7 | `## 7. Integrations` | Table: capability → sponsor/vendor → how it is used here |
| 8 | `## 8. Gates & Escalations` | Every gate this dept opens; every `Escalation.reason` it can raise |
| 9 | `## 9. Failure Modes & Fallbacks` | Table: failure → detection → fallback → resulting artifact quality |
| 10 | `## 10. Definition of Done & Critic Rubric` | DoD checklist + scored rubric with a pass threshold |
| 11 | `## 11. Demo Notes` | What is on screen, at which second of the 4-minute demo |
| 12 | `## 12. Cost Estimate` | Per-run table summing to a USD figure; must match `budget.default_envelope_usd` |

Style rules that apply to all of them:

- Start the file with `# D0N — Name`. Nothing above it.
- Cross-link with relative markdown links. Never absolute paths, never bare filenames.
- Every quantitative claim a department *produces* carries a `source_id`. Every quantitative claim
  a department *spec* makes (cost, latency) is an estimate and is labeled as one.
- Prompts are written as if they will be pasted into `packages/prompts/D0N/*.md` verbatim. No `TBD`.
- Schemas are written in Zod. They are the contract; prose is the commentary.

---

## 2. Universal shape (do not re-litigate per department)

```
WorkOrder ──► Head ──fan-out──► Worker ×N ──► Head merges ──► Critic
                ▲                                                │
                └──────────── one revision loop, max ────────────┘
                                      │ signed
                                      ▼
                        Artifact + ArtifactReady + cost report
```

Three roles, always:

| Role | Count | Can call other departments? | Can spend? |
|---|---|---|---|
| **Head** | exactly 1 | yes (emits `WorkOrder`) | can request budget from Treasury |
| **Worker** | 1..N per role, replicated | no | burns assigned budget only |
| **Critic** | exactly 1 | no | trivial |

Hard invariants inherited from the platform, restated because they get violated:

1. **No ambient tools.** If a tool is not in the agent's `tools:` list, the runtime does not build it.
2. **One revision loop maximum.** Critic rejects twice ⇒ ship `quality: contested`.
3. **Every side effect is an event.** No direct state mutation, ever.
4. **Uncited numbers are blocked at signing.** Not warned — blocked.
5. **Partial beats fabricated.** A missing worker result becomes an entry in `gaps[]`, never a guess.

---

## 3. `DepartmentManifest` — full schema

Location: `packages/manifests/D0N-<slug>.yaml`.
Validated at boot by `packages/contracts/src/manifest.ts`. A manifest that fails validation prevents
the department from being instantiated — including one D13 just wrote.

### 3.1 Zod definition (authoritative)

```ts
// packages/contracts/src/manifest.ts
export const ModelTier = z.union([
  z.enum(['opus', 'sonnet', 'haiku']),
  z.string().regex(/^pioneer:[a-z0-9\-]+$/),        // Fastino fine-tune, falls back to haiku
]);

export const ToolName = z.string().regex(/^[a-z_]+(\.[a-z_]+)*$/);   // 'web_search', 'composio.gmail.send'

export const AgentSpec = z.object({
  agent_id: z.string().regex(/^[a-z0-9]+\.[a-z0-9\-]+$/),  // 'market.demand'
  model: ModelTier,
  replicas: z.number().int().min(1).max(16).default(1),
  system_prompt_ref: z.string(),                    // path under packages/prompts/
  tools: z.array(ToolName).default([]),
  max_tokens_per_run: z.number().int().positive(),
  temperature: z.number().min(0).max(1).default(0.3),
  timeout_s: z.number().int().positive().default(120),
  retries: z.number().int().min(0).max(3).default(2),
  output_schema: z.string().optional(),             // named export in packages/contracts
});

export const GateSpec = z.object({
  id: z.string(),                                   // 'niche_selection'
  trigger: z.string(),                              // event expr: 'artifact.created(type=NicheDossier[])'
  question: z.string(),                             // founder-readable, one sentence
  surface: z.enum(['linq', 'boardroom', 'both']).default('both'),
  card: z.enum(['approve_reject','swipe_select','multi_approve','text_reply','code_entry'])
        .default('approve_reject'),
  auto_approve_at: z.enum(['never','autonomous','supervised']).default('autonomous'),
  timeout_s: z.number().int().positive().default(300),
  on_timeout: z.enum(['auto_approve','auto_reject','hold']).default('hold'),
  blocks: z.boolean().default(true),                // does the department stall waiting?
});

export const DepartmentManifest = z.object({
  id: z.string().regex(/^D\d{2}$/),
  name: z.string(),
  cluster: z.enum(['discovery','validation','build','gtm','ops','meta']),
  version: z.number().int().min(1).default(1),
  generated_by: z.enum(['human','D13']).default('human'),   // provenance — D13 sets 'D13'
  resident: z.boolean().default(false),             // true ⇒ never "finishes"; wakes on cron/webhook

  head: AgentSpec,
  critic: AgentSpec.extend({ rubric_ref: z.string() }),
  workers: z.array(AgentSpec).min(1),

  concurrency: z.number().int().min(1).max(32),

  budget: z.object({
    default_envelope_usd: z.number().positive(),
    hard_cap_usd: z.number().positive(),
    degrade_at_pct: z.number().min(0).max(1).default(0.8),   // downgrade model tier past this
    on_exhausted: z.enum(['escalate','partial','halt']).default('escalate'),
  }),

  io: z.object({
    input: z.array(z.string()).min(1),              // artifact type names
    output: z.array(z.string()).min(1),
    min_outputs: z.number().int().min(0).default(1),
    emits_work_orders_to: z.array(z.string()).default([]),   // ['D03','D04']
  }),

  gates: z.array(GateSpec).default([]),

  sandbox: z.object({
    image: z.string().default('zeroth/dept-base:latest'),
    cpu: z.number().int().min(1).max(8).default(2),
    mem_mb: z.number().int().min(512).default(2048),
    disk_mb: z.number().int().default(4096),
    egress_allowlist: z.array(z.string()).default([]),       // domains; [] = no egress
    pause_between_cycles: z.boolean().default(true),
    forkable: z.boolean().default(false),
  }),

  sla: z.object({
    soft_deadline_s: z.number().int().positive(),
    hard_deadline_s: z.number().int().positive(),
    on_timeout: z.enum(['return_partial','fail','escalate']).default('return_partial'),
  }),

  memory: z.object({
    reads: z.array(z.enum(['venture','department','global'])).default(['venture','department']),
    writes: z.array(z.enum(['department','global'])).default(['department']),
  }).default({}),

  triggers: z.array(z.object({
    kind: z.enum(['event','cron','webhook','founder']),
    expr: z.string(),                               // 'artifact.signed(type=SharpenedIdea)' | '*/15 * * * *'
  })).default([]),
});
```

### 3.2 Canonical YAML skeleton (copy this)

```yaml
# packages/manifests/D0N-<slug>.yaml
id: D0N
name: <Department Name>
cluster: discovery | validation | build | gtm | ops | meta
version: 1
generated_by: human
resident: false

head:
  agent_id: <slug>.head
  model: opus
  system_prompt_ref: prompts/D0N/head.md
  tools: [memory.read, memory.write, bus.emit, artifact.sign]
  max_tokens_per_run: 120000
  timeout_s: 240

critic:
  agent_id: <slug>.critic
  model: sonnet
  system_prompt_ref: prompts/D0N/critic.md
  rubric_ref: prompts/D0N/critic-rubric.md
  tools: [memory.read]
  max_tokens_per_run: 30000

workers:
  - agent_id: <slug>.<role>
    model: sonnet
    replicas: 3
    system_prompt_ref: prompts/D0N/<role>.md
    tools: [web_search, web_fetch]
    max_tokens_per_run: 60000

concurrency: 8

budget:
  default_envelope_usd: 4.00
  hard_cap_usd: 8.00
  degrade_at_pct: 0.8
  on_exhausted: escalate

io:
  input: [<ArtifactType>]
  output: [<ArtifactType>]
  min_outputs: 1
  emits_work_orders_to: []

gates: []

sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  egress_allowlist: []
  pause_between_cycles: true
  forkable: false

sla:
  soft_deadline_s: 240
  hard_deadline_s: 420
  on_timeout: return_partial

memory:
  reads: [venture, department]
  writes: [department]

triggers:
  - kind: event
    expr: artifact.signed(type=<InputArtifactType>)
```

---

## 4. Tool namespace registry

The `tools:` allowlist draws from exactly this namespace. Anything else fails manifest validation —
which is how D13 is prevented from inventing a tool that does not exist.

| Namespace | Tools | Backed by |
|---|---|---|
| `memory.*` | `read`, `write`, `search` | pgvector |
| `bus.*` | `emit` (Head only) | Band ▸ PG |
| `artifact.*` | `read`, `sign` (Head only) | Artifact Registry |
| `web_search`, `web_fetch` | — | Anthropic web tools |
| `apify.*` | `run_actor`, `get_dataset` | **Apify** |
| `solari.*` | `browse`, `act`, `extract`, `screenshot` | **Solari / Pinetree** |
| `composio.*` | `gmail.*`, `linkedin.*`, `calendar.*`, `github.*`, `slack.*` | **Composio** |
| `linq.*` | `send_card`, `send_text`, `await_reply` | **Linq** |
| `terac.*` | `post_requisition`, `screen`, `hire`, `pay`, `deliverable` | **Terac** |
| `stripe.*` | `payment_link`, `checkout`, `read_balance`, `refund` | **Stripe** |
| `whop.*` / `dodo.*` | `list_product`, `checkout` | **Whop** / **Dodo** |
| `voice.*` | `clone`, `place_call`, `join_call`, `transcribe` | **ElevenLabs** + telephony |
| `simpop.*` | `build_panel`, `poll`, `calibrate` | `services/simpop` (Rust) |
| `sandbox.*` | `exec`, `fork`, `pause`, `resume` | **Superserve** |
| `render.*` | `create_service`, `deploy`, `status` | **Render** |
| `replay.*` | `start_recording`, `stop`, `get_session` | **Replay** |
| `lovable.*` | `generate_site`, `publish` | **Lovable** |
| `calc` | deterministic arithmetic (no LLM math on money) | local |
| `pioneer.*` | `classify` | **Fastino Pioneer** |

**Rule:** a department that can send to a real human (`composio.gmail.send`, `linq.send_text`,
`voice.place_call`) must declare a matching gate in `gates:`. Manifest validation enforces this pair.

---

## 5. Artifact envelope (every output artifact is wrapped in this)

```ts
export const Artifact = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  type: z.string(),                       // 'SharpenedIdea'
  version: z.number().int().min(1),
  created_by: z.string(),                 // 'D02'
  work_order_id: z.string().uuid(),
  body: z.unknown(),                      // the department-specific schema
  sources: z.array(z.object({
    source_id: z.string(),                // stable hash; referenced by body fields
    kind: z.enum(['web','pdf','transcript','census','api','founder','synthetic','human_expert']),
    url: z.string().optional(),
    retrieved_at: z.string().datetime(),
    excerpt: z.string().max(2000),
    confidence: z.number().min(0).max(1),
  })).default([]),
  assumptions: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    status: z.enum(['verified','unverified','contradicted']),
    would_be_falsified_by: z.string(),
  })).default([]),
  quality: z.enum(['signed','partial','contested']),
  gaps: z.array(z.string()).default([]),
  cost_usd: z.number(),
  hash: z.string(),                       // sha256 over {type,version,body} — signing seals it
});
```

`assumptions[]` is the honesty channel. D02 in founder-absent mode fills it heavily; D05 marks every
synthetic result there. The Boardroom renders `unverified` assumptions in amber, always visible.

---

## 6. Prompt file convention

```
packages/prompts/
  _shared/company-context.md      # injected into every agent
  _shared/evidence-rules.md       # injected into every research agent
  _shared/safety.md               # injected into every agent
  _shared/output-contract.md      # "return JSON matching <schema>"
  D0N/head.md  D0N/<role>.md  D0N/critic.md  D0N/critic-rubric.md
```

Every Head prompt opens with the same four lines, so behavior is uniform across departments:

```
You are the Head of <Department> at Zeroth, an AI-run agency building a company for a human founder.
You do not do the work yourself. You decompose, dispatch, merge, and sign.
You may not fabricate. A gap is an acceptable output; an invented number is a P0 defect.
You report cost honestly, including your own.
```

---

## 7. Critic rubric convention

Every `critic-rubric.md` scores the artifact on 5–7 dimensions, 0–3 each, with a stated pass
threshold and at least two dimensions that are department-specific.

| Score | Meaning |
|---|---|
| 0 | Absent |
| 1 | Present but unusable |
| 2 | Adequate |
| 3 | Would survive a hostile reader |

Universal dimensions present in every rubric:

| Dimension | Fails when |
|---|---|
| **Evidence** | Any quantitative claim lacks a `source_id` |
| **Specificity** | Categories where names were required ("SMBs", "enterprises") |
| **Falsifiability** | No stated condition that would prove the artifact wrong |
| **Honesty** | Invented content not marked in `assumptions[]` |

The Critic returns exactly:

```json
{ "verdict": "accept" | "revise",
  "scores": { "evidence": 3, "specificity": 2, "...": 0 },
  "defects": [ { "path": "body.niches[2].tam", "problem": "...", "fix": "..." } ] }
```

`defects[].path` matters: the Head re-runs **only** the workers whose output feeds those paths.

---

## 8. How D13 uses this file

When Chief of Staff detects a `CapabilityGap` and decides to grow an organ, it:

1. Reads this file and 2–3 nearby department specs as few-shot examples.
2. Emits a `DepartmentManifest` YAML + a `packages/prompts/D0N/` directory + a Zod artifact schema.
3. Validates the manifest against §3.1 — a failure here is caught before anything runs.
4. Appends routing rules to `packages/manifests/routing.yaml`.
5. Runs the department in **Shadow Mode** against historical work orders (forked Superserve sandbox),
   comparing its output to what actually happened.
6. Files a founder gate: "deploy new department D14 — here is its shadow-mode record."
7. On approval, registers it on the **Band** mesh so existing departments discover it *without a
   redeploy*.

See [`D13-chief-of-staff.md`](D13-chief-of-staff.md).

---

## 9. Department index

| ID | Spec | Cluster | Primary output |
|---|---|---|---|
| D01 | [`D01-intake.md`](D01-intake.md) | discovery | `IdeaSeed`, `OpportunityCandidate[]` |
| D02 | [`D02-office-hours.md`](D02-office-hours.md) | discovery | `SharpenedIdea` |
| D03 | [`D03-market-research.md`](D03-market-research.md) | discovery | `NicheDossier[]` |
| D04 | [`D04-outreach-validation.md`](D04-outreach-validation.md) | validation | `Interview[]`, `ClaimLedger` |
| D05 | [`D05-synthetic-population.md`](D05-synthetic-population.md) | validation | `SyntheticPanelResult` |
| D06 | [`D06-pivot-decision.md`](D06-pivot-decision.md) | validation | `IdeaDiff[]`, `ProductSpec` |
| D07 | `D07-build.md` | build | `Deployment` |
| D08 | `D08-strategy.md` | gtm | `GTMPlan` |
| D09 | `D09-leads.md` | gtm | `Lead[]` |
| D10 | `D10-sales.md` | gtm | `Deal[]`, `Order` |
| D11 | `D11-finance-hr.md` | ops | `Ledger`, `BudgetAllocation`, `HumanHire` |
| D12 | `D12-support.md` | ops | `Ticket[]`, `ProductSignal[]` |
| D13 | `D13-chief-of-staff.md` | meta | `CapabilityGap`, new `DepartmentManifest` |
