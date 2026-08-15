# 13 — Permissions & Policy: Who May Do What

One sentence: **capability is granted, never ambient** — every subject (agent, department, founder,
human contractor) acts only through capabilities the policy engine has explicitly issued, and the
default answer for anything irreversible is *no*.

```
                     request(subject, action, resource, context)
                                      │
                                      ▼
            ┌──────────────────────────────────────────────────┐
            │              POLICY ENGINE (kernel)               │
            │  1. kill switch          → DENY (absolute)        │
            │  2. hard prohibitions    → DENY (absolute)        │
            │  3. venture scope check  → DENY on mismatch       │
            │  4. manifest allowlist   → DENY if tool absent    │
            │  5. credential scopes    → DENY if scope missing  │
            │  6. budget admission     → DENY if frozen/over    │
            │  7. gate policy          → GATE if irreversible   │
            │  8. autonomy table       → AUTO | ASK             │
            │  9. default              → ALLOW (reversible only)│
            └───────────────┬──────────────────────────────────┘
                            ▼
             ALLOW │ ALLOW_WITH_GATE │ DENY  — always emitted as an event
```

The engine lives in `apps/kernel/src/policy/engine.ts` and is called at the **tool plane
boundary** — inside the kernel, outside every sandbox. Prompts describe policy to agents;
the engine *enforces* it. An agent that ignores its prompt hits a wall, not a warning.

Upstream: [`02-agent-runtime.md`](02-agent-runtime.md) (tool allowlists),
[`06-human-in-the-loop.md`](06-human-in-the-loop.md) (gates, autonomy),
[`07-identity-and-accounts.md`](07-identity-and-accounts.md) (credential scopes).
Downstream: [`14-secrets-and-vault.md`](14-secrets-and-vault.md) (credential brokering honors
these decisions), [`10-observability.md`](10-observability.md) (every decision
is an auditable event).

---

## Subjects

**MVP**

| Subject kind | Identity | Example | Authenticated by |
|---|---|---|---|
| `agent` | `agent_id` from a `DepartmentManifest` | `market.demand#2` (replica 2) | Runtime-issued run token, bound to `agent_run_id` |
| `department` | `department_id` | `D07` | The Head's run token carries department identity |
| `founder` | `founders.id` | the human owner | Boardroom session (cookie) or Linq sender verification |
| `human_contractor` | `terac_hires.id` | a Terac-verified nurse | Terac callback signature; contractors never hold kernel tokens |
| `system` | fixed principals | `scheduler`, `webhook:stripe`, `kernel` | Internal; webhooks verified per [`17-api-contracts.md`](17-api-contracts.md) |

```ts
// packages/contracts/src/policy.ts
import { z } from 'zod';
import { DepartmentId } from './primitives';

export const Subject = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), agent_id: z.string(), agent_run_id: z.string().uuid(),
             department_id: DepartmentId, role: z.enum(['head','worker','critic']) }),
  z.object({ kind: z.literal('department'), department_id: DepartmentId }),
  z.object({ kind: z.literal('founder'), founder_id: z.string().uuid() }),
  z.object({ kind: z.literal('human_contractor'), terac_hire_id: z.string().uuid() }),
  z.object({ kind: z.literal('system'), principal: z.enum(['scheduler','kernel','webhook']) }),
]);
```

**Human contractors are data sources, not actors.** A Terac hire's deliverable enters the pipeline
as a `Source` (`human_hire_output`) attached to an artifact. Contractors get a scoped upload URL
and nothing else — no tool access, no kernel API, no venture visibility beyond their task brief.

---

## Resources and actions

**MVP**

Resources are named hierarchically: `<domain>:<type>[:<id>]`. Actions are verbs on those resources.

| Resource domain | Resources | Actions |
|---|---|---|
| `tool` | `tool:web_search`, `tool:composio.gmail.send`, `tool:stripe.refund`, … | `invoke` |
| `artifact` | `artifact:NicheDossier`, `artifact:ProductSpec`, … | `read`, `create`, `supersede`, `sign` |
| `memory` | `memory:working`, `memory:department`, `memory:venture`, `memory:institutional` | `read`, `write`, `promote` |
| `credential` | `credential:<provider>` | `grant` (a handle), never `read` |
| `budget` | `budget:<department_id>` | `reserve`, `commit`, `release` |
| `gate` | `gate:<gate_type>` | `open`, `decide` |
| `venture` | `venture:<id>` | `read`, `configure`, `kill`, `resume` |
| `department` | `department:<id>` | `freeze`, `unfreeze`, `deploy` (D13's new-department path) |

```ts
export const PolicyRequest = z.object({
  subject: Subject,
  action: z.string(),                    // 'invoke' | 'read' | 'reserve' | 'open' | …
  resource: z.string(),                  // 'tool:composio.gmail.send'
  venture_id: z.string().uuid(),
  context: z.object({
    args_hash: z.string().optional(),    // sha256 of tool args — binds the decision to bytes
    amount_usd: z.number().optional(),
    target_person: z.boolean().default(false),   // touches a real human?
    reversible: z.boolean().default(false),
    gate_id: z.string().uuid().optional(),       // present when executing an approved gate
    trace_id: z.string(),
  }),
});

export const PolicyDecision = z.object({
  effect: z.enum(['allow','allow_with_gate','deny']),
  rule_id: z.string(),                   // which rule fired, e.g. 'hard_prohibition:captcha.solve'
  gate_type: z.string().optional(),      // when effect = allow_with_gate
  reason: z.string(),                    // human-readable, shown in the Boardroom
  ttl_s: z.number().int().default(0),    // 0 ⇒ never cached; decisions are per-request by default
});
```

---

## Evaluation order (deny wins, always)

**MVP** — the nine steps, in order. The first matching DENY terminates evaluation. There is no
rule that can re-allow something a higher step denied.

| Step | Check | Source of truth | On failure |
|---|---|---|---|
| 1 | Kill switch active for venture? | `ventures.status` | DENY. Everything parks ([`06-human-in-the-loop.md`](06-human-in-the-loop.md)). |
| 2 | Hard prohibition? (`HARD_PROHIBITED`, secret-looking args) | `packages/identity/src/prohibited.ts` | DENY + `agent.tool_failed`; repeated attempts freeze the department |
| 3 | Venture scope: subject's `venture_id` = resource's? | run token claims | DENY + `policy.scope_violation` — this should never fire; it firing is a P0 |
| 4 | Tool in the subject's manifest `tools[]`? | frozen `departments.manifest_yaml` | DENY. "Not in the manifest" is not an error state, it is the design. |
| 5 | Credential scopes cover the call? | `credential_grants.scopes` | DENY → `Escalation(needs_credential)` |
| 6 | Budget: department not `frozen`, reservation exists? | `budget_allocations` ([`08-money-and-metering.md`](08-money-and-metering.md)) | DENY → `Escalation(needs_budget)` |
| 7 | Action irreversible per the gate table? | `DepartmentManifest.gates[]` + gate type table | ALLOW_WITH_GATE — execution blocked until `gate.approved` |
| 8 | Autonomy decision table | [`06-human-in-the-loop.md`](06-human-in-the-loop.md) Part 3 | AUTO (approve + log) or ASK (open a founder gate) |
| 9 | Default | — | ALLOW, only because steps 1–8 proved it reversible and in-scope |

```ts
// apps/kernel/src/policy/engine.ts (shape)
export async function evaluate(req: PolicyRequest): Promise<PolicyDecision> {
  const steps: PolicyStep[] = [
    killSwitch, hardProhibitions, ventureScope, manifestAllowlist,
    credentialScopes, budgetAdmission, gateRequirement, autonomyTable,
  ];
  for (const step of steps) {
    const d = await step(req);
    if (d) { await emitDecision(req, d); return d; }     // first decisive step wins
  }
  const d = { effect: 'allow' as const, rule_id: 'default_reversible', reason: 'reversible, in scope', ttl_s: 0 };
  await emitDecision(req, d);
  return d;
}
```

Every decision — including ALLOW — emits `policy.evaluated` with `{subject, action, resource,
effect, rule_id, args_hash, trace_id}`. That is what makes
"[reconstruct any decision](10-observability.md)" possible.

**Decision caching: none for deny-capable steps.** Steps 1–3 are microseconds. Steps 4–5 read
in-memory copies of the manifest and grants. A cached ALLOW that outlives a freeze or a revocation
is a security bug; we take the latency instead.

---

## Autonomy levels

**MVP** — `ventures.autonomy_level ∈ {copilot, supervised, autonomous}` is an input to step 8
only. It never affects steps 1–7: a venture at `autonomous` still cannot call an unlisted tool,
exceed a frozen budget, or touch another venture's resources. Autonomy widens the AUTO column of
the [gate decision table](06-human-in-the-loop.md), nothing else.

| Level | What changes | What never changes |
|---|---|---|
| `copilot` | Nearly every gate ASKs; rung-3 escalations divert to the founder | Allowlists, budgets, prohibitions |
| `supervised` | Small `money_out`, warm outreach, QA-green deploys auto-approve | `public_content`, `new_department` still ASK |
| `autonomous` | Cold outreach ≤50/day, Terac hires within cap, reversible pivots auto-approve | `money_out > $25`, `public_content`, `new_department`, one-way pivots still ASK |

---

## Per-venture scopes

**MVP**

Every run token the orchestrator mints is a signed claim set:

```ts
// packages/agent-kit/src/token.ts
export const RunToken = z.object({
  sub: z.string(),                       // 'market.demand#2'
  agent_run_id: z.string().uuid(),
  venture_id: z.string().uuid(),         // THE scope. Checked on every kernel call.
  department_id: DepartmentId,
  role: z.enum(['head','worker','critic']),
  tools: z.array(z.string()),            // copied from the manifest at provision time
  exp: z.number(),                       // ≤ sandbox lease duration
  iat: z.number(),
});
// HMAC-SHA256 with the kernel signing key; sandboxes cannot mint or alter tokens.
```

| Rule | Enforcement |
|---|---|
| A token is minted per `agent_run`, expires with the sandbox lease | orchestrator |
| `venture_id` in the token must equal `venture_id` on every resource touched | policy step 3 |
| Cross-venture reads are impossible even for D13 — institutional memory (T4) is the only shared surface, and it is PII-scrubbed ([`05-memory-and-context.md`](05-memory-and-context.md)) | memory service |
| The founder's Boardroom session is scoped to their own ventures | kernel auth middleware |
| Credential grants carry `venture_id`; resolution rejects mismatches | vault ([`14-secrets-and-vault.md`](14-secrets-and-vault.md)) |

**POST-MVP:** multi-founder ventures with per-founder roles (owner, observer). The `Subject`
union already admits it; the gate decider today is always the single owning founder.

---

## Tool allowlists per department

**MVP** — the authoritative allowlist is each department's manifest `tools[]`
([`02-agent-runtime.md`](02-agent-runtime.md)). This table is the company-wide view; the manifest
is the source of truth and CI asserts this table matches the manifests
(`packages/manifests/test/allowlist-matrix.test.ts`).

| Tool family | D01 | D02 | D03 | D04 | D05 | D06 | D07 | D08 | D09 | D10 | D11 | D12 | D13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `web_search` / `web_fetch` | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `apify.run_actor` | — | — | ✅ | ✅ | — | — | — | — | ✅ | — | — | — | — |
| `solari.browse` (computer use) | — | — | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | — | — | — | — |
| `composio.gmail.send` | — | — | — | ✅ | — | — | — | — | — | ✅ | ✅ | ✅ | — |
| `composio.gmail.read` | — | — | — | ✅ | — | — | — | — | — | ✅ | ✅ | ✅ | — |
| `composio.linkedin.*` | — | — | — | ✅ | — | — | — | ✅ | ✅ | ✅ | — | — | — |
| `composio.github.*` | — | — | — | — | — | — | ✅ | — | — | — | — | ✅ | ✅ |
| `voice.call` (ElevenLabs + telephony) | — | — | — | ✅ | — | — | — | — | — | ✅ | — | ✅ | — |
| `simpop.*` | — | — | ✅ | — | ✅ | ✅ | — | ✅ | — | — | — | — | — |
| `render.deploy` | — | — | — | — | — | — | ✅ | — | — | — | — | — | ✅ |
| `replay.run_qa` | — | — | — | — | — | — | ✅ | — | — | — | — | ✅ | ✅ |
| `lovable.generate` | — | — | — | — | — | — | ✅ | ✅ | — | — | — | — | — |
| `stripe.payment_link` | — | — | — | — | — | — | — | — | — | ✅ | ✅ | — | — |
| `stripe.refund` | — | — | — | — | — | — | — | — | — | — | ✅ | — | — |
| `terac.*` (post job, pay) | — | — | — | — | — | — | — | — | — | — | ✅ | — | — |
| `registrar.purchase` | — | — | — | — | — | — | — | — | — | — | ✅ | — | — |
| `linq.message` (founder) | — | — | — | — | — | — | — | — | — | — | — | — | — |
| `memory.read` / `memory.fetch` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `memory.promote` (T4) | — | — | — | — | — | — | — | — | — | — | — | — | ✅ |
| `manifest.deploy` (new department) | — | — | — | — | — | — | — | — | — | — | — | — | ✅ (gated) |

Notes that keep this honest:

- `linq.message` is **no department's tool**. Only the kernel's gate engine and escalation ladder
  send founder cards. A department that wants the founder's attention opens a gate or escalates.
- D05 SimPop has no web tools *by design* — the panel must not contaminate itself with what the
  company hopes to hear ([`05-memory-and-context.md`](05-memory-and-context.md), retrieval table).
- Only D11 touches money-moving tools (`stripe.refund`, `terac.*`, `registrar.purchase`), and each
  of those still requires a `money_out` or `refund` gate per call.
- D13 holds `manifest.deploy` but the `new_department` gate NEVER auto-approves.

---

## The permission matrix

**MVP** — subjects × high-consequence actions. `GATE(x)` = allowed only via an approved gate of
type `x`. `POLICY` = allowed subject to steps 1–8. Blank = denied by default.

| Action | Agent (worker) | Agent (head) | Agent (critic) | Department (D13) | Founder | Human contractor | System |
|---|---|---|---|---|---|---|---|
| Invoke read-only tool (search, fetch, memory.read) | POLICY | POLICY | POLICY | POLICY | — | — | — |
| Create/supersede artifact | POLICY | POLICY | — | POLICY | — | — | — |
| Sign artifact | — | POLICY | — | POLICY | — | — | kernel only |
| Contest artifact | — | — | POLICY | POLICY | ✅ | — | — |
| Send email/DM to a real person | — | GATE(`outbound_to_real_person`) | — | — | ✅ (own account) | — | — |
| Place a voice call | — | GATE(`outbound_to_real_person`) | — | — | ✅ | — | — |
| Publish public content | — | GATE(`public_content`) | — | — | ✅ | — | — |
| Spend money (any amount) | — | GATE(`money_out`) | — | — | ✅ | — | — |
| Issue refund | — | GATE(`refund`) D11 only | — | — | ✅ | — | — |
| Create third-party account | — | GATE(`account_creation`) | — | GATE(`account_creation`) | ✅ | — | — |
| Deploy to production | — | GATE(`deploy`) D07 only | — | GATE(`deploy`) | ✅ | — | — |
| Apply a pivot to ProductSpec | — | GATE(`pivot_approval`) D06 only | — | — | ✅ | — | — |
| Deploy a new department | — | — | — | GATE(`new_department`) | ✅ | — | — |
| Reserve/commit budget | — | POLICY | — | POLICY | — | — | scheduler |
| Reallocate budget envelopes | — | D11 head only | — | — | ✅ | — | — |
| Decide a gate | — | — | — | — | ✅ | — | policy AUTO only |
| Read venture memory (T3) | POLICY | POLICY | POLICY | POLICY | ✅ | — | — |
| Write institutional memory (T4) | — | — | — | ✅ via `memory.promote` | — | — | — |
| Read raw credentials | — | — | — | — | — | — | — |
| Hold a credential handle | POLICY | POLICY | — | POLICY | — | — | — |
| Freeze/unfreeze a department | — | — | — | POLICY | ✅ | — | budget meter |
| Kill / resume venture | — | — | — | — | ✅ | — | — |
| Upload a deliverable | — | — | — | — | — | ✅ (scoped URL) | — |
| Set autonomy level / caps | — | — | — | — | ✅ | — | — |

The **"Read raw credentials" row is all-blank on purpose** — not even the founder reads secrets
back out of the vault ([`14-secrets-and-vault.md`](14-secrets-and-vault.md)); they can only rotate
or revoke.

---

## Deny-by-default for irreversible actions

**MVP** — the closed list of irreversible action classes, restated from
[`06-human-in-the-loop.md`](06-human-in-the-loop.md) as *policy defaults*:

```ts
// apps/kernel/src/policy/irreversible.ts
export const IRREVERSIBLE_CLASSES = {
  money_out:                { default: 'deny', requires: 'gate:money_out' },
  public_content:           { default: 'deny', requires: 'gate:public_content' },
  outbound_to_real_person:  { default: 'deny', requires: 'gate:outbound_to_real_person' },
  account_creation:         { default: 'deny', requires: 'gate:account_creation' },
  pivot_one_way_door:       { default: 'deny', requires: 'gate:pivot_approval' },
  production_deploy:        { default: 'deny', requires: 'gate:deploy' },
  refund:                   { default: 'deny', requires: 'gate:refund' },
  new_department:           { default: 'deny', requires: 'gate:new_department' },
  data_deletion:            { default: 'deny', requires: 'founder_direct_action' },   // no gate type: agents may never delete
  legal_commitment:         { default: 'deny', requires: 'founder_direct_action' },   // contracts, ToS beyond account ceremony
} as const;
```

Rules that make deny-by-default real rather than rhetorical:

1. **Classification happens in the tool driver, not the agent.** `composio.gmail.send` is
   *statically* classified `outbound_to_real_person` unless the recipient is on the venture's own
   domain. An agent cannot argue its way into "this email is internal."
2. **The gate binds to bytes.** `gates.action` is the serialized call; `context.args_hash` at
   execution must match the hash approved. Approve-then-swap is structurally impossible
   ([`06-human-in-the-loop.md`](06-human-in-the-loop.md), "the founder approves bytes").
3. **No gate, no retry.** A DENY from step 7 without an open gate is terminal for that tool call.
   The agent's recourse is to *request* a gate, which is itself policy-checked (a department can
   only open gate types in its manifest `gates[]`).
4. **`data_deletion` and `legal_commitment` have no agent path at all.** They appear in no
   manifest and no gate type. Deletion is a founder-initiated kernel operation
   ([`12-safety-and-compliance.md`](12-safety-and-compliance.md), retention & deletion).
5. **Unknown tools are irreversible until proven otherwise.** A new tool added without a
   `reversible` flag in its driver metadata is treated as `money_out`-class. Fail closed.

**POST-MVP:** per-founder custom irreversible classes ("never contact anyone at company X"),
compiled into suppression rules the policy engine checks at step 2 severity.

---

## Policy for D13-generated departments

**MVP** — a new department's manifest is itself policy input, so the manifest is validated before
the `new_department` gate even opens:

| Check | Rule |
|---|---|
| Tool budget | New manifests may only request tools from the existing tool plane; novel tools are a `needs_capability` escalation, not a manifest entry |
| Gate honesty | If any requested tool is irreversible-classed, the manifest must declare the matching gate type in `gates[]`, or validation rejects |
| Envelope cap | `budget.hard_cap_usd` ≤ 10% of `per_cycle_usd` for the first 3 cycles |
| Scope | Generated departments get `memory` read tiers ⊆ {department, venture}; T4 read requires a founder-approved manifest amendment |
| Shadow first | The `new_department` gate cannot open until `capability_gaps.status = 'shadow_tested'` ([`16-evaluation-framework.md`](16-evaluation-framework.md)) |

---

## Tests that pin the model

```ts
// apps/kernel/src/policy/engine.test.ts
it('denies any tool not in the manifest, at every autonomy level', async () => {
  for (const level of ['copilot','supervised','autonomous'] as const) {
    const d = await evaluate(req({ subject: agent('market.demand'), resource: 'tool:stripe.refund', level }));
    expect(d.effect).toBe('deny');
    expect(d.rule_id).toBe('manifest_allowlist');
  }
});

it('denies cross-venture access even for D13', async () => {
  const d = await evaluate(req({ subject: agent('cos.head', ventureA), resource: 'artifact:ProductSpec', venture_id: ventureB }));
  expect(d.effect).toBe('deny');
  expect(d.rule_id).toBe('venture_scope');
});

it('deny wins over gate: frozen department cannot open money_out', async () => {
  await freeze('D11');
  const d = await evaluate(req({ subject: head('finance.head'), action: 'open', resource: 'gate:money_out' }));
  expect(d.effect).toBe('deny');           // step 6 fires before step 7
});

it('gate execution requires matching args_hash', async () => {
  const gate = await approveGate({ action: sendEmail(argsA) });
  await expect(execute(gate, argsB)).rejects.toThrow('gate/args mismatch');
});
```

---

## Assumptions & open questions

- **Assumption:** one policy engine instance per kernel process is sufficient; decisions are
  stateless reads over in-memory manifest/grant caches invalidated by events. If kernel scales
  horizontally (POST-MVP), cache invalidation rides the bus.
- **Assumption:** the run-token HMAC key and the artifact-signing key can be the same kernel
  signing key for the hackathon; production should split them
  ([`14-secrets-and-vault.md`](14-secrets-and-vault.md), key hierarchy).
- **Open:** should critics be allowed `web_fetch` to verify citations independently? Today they
  read only what the Head hands them, which keeps them cheap but trusts the Head's source snapshots.
- **Open:** rate-limit tiers per tool per department (e.g. `solari.browse` ≤ N sessions/cycle)
  currently live in the budget layer via unit costs; a dedicated quota step between 6 and 7 may be
  cleaner once we see real usage.
- **Open:** when D13 amends `routing.yaml`, is that policy-checked as `department:deploy` or as a
  distinct `routing:amend` action? Leaning distinct, POST-MVP.
