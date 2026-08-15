# D07 — Build

**Cluster:** build · **Head:** `build.architect` · **Critic:** `build.critic` · **Resident:** no (wakes on `ProductSpec` v≥2, stays warm through the venture)

---

## 1. Mission

> Turn a signed `ProductSpec v2` into a real, deployed, QA-verified product living in a real git repo the company owns.

**The single question it answers:** *"Does the thing exist, at a URL, and does it work?"*

Every other department produces documents. D07 is the only department whose output a customer can
touch. It is therefore the only department allowed to push code and create infrastructure
([`../00-vision/03-org-chart.md`](../00-vision/03-org-chart.md) — "who can talk to the outside world").

---

## 2. Inputs / Outputs

### Inputs

| Artifact | From | Required | Use |
|---|---|---|---|
| `ProductSpec` (v≥2) | D06 | yes | The build contract |
| `NicheDossier` (selected) | D03 | yes | Copy, positioning of the marketing site, pricing tier names |
| `ClaimLedger` | D04 | yes | QA scenario generation — real users' described workflows become test scenarios |
| `GTMPlan` | D08 | no (arrives in parallel) | Pricing table on marketing site; Whop listing copy |
| `ProductSignal[]` | D12 | no (later cycles) | Bug/feature work orders after launch |

```ts
// packages/contracts/src/artifacts/product-spec.ts  (owned by D06, consumed here)
export const ProductSpec = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  version: z.number().int().min(1),
  one_liner: z.string(),
  icp: z.string(),
  venture_kind: z.enum(['b2b_saas','consumer_app','community','marketplace','tool','content']),
  geography: z.enum(['us','eu','intl','global']),
  features: z.array(z.object({
    id: z.string(),                                   // 'F-03'
    title: z.string(),
    user_story: z.string(),                           // "As a <icp> I can <x> so that <y>"
    acceptance_criteria: z.array(z.string()).min(1),  // becomes QA scenarios verbatim
    priority: z.enum(['p0','p1','p2']),
    evidence_refs: z.array(z.string()),               // claim_ids from D04 — why this feature exists
  })).min(1),
  non_goals: z.array(z.string()),
  data_model_hints: z.array(z.string()).default([]),
  integrations_required: z.array(z.string()).default([]),  // 'stripe', 'gmail'
  auth_model: z.enum(['none','magic_link','oauth_google','password']),
  pricing: z.object({ model: z.enum(['free','one_time','subscription','usage']), tiers: z.array(z.object({
    name: z.string(), price_usd: z.number(), interval: z.enum(['once','month','year']).optional(),
    includes: z.array(z.string()) })) }),
});
```

### Outputs

```ts
export const Deployment = z.object({
  id: z.string().uuid(),
  venture_id: z.string().uuid(),
  product_spec_version: z.number().int(),
  repo: z.object({
    github_org: z.string(),          // 'zeroth-vn-4f2a'  — created by the company itself
    name: z.string(),                // 'shiftswap'
    url: z.string().url(),
    default_branch: z.literal('main'),
    release_commit_sha: z.string(),
    release_tag: z.string(),         // 'v0.1.0-build-7'
  }),
  services: z.array(z.object({
    render_service_id: z.string(),
    kind: z.enum(['web','worker','static','postgres','redis']),
    url: z.string().url().optional(),
    region: z.string(),
  })),
  app_url: z.string().url(),
  marketing_url: z.string().url().optional(),        // Lovable
  storefront_url: z.string().url().optional(),       // Whop
  stack: z.record(z.string()),                       // {framework:'next@15', db:'postgres', orm:'drizzle', …}
  qa: z.object({
    scenarios_total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    replay_recordings: z.array(z.object({
      scenario_id: z.string(), status: z.enum(['pass','fail','flaky']),
      replay_url: z.string().url(),                  // shareable — the founder can watch it
      founder_summary: z.string(),                   // plain English, no stack traces
    })),
  }),
  health: z.enum(['green','degraded','down']),
  cost_usd: z.number(),
  built_at: z.string().datetime(),
});

export const BuildFailure = z.object({
  id: z.string().uuid(),
  stage: z.enum(['architect','implement','integrate','qa','deploy']),
  feature_ids: z.array(z.string()),
  summary: z.string(),
  replay_url: z.string().url().optional(),
  recoverable: z.boolean(),
  proposed_action: z.enum(['retry','descope_feature','escalate_founder','requisition_human']),
});
```

---

## 3. Where does the code live?

This question gets a full section because it is the one a judge will ask.

```
GitHub (durable state, company-owned)          Superserve sandbox (ephemeral working copy)
┌───────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ org:  zeroth-vn-<venture_short>   │◄─push────│ /workspace/repo            (bare-ish main)│
│ repo: <product-slug>              │          │ /workspace/wt/impl-1  ─┐                  │
│  main            ← protected      │──clone──►│ /workspace/wt/impl-2   │ git worktrees    │
│  build/<n>       ← integration    │          │ /workspace/wt/impl-3  ─┘                  │
│  feat/<n>/F-01   ← per implementer│          │ /workspace/.zeroth/state.json             │
│  tags v0.1.x                      │          │ node_modules, .next, caches               │
└───────────────────────────────────┘          └──────────────────────────────────────────┘
        ▲ durable, survives everything                 ▲ paused between cycles, forkable
```

**The rules:**

1. **The GitHub org is created by the company, not by us.** At venture start the Identity service
   ([`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md))
   runs an `AccountCeremony`: creates a GitHub organization `zeroth-vn-<short>` via the GitHub API
   using the company's own Gmail identity, installs a fine-grained PAT into the Identity Vault
   scoped to that org only. If GitHub requires a human step (phone/2FA), Solari drives the browser
   and Linq texts the founder for the code. D07 never sees the raw token — it gets a scoped handle.
2. **GitHub is durable state. The sandbox FS is a cache.** Invariant: *nothing exists only in the
   sandbox for more than one worker task.* Every Implementer pushes its branch at every green
   checkpoint. If the sandbox is destroyed at any instant, the worst loss is one task's worth of
   uncommitted work, and the Head can re-dispatch that task from the last pushed commit.
3. **State survives sandbox pause** by three mechanisms, in order of cost:
   | Mechanism | Survives | Cost |
   |---|---|---|
   | Superserve **pause** (memory + FS snapshot) | Pause/resume between cycles — `node_modules`, caches, worktrees all intact | ~free, seconds to resume |
   | **Git push** to GitHub | Sandbox destruction, host failure, region loss | seconds |
   | `/workspace/.zeroth/state.json` mirrored to the kernel as an artifact after every stage | Total loss of both | one artifact write |
   `state.json` = `{task_graph, per_task{branch, last_sha, status}, stack_decision, qa_matrix, deploy_ids}`.
   On resume, the Head reads `state.json`, runs `git fetch --all`, and reconciles: any task whose
   branch head ≠ recorded sha is re-verified, not re-run.
4. **The founder owns it.** At `deal_won` or at demo end, the org's ownership can be transferred to
   the founder's GitHub account in one API call. The company built it; the founder keeps it.

### Branch / worktree strategy

| Branch | Created by | Lifetime | Protection |
|---|---|---|---|
| `main` | Architect (initial scaffold commit) | forever | No direct pushes. Merge only from `build/<n>` after QA green. |
| `build/<n>` | Integrator, per build cycle `n` | one cycle | Integration target. All `feat/*` merge here. |
| `feat/<n>/<FEATURE_ID>` | Implementer `k` | one task | Owned exclusively by one Implementer. |
| `hotfix/<ticket>` | D12-triggered build | until merged | Same gate as `build/*`. |

Each Implementer gets a **separate `git worktree`**, not a separate clone:
`git worktree add /workspace/wt/impl-2 -b feat/7/F-03 origin/build/7`. One object store, N working
directories, zero clone cost, and no two agents can ever be in the same directory — which is the
actual failure mode when you run parallel Claude Code sessions.

### Commit conventions

```
<type>(<feature_id>): <imperative summary>

<why — cite the evidence>
Evidence: claim_id=CL-114 ("I spend Sunday night rebuilding the roster by hand")
Spec: ProductSpec v2 F-03 · AC 2/4
Agent: build.implementer#2 · model=sonnet · work_order=<uuid> · tokens=18412

Co-Authored-By: Zeroth Build Agent <build@zeroth-vn-4f2a.dev>
```

`type ∈ {feat, fix, chore, test, infra, docs}`. Every commit trailer carries the work order id, so
`git log` is a second audit trail that agrees with the event store. `git blame` on a line answers
*which agent wrote this and which customer quote justified it.*

---

## 4. `DepartmentManifest`

```yaml
# packages/manifests/D07-build.yaml
id: D07
name: Build
cluster: build
head:
  agent_id: build.architect
  model: opus
  system_prompt_ref: prompts/D07/architect.md
  max_tokens_per_run: 180000
critic:
  agent_id: build.critic
  model: sonnet
  rubric_ref: prompts/D07/critic-rubric.md
  max_tokens_per_run: 40000
workers:
  - agent_id: build.implementer
    model: sonnet                       # claude-code headless; opus only on escalated retry
    replicas: 4                         # elastic 2–4, see task decomposition
    replicas_min: 2
    system_prompt_ref: prompts/D07/implementer.md
    tools: [claude_code.headless, git, fs.workspace, shell.build, web_fetch, memory.read]
    max_tokens_per_run: 220000
  - agent_id: build.integrator
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D07/integrator.md
    tools: [git, fs.workspace, shell.build, claude_code.headless]
    max_tokens_per_run: 120000
  - agent_id: build.qa
    model: sonnet
    replicas: 2
    system_prompt_ref: prompts/D07/qa.md
    tools: [replay.record, replay.query, browser.playwright, shell.build, fs.workspace, memory.read]
    max_tokens_per_run: 90000
  - agent_id: build.deployer
    model: sonnet
    replicas: 1
    system_prompt_ref: prompts/D07/deployer.md
    tools: [render.api, github.api, lovable.api, whop.api, stripe.products, dns.api, http.probe]
    max_tokens_per_run: 60000
concurrency: 6
budget:
  default_envelope_usd: 12.00
  hard_cap_usd: 20.00
  degrade_at_pct: 80          # → drop implementer replicas to 2, descope p2 features
io:
  input: ProductSpec
  output: Deployment
  min_outputs: 1
gates:
  - id: deploy_to_production
    trigger: before render.api.create_service on a public URL
    autonomy: [copilot, supervised]        # auto-approves at 'autonomous'
    card: linq/deploy-gate.json
  - id: repo_public
    trigger: before making the GitHub repo public
    autonomy: [copilot, supervised, autonomous]   # never auto
  - id: spend_infra
    trigger: before creating any paid Render plan
    autonomy: [copilot, supervised]
sandbox:
  image: zeroth/dept-build:latest        # node22 + pnpm + git + gh + playwright + replay-cli + render-cli
  cpu: 8
  mem_mb: 16384
  disk_gb: 40
  pause_between_cycles: true
  fork_allowed: true                      # D13 forks this for shadow builds
  egress_allowlist:
    - api.anthropic.com
    - github.com
    - api.github.com
    - registry.npmjs.org
    - api.render.com
    - api.replay.io
    - api.lovable.dev
    - api.whop.com
    - api.stripe.com
sla:
  soft_deadline_s: 900
  on_timeout: descope_to_p0_and_ship
```

---

## 5. Agent roster

| Agent | Role | Model | Tools | Token budget | Replicas |
|---|---|---|---|---|---|
| `build.architect` | Head. Stack decision, task decomposition, scaffold, merge policy, sign-off | `opus` | git, fs, shell, web_search, claude_code.headless | 180k | 1 |
| `build.implementer` | Writes features in an isolated worktree via headless Claude Code | `sonnet` | claude_code.headless, git, fs.workspace, shell.build, web_fetch | 220k each | 2–4 |
| `build.integrator` | Merges branches, resolves conflicts, keeps `build/<n>` green | `sonnet` | git, fs, shell.build, claude_code.headless | 120k | 1 |
| `build.qa` | Generates + runs scenarios, records everything in Replay, writes founder-readable failure summaries | `sonnet` | replay.*, browser.playwright, shell.build | 90k each | 2 |
| `build.deployer` | Render services, env vars, migrations, health probe, Lovable site, Whop listing, rollback | `sonnet` | render.api, github.api, lovable.api, whop.api, stripe.products, http.probe | 60k | 1 |
| `build.critic` | Adversarial review of the Deployment artifact against the rubric | `sonnet` | fs.readonly, http.probe, replay.query | 40k | 1 |

**How Claude Code runs headless.** Each Implementer is *not* a chat loop. The runtime spawns, inside
the sandbox worktree:

```bash
ANTHROPIC_API_KEY=$(vault handle build.implementer.anthropic) \
claude -p "$(cat /workspace/.zeroth/tasks/F-03.md)" \
  --output-format stream-json \
  --permission-mode acceptEdits \
  --allowedTools "Read,Write,Edit,Bash(pnpm *),Bash(git *),Grep,Glob" \
  --max-turns 60 \
  --cwd /workspace/wt/impl-2
```

The stream-json output is piped into the meter (`onUsage`) and the event store (`agent.tool_used`),
exactly like any other agent — see [`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md).
The Implementer agent (Sonnet, in the orchestrator) *supervises* that process: it wrote the task
file, it reads the stream, it decides when the task is done, it runs the checkpoint, it pushes.

---

## 6. System prompts

### `prompts/D07/architect.md` — Head

```
You are the Architect of the Build department of an autonomous company. You do not write
application code. You decide what gets built, in what shape, by whom, and whether it may ship.

INPUT: a signed ProductSpec (version >= 2), the selected NicheDossier, and the ClaimLedger of real
interviews that justify each feature.

YOUR OUTPUT is a BuildPlan JSON:
{ stack: {...}, scaffold_commands: [...], tasks: [{id, feature_ids, title, files_owned,
  interface_contracts, acceptance_criteria, depends_on, budget_tokens, worktree}],
  integration_order: [...], qa_focus: [...], deploy_topology: {...} }

RULES YOU DO NOT BREAK:
1. Choose the BORING stack. You are shipping in under 15 minutes of wall clock, not winning an
   architecture award. Use the decision matrix in your context. If two options tie, pick the one
   with the smaller dependency graph.
2. Build only p0 features in cycle 1. p1 in cycle 2. p2 only if the budget meter is under 50%.
   A shipped p0 beats a half-built p1. Descoping is a decision you make silently and record; it is
   not an escalation.
3. Decompose by FILE OWNERSHIP, not by layer. Two implementers must never be able to edit the same
   file. If a feature cannot be split that way, do not split it — give it to one implementer.
4. Every cross-task boundary is a written TypeScript interface that you author yourself and commit
   to the scaffold BEFORE dispatching. Implementers import it; they never negotiate it.
5. Every feature must trace to at least one evidence_ref. If a feature in the spec has no evidence,
   build it anyway (D06 signed it) but flag it in `unjustified_features[]` on your artifact.
6. You may not invent features. If the spec is ambiguous, choose the interpretation that is
   cheapest to build and record it in `assumptions[]`.
7. When you sign the Deployment artifact you assert: the URL responds 200, QA p0 scenarios are
   green, and the repo state on GitHub matches the deployed sha. Do not sign otherwise.

You have a budget. State the projected cost of your plan before dispatching. If your plan exceeds
the envelope, cut scope first, request budget second.
```

### `prompts/D07/implementer.md` — Worker

```
You supervise a headless Claude Code process that implements exactly one task in exactly one git
worktree. You are responsible for that worktree and nothing else.

CONTRACT:
- Your worktree: {{worktree_path}} on branch {{branch}}.
- Files you own: {{files_owned}}. You may READ anything in the repo. You may WRITE only files you
  own. If you believe you must write a file you do not own, STOP and return
  {status:'blocked', reason:'ownership', file:'<path>', why:'<one sentence>'} to the Architect.
  Do not edit it "just this once". Merge conflicts are the most expensive failure in this
  department and this rule is why they do not happen.
- Interfaces in `src/contracts/` are frozen. Import them. Do not modify them.

LOOP:
1. Read the task file. Restate the acceptance criteria as a checklist.
2. Write the test first when a test is cheap (pure logic, API handler). Skip TDD for UI.
3. Implement. Prefer the framework's default way over a clever way.
4. Checkpoint: `pnpm typecheck && pnpm lint && pnpm test -- <your scope>`.
   Green -> commit with the house trailer format -> `git push -u origin {{branch}}`.
   Red -> fix. Three consecutive red checkpoints on the same error => return
   {status:'stuck', last_error, what_you_tried[]}. Do not thrash; thrashing burns the envelope.
5. Push after EVERY green checkpoint, not once at the end. The sandbox can be paused or destroyed
   at any moment; unpushed work is work that did not happen.
6. Done = every acceptance criterion demonstrably true + typecheck/lint/test green + pushed.
   Return {status:'done', branch, sha, criteria_met[], notes_for_integrator[]}.

STYLE: match the scaffold. No new dependencies without stating the reason in the commit body. No
TODO comments — either build it or report it as descoped.
```

### `prompts/D07/integrator.md`

```
You own branch build/{{cycle}}. Your job is that it is always green and always mergeable to main.

PROCEDURE, per implementer branch, in the Architect's integration_order:
1. `git merge --no-ff feat/{{cycle}}/{{feature}}`.
2. If clean: run typecheck + lint + full test suite. Green -> keep. Red -> see step 4.
3. If conflicted: classify the conflict FIRST, then act.
   - LOCKFILE (pnpm-lock.yaml): never hand-merge. `git checkout --ours` then re-run `pnpm install`
     and commit the regenerated lockfile.
   - GENERATED (migrations, schema snapshots, build output): regenerate, never merge.
   - ADDITIVE (both sides appended to a registry/index/route table): take both sides, order
     deterministically (alphabetical by key), verify no duplicate keys.
   - SEMANTIC (both sides changed the same logic): this means the Architect's file-ownership rule
     was violated. Do NOT guess. Take the branch that owns the file per the task graph, park the
     other side's diff in `.zeroth/parked/<feature>.patch`, and report it to the Architect as an
     ownership defect. The Architect re-dispatches a small reconciliation task.
4. On red tests after a clean merge: you get ONE repair attempt via headless Claude Code, scoped to
   the failing files. If still red, revert that merge (`git revert -m 1`), mark the feature
   `integration_failed`, and continue with the remaining branches. A partial product ships; a
   broken build does not.

Report: {merged[], reverted[], parked[], suite_status, sha}.
```

### `prompts/D07/qa.md`

```
You are QA for a product whose founder cannot read a stack trace. Two audiences: the build agents
(who need precision) and the founder (who needs a video and a sentence).

SCENARIO GENERATION — build the matrix from four sources, in this priority:
1. ACCEPTANCE CRITERIA from ProductSpec: every AC becomes exactly one happy-path scenario. Mandatory.
2. CLAIMLEDGER WORKFLOWS: for each real interview claim describing how a person does this task
   TODAY, write a scenario that walks that exact workflow through the product. Name the scenario
   after the claim ("Maria's Sunday-night roster rebuild"). These catch the bugs that matter
   because they are the paths real users described.
3. DESTRUCTIVE PATHS: empty state, one item, 500 items, double-submit, back button mid-flow,
   refresh mid-flow, expired session, mobile 375px viewport.
4. MONEY PATHS (if pricing != free): checkout succeeds, card declines, webhook arrives twice,
   subscription cancels. Always run against Stripe test mode.

EXECUTION: every scenario runs under a Replay recording. Always. Passing recordings are kept too —
they are the regression baseline and the demo footage.

ON FAILURE, emit BOTH:
  for_agent: {scenario_id, replay_url, failing_step, console_errors[], network_failures[],
              suspected_files[], first_divergence_point}
  for_founder: {one_sentence: "Signing up with a Gmail address works, but the confirmation email
               never arrives.", severity, replay_share_url, what_i_recommend}
Never put a stack trace in for_founder. Never put vague prose in for_agent.

Classify each failure: blocking_p0 | degrading | cosmetic | flaky. Re-run anything you call flaky
twice more before labelling it. A flaky test that blocks a deploy is worse than the bug.
```

### `prompts/D07/deployer.md`

```
You put the product on the internet. Order matters and is not negotiable.

1. PRECHECK: build/{{cycle}} is green, QA p0 scenarios all pass, `deploy_to_production` gate is
   open (or autonomy_level == autonomous). If any is false, stop and report. You never deploy red.
2. INFRA via Render API, under the company's own Render account:
   a. Postgres (starter) if the spec needs a DB. Wait for available. Capture internal URL.
   b. Web service from the GitHub repo, branch main, autoDeploy off (you control deploys).
   c. Env vars from the spec's integrations_required, pulled as scoped vault handles. Never
      literal secrets in the service definition.
   d. Trigger deploy at the exact release sha. Poll until live or failed.
3. MIGRATIONS run as a pre-deploy job, never inside the web process boot.
4. HEALTH: probe / and /api/health 5 times over 30s. Any non-2xx or p95 > 3s => ROLLBACK.
5. ROLLBACK = redeploy previous release sha (Render keeps it) + emit build.rolled_back + open an
   Escalation(severity=blocking). Rollback is cheap and always allowed without a gate. Deploying
   is gated; undeploying is not.
6. PARALLEL RAILS (fire these while the app deploys, do not block on them):
   - Lovable: generate the marketing site from ProductSpec.one_liner + NicheDossier positioning +
     GTMPlan pricing. Point it at the app URL. Capture marketing_url.
   - Whop: if venture_kind in {consumer_app, community, content}, create the Whop product,
     price it from ProductSpec.pricing, attach the app URL as the delivered asset, capture
     storefront_url. This is the venture's second distribution rail; D10 will link to it.
   - Stripe: create Products/Prices matching ProductSpec.pricing so D10 can generate payment links
     the moment a deal is ready. (Objects only. Charging money is D11's authority, never yours.)
7. Report the full Deployment artifact. If any parallel rail failed, ship anyway with
   quality:'partial' and the gap listed. The app is the product; the storefront is a channel.
```

### `prompts/D07/critic-rubric.md`

```
You are reviewing a Deployment artifact. You are not friendly. Reject on any of the following, with
the specific defect and the minimal fix:

1. LIVENESS: app_url returns non-2xx, or returns 200 with an error page / empty shell.
2. TRUTH: release_commit_sha is not the sha actually deployed on Render, or is not present on
   GitHub main. A repo that disagrees with production is a P0.
3. COVERAGE: any ProductSpec p0 feature has zero passing QA scenario. Missing tests are missing
   features.
4. HONESTY: a scenario marked pass whose Replay recording shows a console error, a failed network
   request to the app's own origin, or a step that was skipped.
5. FOUNDER-READABILITY: any founder_summary containing a stack trace, a file path, or the word
   "exception". The founder cannot act on that.
6. SECRETS: any secret literal in the repo, in a Render env var set to a plaintext value, or in a
   commit message. Scan the diff.
7. ROLLBACK: no recorded previous_release_sha, i.e. the deploy is not undoable.
8. EVIDENCE: features present in the build that are in neither ProductSpec.features nor
   assumptions[]. The company does not build things nobody asked for.

Output: {verdict: 'accept'|'revise', defects:[{code, where, why, minimal_fix}]}. Max one revision.
```

---

## 7. Tech-stack decision matrix

The Architect does not deliberate. It looks this up and records the row it used.

| Condition on `ProductSpec` | Stack | Why |
|---|---|---|
| `venture_kind=b2b_saas` or `tool`, `auth != none` | Next.js 15 App Router · TS · Tailwind · shadcn/ui · Drizzle · Postgres (Render) · Auth.js magic-link · Stripe Checkout | One repo, one deploy target, Claude Code writes it fluently |
| `venture_kind=consumer_app`, no DB writes beyond session | Next.js 15 · Tailwind · Vercel-style static + route handlers · localStorage first | Fastest to green |
| `venture_kind=community` or `content` | Next.js static + MDX + **Whop** for access control/billing | Don't build auth+billing you can rent |
| `venture_kind=marketplace` | Next.js · Postgres · Stripe Connect (test mode) · Drizzle | Two-sided needs a real DB |
| `integrations_required` includes a no-API vendor | add a `services/robot` worker calling **Solari** | The hands, per platform spec |
| Heavy compute / simulation in spec | separate Render worker; Rust only if already in the org's toolchain | Don't introduce a language mid-hackathon |
| `geography=intl` and pricing != free | **Dodo Payments** as merchant of record instead of direct Stripe | Zeroth's own entity can't invoice everywhere; D11 picks the rail |
| Spec needs realtime | Postgres LISTEN/NOTIFY + SSE. **Not** websockets, **not** a broker | One fewer service to deploy |

**Hard bans** (recorded so an implementer can't relitigate): no microservices, no GraphQL, no
Kubernetes, no custom auth, no ORM other than Drizzle, no CSS framework other than Tailwind, no
state library beyond React state + server components, no new language.

---

## 8. Task decomposition strategy

```
ProductSpec.features (p0 only, cycle 1)
        │
        ├─ 1. GROUP by data boundary: features touching the same table/entity go together.
        ├─ 2. EXTRACT the shared spine: schema, contracts/, layout, auth. The Architect writes this
        │     itself and commits it to build/<n> BEFORE any implementer starts. This is the single
        │     most important step — it removes 90% of potential conflicts.
        ├─ 3. SLICE into vertical tasks: each task = schema slice + API route + UI page + test,
        │     all in files no other task touches.
        ├─ 4. SIZE: target 3–6 acceptance criteria per task. Split anything larger; merge anything
        │     smaller than 2 into a sibling.
        └─ 5. ASSIGN replicas = clamp(ceil(tasks/2), 2, 4), reduced to 2 if budget used > 50%.
```

Worked example — `ProductSpec v2` for *ShiftSwap* (nurse shift-swapping, 6 p0 features):

| Task | Features | Owned files | Depends on | Worktree |
|---|---|---|---|---|
| T0 spine (Architect) | — | `src/db/schema.ts`, `src/contracts/*`, `src/app/layout.tsx`, `src/lib/auth.ts` | — | main worktree |
| T1 | F-01 signup, F-02 org join | `src/app/(auth)/**`, `src/app/api/org/**` | T0 | impl-1 |
| T2 | F-03 post a shift, F-04 browse shifts | `src/app/shifts/**`, `src/app/api/shifts/**` | T0 | impl-2 |
| T3 | F-05 request swap + approval | `src/app/swaps/**`, `src/app/api/swaps/**` | T0, contracts only | impl-3 |
| T4 | F-06 notifications + email | `src/lib/notify/**`, `src/app/api/webhooks/**` | T0 | impl-4 |

Note T2 and T3 both *use* the shifts table — but only T2 owns the schema file, and T3 imports the
frozen contract. That is the rule that makes four parallel Claude Codes safe.

---

## 9. Execution flow

```
 ArtifactReady(ProductSpec v2)
        │
        ▼
┌────────────────────┐
│ build.architect    │  read spec + dossier + claims
│  (opus)            │  ├─ pick stack from matrix        → stack_decision
└─────────┬──────────┘  ├─ decompose into T1..Tn         → task_graph
          │             ├─ project cost, cut to fit envelope
          │             └─ scaffold T0 spine, push build/<n>
          │
          ├──── lease sandbox (Superserve, 8cpu/16GB) ─── git clone → 4 worktrees
          │
  ┌───────┼───────┬───────────┬───────────┐        PARALLEL
  ▼       ▼       ▼           ▼           ▼
impl-1  impl-2  impl-3     impl-4    ┌─ deployer (early lane) ─┐
  │       │       │           │      │ create GitHub repo      │
  │  headless claude -p per task     │ create Render PG        │
  │  checkpoint→commit→push (loop)   │ Lovable site kickoff    │
  └───────┴───────┴───────────┘      └─────────────────────────┘
          │  all branches pushed
          ▼
┌────────────────────┐
│ build.integrator   │  merge in order → classify conflicts → suite green
└─────────┬──────────┘  reverted[] / parked[] reported up
          │  build/<n> green at sha S
          ▼
┌────────────────────┐   scenarios from AC + ClaimLedger + destructive + money
│ build.qa ×2        │   each run wrapped in a REPLAY recording
└─────────┬──────────┘   ├─ pass → baseline recording kept
          │              └─ fail → for_agent + for_founder + share link
          │
     p0 all green? ──no──► Architect re-dispatches repair task (≤2) ──► back to integrator
          │ yes                                    │ still red
          ▼                                        └──► descope feature, mark partial
   ┌──────────────┐
   │ GATE         │  deploy_to_production  → Linq card to founder
   │ (auto at     │  "ShiftSwap is ready. 14/14 checks green. Deploy? [Deploy][Watch QA][Hold]"
   │  autonomous) │
   └──────┬───────┘
          ▼
┌────────────────────┐  merge build/<n> → main, tag v0.1.<n>
│ build.deployer     │  Render: PG → web service → migrate → deploy@sha → health probe
└─────────┬──────────┘  Whop listing (if consumer) · Stripe products · Lovable site live
          │  health green
          ▼
┌────────────────────┐
│ build.critic       │  8-point rubric → accept | revise(defects)
└─────────┬──────────┘
          ▼
   Deployment signed → ArtifactReady → routing: D09 build_lead_lists, D08 finalize GTM
                                       build.deployed event → Boardroom URL card
```

---

## 10. Integrations

| Sponsor / tool | Where used | Call |
|---|---|---|
| **Anthropic Claude Agent SDK / Claude Code** | Implementers + Integrator repair, headless in-sandbox | `claude -p --output-format stream-json --permission-mode acceptEdits` |
| **Superserve** | The build sandbox: 8 CPU, 16 GB, pausable so `node_modules` and worktrees survive; forkable so D13 can shadow-build | `sandbox.lease/pause/resume/fork` |
| **Composio (GitHub)** | Org + repo creation, branch protection, PAT scoping, ownership transfer | `github.create_org`, `github.create_repo`, `github.update_branch_protection` |
| **Replay** | Every QA scenario recorded; failures become time-travel sessions; passing runs are the regression baseline; share links go to the founder | `replay.record(session)`, `replay.share(recording_id)` |
| **Render** | The venture's own web service, Postgres, worker; deploys pinned to a sha; rollback = redeploy previous sha | `POST /v1/services`, `POST /v1/services/:id/deploys` |
| **Lovable** | Marketing site generated in parallel from spec + positioning | `lovable.create_project(brief)` → `marketing_url` |
| **Whop** | Storefront listing for consumer/community ventures — second revenue + distribution rail | `POST /v5/products`, `POST /v5/plans` |
| **Stripe** | Product/Price objects only, so D10 can mint payment links instantly | `stripe.products.create`, `stripe.prices.create` |
| **Solari** | Only if the venture must integrate a vendor with no API — a `services/robot` worker | `solari.session.run(script)` |
| **Linq** | Deploy gate card, and the QA failure card with the Replay share link | `linq.send_card` |

---

## 11. Gates & escalations

| Gate id | Fires when | Card | Auto at `autonomous`? |
|---|---|---|---|
| `deploy_to_production` | Before first public deploy of a cycle | QA summary + green count + Deploy/Watch/Hold | yes |
| `repo_public` | Before flipping repo visibility | "Make the code public?" | **never** |
| `spend_infra` | Before any paid Render plan | Monthly cost + Approve/Downgrade | no |
| `destructive_migration` | Any migration that drops a column/table on a DB with rows | Diff + row counts | **never** |

| Escalation | Reason | Trigger | Goes to |
|---|---|---|---|
| Budget exhausted mid-build | `needs_budget` | envelope 100% with p0 incomplete | D11 Treasury |
| GitHub/Render needs 2FA or a payment method | `needs_credential` | AccountCeremony blocked | Identity → founder via Linq |
| Spec is unbuildable as written (contradictory ACs) | `needs_human` | Architect can't produce a plan | D06 first, founder second |
| Feature requires a licensed/no-API integration nothing can automate | `needs_capability` | e.g. must fax a form, must notarize | D11/HR → **Terac** requisition |
| 3 consecutive red integrations on the same feature | `needs_human` | Integrator | Founder, with the Replay link |

---

## 12. Failure modes & fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| Implementer stuck (3 red checkpoints) | worker returns `stuck` | Architect re-scopes the task smaller, or reassigns to a sibling worktree with the partial diff attached; second failure ⇒ descope the feature to p1 and ship without it |
| Semantic merge conflict | Integrator classifies SEMANTIC | Park the diff, honor file ownership, Architect issues a reconciliation task. Never auto-guess |
| Sandbox destroyed mid-build | orchestrator heartbeat | Re-lease, `git fetch --all`, reconcile against `state.json`; only unpushed work is lost (≤1 task) |
| Superserve unavailable | lease timeout | Local Docker driver with the same `lease/pause/resume/fork` interface ([`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md)); loses fork-speed, not correctness |
| Replay unavailable | `replay.record` errors | Fall back to Playwright trace + video; artifact marked `quality:'partial'`, founder gets the video instead of a time-travel link |
| Render API down / quota | deploy 4xx-5xx | Retry ×3 → deploy to a preview URL on the fallback provider → if still down, ship the repo + a `docker run` one-liner and escalate `needs_human` |
| Lovable or Whop fails | rail returns error | Non-blocking. `Deployment.quality='partial'`, `gaps:['marketing_site']`. The app is the product |
| Deployed app healthy then degrades | health probe / D12 signal | Auto-rollback to previous sha within one cycle, `build.rolled_back` event, Linq notice |
| QA flaky test blocks deploy | 3-run classification | Marked `flaky`, excluded from the gate, filed as a p2 bug. Flakiness never blocks the demo |
| Model writes secrets into the repo | Critic rule 6 + pre-push secret scan | Push rejected, commit amended, `agent.tool_failed` event, secret rotated in the vault |

---

## 13. Definition of Done

A `Deployment` may be signed only when **all** are true:

1. `app_url` returns 2xx on 5 consecutive probes over 30s, p95 < 3s.
2. Every `p0` feature has ≥1 QA scenario and all of them pass.
3. Every scenario has a Replay recording URL (pass or fail), and every failure has a founder-readable
   one-sentence summary with a share link.
4. `release_commit_sha` exists on GitHub `main`, is tagged, and matches the sha live on Render.
5. `previous_release_sha` is recorded — the deploy is undoable.
6. No secret literals anywhere in the repo, commits, or env values.
7. Every built feature traces to `ProductSpec.features[]` or is listed in `assumptions[]`.
8. Cost report attached; envelope not exceeded (or an approved overage exists).
9. If `venture_kind ∈ {consumer_app, community, content}`: Whop listing live **or** an explicit gap.
10. Critic verdict `accept`, or `revise` exhausted once and artifact marked `contested`.

**Critic rubric:** the 8 checks in `prompts/D07/critic-rubric.md` §6. Any single hit ⇒ `revise`.

---

## 14. Demo notes

D07 owns **2:25 → 2:55** ([`../00-vision/04-demo-and-judging.md`](../00-vision/04-demo-and-judging.md)).

| t | On screen | Line |
|---|---|---|
| 2:25 | Build room lights up; 4 implementer sprites walk in, each carrying a worktree label. Live commit stream on the right, real `feat/7/F-03` branch names. | "Four Claude Code sessions, four git worktrees, one repo — in a Firecracker sandbox." |
| 2:33 | Cut to GitHub in a browser tab: an org named `zeroth-vn-4f2a` the company created for itself, commits authored minutes ago with evidence trailers citing a claim id. | "This org didn't exist an hour ago. The company made it." |
| 2:40 | QA room: scenario named **"Maria's Sunday-night roster rebuild"** goes red. A Replay recording opens and scrubs backwards to the first divergence. Founder's phone shows a card: *"Signup works but the confirmation email never arrives. [Watch it] [Let it fix]"* | "QA failures come back as time travel, and the founder gets a video, not a stack trace." |
| 2:48 | Fix commit lands, integrator merges, deploy gate auto-approves at `autonomous`, Render deploy bar fills. | |
| 2:52 | The real URL opens in a new tab. Product works. Marketing site (Lovable) opens beside it. | "That was live." |

Pre-warm: sandbox leased and `pnpm install` complete before the demo starts. Fallback: `?replay=demo-1`
replays the exact build with cached tool responses.

---

## 15. Cost estimate — one build cycle

| Line | Model / unit | Volume | USD |
|---|---|---|---|
| Architect plan + scaffold | opus in ~35k / out ~9k | 1 run | 1.20 |
| Implementers (headless Claude Code) | sonnet in ~180k / out ~45k each | ×4 | 6.60 |
| Integrator (incl. 1 repair) | sonnet in ~90k / out ~15k | 1 | 0.75 |
| QA scenario gen + runs | sonnet ×2, ~70k in / 12k out each | 2 | 0.90 |
| Deployer | sonnet ~35k in / 8k out | 1 | 0.24 |
| Critic | sonnet ~30k in / 3k out | 1 | 0.14 |
| Superserve sandbox | 8 vCPU / 16 GB | ~14 min active | 0.35 |
| Replay recordings | per session | 14 | 0.00 (sponsor tier) |
| Render services | starter web + PG | prorated demo hour | 0.05 |
| Lovable site | 1 project | 1 | 0.00 (sponsor tier) |
| **Total** | | | **≈ $10.23** (envelope $12.00, hard cap $20.00) |

Degraded mode (>80% envelope): implementers drop to 2 replicas, p1/p2 descoped, QA limited to
p0 + money paths ⇒ ≈ $6.10.

---

**Cross-links:** [`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md) ·
[`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md) ·
[`D06-pivot-decision.md`](D06-pivot-decision.md) · [`D08-strategy.md`](D08-strategy.md) ·
[`D12-support.md`](D12-support.md) · [`D13-chief-of-staff.md`](D13-chief-of-staff.md) ·
[`../03-integrations/05-superserve.md`](../03-integrations/05-superserve.md) ·
[`../03-integrations/07-replay.md`](../03-integrations/07-replay.md) ·
[`../03-integrations/08-render.md`](../03-integrations/08-render.md)
