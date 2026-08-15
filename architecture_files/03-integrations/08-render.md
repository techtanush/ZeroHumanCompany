# 08 — Render

> **Tier 1.** The company's own infrastructure account. Zeroth runs here, and D07 provisions
> production for the products the company invents — under the same account, on the same bill.

---

## What it is

Render is a cloud application platform: web services, background workers, cron jobs, **managed
Postgres**, Redis-compatible key-value stores, static sites, and preview environments, driven by a
dashboard, `render.yaml` blueprints, deploy hooks, and a **public REST API**
(`https://api.render.com/v1`) that can create and manage services programmatically. Auth is a
bearer API key. Deploys trigger from git pushes, deploy hooks (webhook URLs), or API calls.

Render's API/blueprint/deploy-hook surface is public and stable; specifics we lean on are marked
where we could not verify against docs during authoring.

---

## The exact product problem it solves

Two distinct problems, one account:

1. **Zeroth itself needs a home.** The kernel, Boardroom, orchestrator, and simpop must run
   somewhere reliable with managed Postgres, reachable webhooks (Stripe, Linq, Terac, Composio all
   deliver to `kernel.zeroth.app`), and zero laptop-tunnel fragility on stage.
2. **Every venture the company creates needs its own production infrastructure.** An autonomous
   company that can build an MVP but needs a human to host it is not autonomous. D07 must be able to
   say "this venture now exists at a URL" — services, database, env vars, deploys — via API, with
   costs metered back to the venture's budget.

The angle that wins: **the same Render account hosts the company and the company's children.** The
infra bill is one more line in the P&L the Treasury reads.

---

## Which departments use it

| Dept | Usage |
|---|---|
| **D07 Build** | Owner of venture infra: creates services, databases, env groups; wires deploy hooks; promotes previews to production. |
| **D13 Chief of Staff** | Deploys new department runtimes (the D14 manifest at 3:30 runs as an orchestrator workload, not a new Render service — but D13 owns the option). |
| **D11 Finance** | Reads service-level cost data into the ledger (`opex:infra`); enforces the infra envelope. |
| **Platform (not a department)** | Zeroth's own four apps + Postgres + Redis run here permanently. |

---

## Technical integration

### Auth and account model

- **One Render account** (workspace) holds everything. `RENDER_API_KEY` lives in the Identity
  Vault; only the kernel's `packages/integrations/render` client dereferences it.
- Departments never call Render directly — D07 files infra intents; the kernel executes them.
  This is the same "the org chart is enforced by who holds the keys" pattern as Stripe-via-D11.
- **Naming convention is load-bearing:** every venture resource is prefixed
  `v-{venture_slug}-` (`v-handoff-web`, `v-handoff-db`). Cost attribution and teardown both key on it.

### Zeroth's own topology (**MVP**, provisioned before the hackathon)

```yaml
# render.yaml (Blueprint) — the platform itself
services:
  - type: web
    name: zeroth-kernel          # Fastify: event store API, gate engine, ALL webhook endpoints
    env: node
    plan: standard
    healthCheckPath: /healthz
  - type: web
    name: zeroth-boardroom       # Next.js 15, SSE from the kernel
    env: node
  - type: worker
    name: zeroth-orchestrator    # sandbox leases, Head scheduling, BullMQ consumers
    env: node
  - type: web
    name: zeroth-simpop          # Rust + axum + SQLite (simit port), internal-only
    env: rust
databases:
  - name: zeroth-pg              # Postgres 16 + pgvector: events, artifacts, ledger, meters
    plan: standard
# Redis-compatible KV for BullMQ, attached via env group
```

Webhook stability is the quiet win: `kernel.zeroth.app` is a real HTTPS endpoint with a real cert,
so Stripe/Linq/Terac/Composio webhook registration is done once, days before the demo — no tunnels,
no ngrok, nothing to fail on stage ([`03-stripe.md`](03-stripe.md) makes the same point).

### Venture provisioning by D07 (**MVP** — the 2:25 path)

```ts
// packages/integrations/render/provision.ts — executed by the kernel on D07's intent
export async function provisionVenture(v: Venture, repo: RepoRef): Promise<VentureInfra> {
  // 1. Managed Postgres for the venture (isolated DB, not a schema in zeroth-pg)
  const db = await render.post('/v1/postgres', {
    name: `v-${v.slug}-db`, plan: 'basic-256mb', region: 'oregon',
  }, idem(v.id, 'render.db'));

  // 2. Web service from the venture's GitHub repo (created by Solari at 2:25 — 04-solari.md)
  const web = await render.post('/v1/services', {
    type: 'web_service',
    name: `v-${v.slug}-web`,
    repo: repo.url, branch: 'main', autoDeploy: 'yes',
    serviceDetails: { env: 'node', plan: 'starter',
      envSpecificDetails: { buildCommand: 'npm ci && npm run build', startCommand: 'npm start' } },
  }, idem(v.id, 'render.web'));

  // 3. Env vars — values injected from the vault, never through an agent context
  await render.put(`/v1/services/${web.id}/env-vars`, [
    { key: 'DATABASE_URL', value: vault.deref(db.connection_handle) },
    { key: 'STRIPE_SECRET_KEY', value: vault.deref(v.stripe_test_handle) },
  ]);

  return { db_id: db.id, service_id: web.id, url: web.serviceDetails.url };
}
```

> **VERIFY AT HACKATHON (Render booth):**
> 1. Exact API payload shapes for service + Postgres creation on current API version (the fields
>    above are close but (unverified — confirm at hackathon) in detail).
> 2. **Preview environments**: are per-PR previews available on our plan via API, and what is their
>    URL shape? If not: two services per venture, `v-x-staging` + `v-x-web`, same contract.
> 3. Free/starter instance behavior (cold starts on stage), account service quotas, and whether the
>    hackathon provides credits.
> 4. Cost/usage endpoint granularity for per-service spend (the D11 meter wants daily numbers).

### Deploy pipeline: hooks, QA, and the promotion gate

```
Claude Code pushes to venture repo (main or PR branch)
   │  autoDeploy → Render builds → PREVIEW/STAGING deploy
   ▼
Render deploy webhook → kernel:/webhooks/render
   │  {service_id, deploy_id, status: 'live', url}
   ├─ status=build_failed → WorkOrder(fix_build) back to the build session
   │    (build logs fetched via API, excerpted into the prompt)
   ├─ status=live (preview) → emit deploy.preview_live → QaRun (07-replay.md)
   ▼
QA passed, no regressions
   │
   ├─ GATE: production promotion.  kind='production_deploy'  ← invariant #2:
   │    a public URL under the venture's brand is an irreversible public action.
   │    Linq card (06-linq.md): "MVP passed QA (7/7 flows). Screenshot + preview
   │    link attached. Ship to production? yes/no"   timeout 10 min,
   │    on_timeout: hold (copilot/supervised) | auto_approve (autonomous — and the
   │    digest reports it, because autonomy means the dial says so, not silence)
   ▼
approved → promote (merge to main / trigger prod deploy via API)
        → deploy.production_live {url} → D08 gets its GTM go signal
        → the Boardroom opens the URL on stage. That's the 2:25 payoff.
```

First deploys are **previews by default in every autonomy mode** — the gate sits at promotion, not
at build. The company iterates freely in private and asks once, at the moment that matters.

### Cost metering into the P&L

`finance.reconcile` pulls service-level usage daily (or the best available granularity — see verify
block), writes `ledger_entries {account: 'opex:infra', source: 'render', source_ref: service_id,
department_id: 'D07'}`, attributed per venture by the naming convention. Infra spend then competes
inside D07's envelope like any other cost: **a venture whose infra costs exceed its revenue shows up
red in the Boardroom, and Treasury sees it** ([`03-stripe.md`](03-stripe.md)). Venture teardown
(founder-gated, `kind='data_deletion'`) suspends services first, deletes after 7 days.

---

## User-facing experience

The founder never sees Render. They see: a preview link and screenshot on the promotion card in
iMessage, then a live URL with their product's name on it, then (in the daily digest) one line —
*"hosting: $0.43 this week, within budget."* Infrastructure that surfaces only as a URL, a gate,
and a cost line is infrastructure working exactly as intended.

---

## Why the use case is novel

Most teams will deploy *their hackathon project* on Render. Ours deploys **itself and its
offspring**: the platform runs on Render, and the companies the platform invents get provisioned by
API into the same account, with their own databases, their own deploy pipelines, their own QA-gated
promotion flow, and their own cost lines feeding the Treasury that decides whether they deserve more
budget. The account is not a deployment target; it is **the company's infrastructure department**,
and the `v-*` prefix is its filing system.

---

## Sponsor-track criteria

| Criterion | Our answer |
|---|---|
| Real product hosted on Render | Four platform services + managed Postgres, running for days before the demo |
| API depth | Programmatic service + database creation, env management, deploy hooks, promotion via API — not just a git push |
| Load-bearing on stage | The 2:25 URL that opens live *is* a Render service the company created minutes earlier |
| The sentence | "The company has an infra account and provisions production for the products it invents." |

---

## Risks, costs, permissions, rate limits

| Item | Detail |
|---|---|
| Cost | Platform: ~$25–40/mo (standard web + worker + Postgres). Per venture: ~$14/mo equivalent (starter web + basic Postgres), pro-rated pennies for demo lifetime. Hackathon credits (unverified — confirm at hackathon). |
| Cold starts | Free-tier services sleep; anything on the demo path runs on paid instances. Non-negotiable for stage latency. |
| Permissions | One API key = full account. Mitigations: only the kernel holds it; every mutating call is an event first; the `v-` prefix convention is enforced in the client (the kernel physically cannot delete `zeroth-*` resources through the venture-provisioning path). |
| Quotas | Service-count limits per account (unverified — confirm at hackathon). Demo needs ~4 platform + ~2 venture services. |
| Rate limits | API limits are far above our provisioning cadence (a burst of ~5 calls per venture). Backoff on 429 regardless. |
| Blast radius | The platform and ventures share an account: a leaked key is total. Vault posture + key rotation runbook; POST-MVP: separate workspace per venture via API if Render supports programmatic workspace creation (unverified — confirm at hackathon). |

---

## Fallback behavior when it is down

| Failure | Behavior |
|---|---|
| Render API down (provisioning) | Venture deploys to a **pre-provisioned warm spare service** (`v-spare-web`, created at setup): point it at the venture repo, rename later. One spare covers the demo. |
| Render API down (platform) | The platform is already running — an API outage doesn't stop serving. Deploy hooks stalling → the kernel polls deploy status (unverified endpoint — confirm at hackathon) every 15s, same poller-over-webhook posture as Terac. |
| Total Render outage on stage | Worst case per the master table: the venture runs on the demo box behind a tunnel, and the Boardroom `infra: degraded` chip shows. The build/QA/gate story is unchanged — only the hosting substrate moved. |
| Build fails repeatedly | 3 fix cycles ([`07-replay.md`](07-replay.md) loop), then founder escalation. A build outage fails closed: no promotion without a green deploy + green QA. |

---

## Contribution to the general prize

Judges will ask every team "but where does it run?" Our answer closes the loop that most autonomous-
company demos leave open: the company **owns its infrastructure account**, provisions production for
its own products by API, gates its own promotions on its own QA, and pays for hosting out of the
same P&L its revenue lands in. Infrastructure is the last thing teams mock and the first thing that
makes autonomy real — and it is also why every webhook in the rest of this folder actually works on
stage.

---

## Assumptions & open questions

- (unverified — confirm at hackathon) Current API payload shapes; preview-environment availability
  by plan; cost-endpoint granularity; service quotas; hackathon credits; programmatic workspace
  creation; deploy-status poll endpoint.
- Open: custom domain per venture at MVP (`.onrender.com` URL is honest and fine) or POST-MVP.
- Open: whether D13's new departments ever warrant their own Render services vs staying orchestrator
  workloads. Default: orchestrator; the option is one API call away.

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`07-replay.md`](07-replay.md) (QA between deploy and promotion) ·
[`06-linq.md`](06-linq.md) (the promotion gate card) ·
[`04-solari.md`](04-solari.md) (the GitHub org the repo lives in) ·
[`03-stripe.md`](03-stripe.md) (webhook endpoints, infra cost in the ledger)
