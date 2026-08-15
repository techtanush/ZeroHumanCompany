# 02 — Agent Runtime & Orchestration

## What an agent is, concretely

An agent is a **row in a manifest**, not a class you hand-write. The runtime instantiates it.

```yaml
# packages/manifests/D03-market-research.yaml
id: D03
name: Market Research
cluster: discovery
head:
  agent_id: market.head
  model: opus            # tier: opus | sonnet | haiku | pioneer:<model>
  system_prompt_ref: prompts/D03/head.md
  max_tokens_per_run: 120000
critic:
  agent_id: market.critic
  model: sonnet
  rubric_ref: prompts/D03/critic-rubric.md
workers:
  - agent_id: market.demand
    model: sonnet
    replicas: 3
    system_prompt_ref: prompts/D03/demand.md
    tools: [web_search, web_fetch, apify.run_actor, solari.browse, memory.read]
    max_tokens_per_run: 60000
  - agent_id: market.money
    model: sonnet
    replicas: 2
    tools: [web_search, web_fetch, memory.read, calc]
concurrency: 8
budget:
  default_envelope_usd: 4.00
  hard_cap_usd: 8.00
io:
  input: SharpenedIdea
  output: NicheDossier[]
  min_outputs: 5
gates: []               # this department produces no irreversible actions
sandbox:
  image: zeroth/dept-base:latest
  cpu: 2
  mem_mb: 2048
  pause_between_cycles: true
sla:
  soft_deadline_s: 240
  on_timeout: return_partial
```

**Invariant:** if it isn't in `tools`, the agent physically cannot call it. The runtime builds the
tool array per agent; there is no ambient tool access.

## Execution engine

Built on **`@anthropic-ai/claude-agent-sdk`**. One `AgentSession` per agent instance.

```ts
// packages/agent-kit/src/run.ts  (shape, not final code)
export async function runAgent(spec: AgentSpec, ctx: RunContext): Promise<AgentResult> {
  const meter = ctx.meter.scope({ agent: spec.agent_id, work_order: ctx.workOrderId });
  const tools = ctx.toolPlane.build(spec.tools, {           // scoped credentials only
    venture: ctx.ventureId, department: spec.department, budget: meter,
  });
  const session = createSession({
    model: resolveModel(spec.model),
    systemPrompt: renderPrompt(spec.system_prompt_ref, ctx),
    tools,
    maxTokens: spec.max_tokens_per_run,
    onToolUse: e => ctx.events.emit('agent.tool_used', e),   // full audit
    onUsage:   u => meter.recordTokens(u),
  });
  const out = await session.run(ctx.input, { signal: ctx.abort });
  return validate(spec.output_schema, out);                  // Zod; throw → retry
}
```

### Model tiering policy (cost discipline is a feature)

| Tier | Used for | Guidance |
|---|---|---|
| `opus` | Department Heads, D06 pivot synthesis, D13 agent design | Judgment, synthesis, irreversible calls |
| `sonnet` | Most workers, critics, writing | Default |
| `haiku` | Extraction, dedup, formatting, classification at volume | Never for judgment |
| `pioneer:*` | Lead scoring, claim-strength, ticket triage once we have ≥500 labels | Fine-tuned via Fastino Pioneer; falls back to `haiku` if unavailable |

The Budget Meter can **downgrade a tier automatically** when a department is at >80% of envelope,
and it emits `budget.degraded` so the Boardroom shows it. That is a demo beat, not a bug.

## The Head loop

```
receive WorkOrder
├── load context     (artifact refs + department memory + venture memory; see 05-memory)
├── plan             produce a TaskGraph: [{worker_role, input_slice, budget, must_return}]
├── admit            meter.reserve(sum(budgets)) → fail ⇒ Escalation(needs_budget)
├── dispatch         Promise.allSettled over workers, bounded by manifest.concurrency
├── collect          partials allowed; record gaps[] for anything missing
├── merge            Head synthesizes into the output artifact
├── evidence check   every quantitative claim must have ≥1 source_id (11-evidence-and-truth.md)
├── critic           one adversarial pass → {accept | revise(defects[])}
├── revise (≤1)      re-run only the defective slices, not the whole thing
└── sign & emit      Artifact stored, ArtifactReady on bus, cost report attached
```

**Rule: one revision loop, maximum.** Unbounded critic loops are how hackathon demos run out of
money at 2am. If the critic rejects twice, ship with `quality: contested` and flag it in the UI.

## Sandboxing (Superserve)

Each department gets a Firecracker microVM.

| Concern | Design |
|---|---|
| Provisioning | Orchestrator leases from a warm pool of 4; cold start otherwise |
| State | Repo checkouts, scraped caches, and partial artifacts live on the sandbox FS |
| **Pause/resume** | Between cycles the sandbox is paused, not destroyed. Resident departments (Sales, Support, Finance) resume with everything intact — this is why Superserve, not plain containers |
| **Fork** | D06 forks a sandbox to run counterfactual pivots; D13 forks to shadow-test a new department against a snapshot |
| Egress | Allowlisted per manifest. Build sandbox gets git+npm+Render; Market gets search+scrape. No department gets everything. |
| Secrets | Never baked in. Short-lived scoped handles injected per run (see `07-identity-and-accounts.md`) |

Fallback if Superserve is unavailable: local Docker containers with the same interface
(`packages/sandbox` exposes `lease() / pause() / resume() / fork() / exec()` with two drivers).

## Scheduling

| Trigger type | Mechanism |
|---|---|
| Event-driven | `ArtifactReady` matches a routing rule → WorkOrder enqueued |
| Cron | BullMQ repeatable jobs. `sales.cadence` every 15m, `finance.reconcile` hourly, `cos.daily` 09:00, `cos.weekly` Mon, `cos.quarterly` |
| Webhook | Stripe, Whop, Linq inbound, Gmail push, Terac callback, Render deploy hooks |
| Founder action | Approve/Reject/Redirect from Boardroom or Linq |

**Demo-time compression:** a `time_scale` config multiplies all cron intervals (`0.001` in demo)
so "daily" review fires every ~90 seconds on stage. Documented, not hidden.

## Prompt organization

```
packages/prompts/
  _shared/
    company-context.md      # who we are, the venture, the current state — injected everywhere
    evidence-rules.md       # citation requirements — injected into every research agent
    safety.md               # what agents must never do — injected everywhere
    output-contract.md      # "return JSON matching this Zod schema" boilerplate
  D01/…  D02/…  …  D13/…
```

Prompts are **files, not string literals**, so D13 can write new ones and so a human can review a
diff of the company's own reasoning.

## Determinism & replay

- Every agent run stores `{prompt_hash, model, seed, input_refs, output_ref, tokens, cost}`.
- `replay(work_order_id)` re-runs with cached tool responses — used for debugging and for the demo
  fallback path.
- Deterministic seeding in `simpop` (inherited from `simit`) so the population panel is
  reproducible across runs.
