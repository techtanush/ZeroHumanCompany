# 09 — Deployment Architecture

Environments (local/staging/prod), the Render service topology, Postgres/Redis/object storage,
secret injection, scaling, the sandbox fleet, network egress policy, cost per environment, and a
runbook per service — for the ZEROTH platform itself. Venture-product deploys are D07's job
([`../02-departments/D07-build.md`](../02-departments/D07-build.md) §6, deployer) and reuse this
file's Render account, egress policy, and cost model.

> **The deployment thesis:** one blueprint file (`infra/render.yaml`), three instantiations
> (local compose, staging, prod). Anything that cannot be expressed in the blueprint or
> docker-compose does not get deployed. Hand-configured infrastructure is unreproducible
> infrastructure, and unreproducible is the one thing an autonomous company can never be.

Read alongside [`06-repo-layout.md`](06-repo-layout.md) §7 (`.env.example` — every key named
there is injected per §5 here), [`08-cicd-and-testing.md`](08-cicd-and-testing.md) (what gates a
deploy), and [`../01-platform/01-system-architecture.md`](../01-platform/01-system-architecture.md)
(the logical components these services realize).

---

## 1. Environments

| | `local` | `staging` **POST-MVP (Week 1)** | `prod` (= `demo` at the hackathon) |
|---|---|---|---|
| Purpose | All development, all four lanes | Integration on real infra, previews | The demo; later, the real thing |
| Runs on | docker compose + `pnpm dev` | Render (suffix `-stg`) | Render |
| `ZEROTH_ENV` | `local` | `staging` | `prod` |
| `ZEROTH_TOOLS` | `mock` | `mock` default, per-tool `real` for integration spikes | `real` with per-tool overrides ([`02-speed-playbook.md`](02-speed-playbook.md) §5.3) |
| Data | Throwaway; `pnpm db:reset` at will | Fixtures only, wiped weekly | The event store is the company — backed up, never wiped |
| LLM keys | Personal dev keys | Team key, low rate limit | Team key, full limit |
| Who deploys | Nobody (it's local) | CI on merge to `main` | Manual `pnpm deploy:prod` at MVP; tag-driven from Week 1 ([`08-cicd-and-testing.md`](08-cicd-and-testing.md) §7.2) |

**The hackathon collapse:** during the event, `prod` *is* the demo environment. Staging does not
exist yet — the M7 rehearsals are the staging process, and the offline replay kit
([`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §4) is the availability story.

---

## 2. Render service topology **MVP**

Six deployed services plus data stores, exactly the set named in
[`06-repo-layout.md`](06-repo-layout.md) §2.

```
                        ┌─────────────────────────────┐
     founder ──────────►│ boardroom      (web, Node)   │ Next.js 15 · :3000
                        └───────────┬─────────────────┘
                                    │ SSE + REST (KERNEL_SHARED_TOKEN)
                        ┌───────────▼─────────────────┐
   webhooks ───────────►│ kernel         (web, Node)   │ Fastify · :4000
   stripe·linq·terac…   └───┬───────┬───────┬─────────┘
                            │       │       │
                 ┌──────────▼─┐ ┌───▼────┐ ┌▼──────────────┐
                 │ postgres 16 │ │ redis 7│ │ object storage │
                 │ +pgvector   │ │ BullMQ │ │ S3-compatible  │
                 └──────────▲─┘ └───▲────┘ └▲──────────────┘
                            │       │       │ artifacts, recordings, PUMS
                 ┌──────────┴───────┴─┐     │
                 │ orchestrator ×2     │─────┘
                 │ (worker, Node)      │──────► sandbox fleet (§6)
                 └──────────┬─────────┘
                            │ HTTP
              ┌─────────────┼──────────────────┐
        ┌─────▼─────┐ ┌─────▼─────┐ ┌──────────▼───┐
        │ simpop     │ │ voice     │ │ gateway-linq │
        │ (Rust web) │ │ (worker)  │ │ (web)        │
        └───────────┘ └───────────┘ └──────────────┘
```

```yaml
# infra/render.yaml — the blueprint (prod values; staging = same file, -stg suffix, cheaper plans)
databases:
  - name: zeroth-pg
    plan: basic-1gb            # prod; staging: free
    postgresMajorVersion: "16"

services:
  - type: redis
    name: zeroth-redis
    plan: starter
    maxmemoryPolicy: noeviction        # queues must never silently drop jobs

  - type: web
    name: zeroth-kernel
    runtime: node
    plan: standard                     # always-on; SSE needs no cold starts
    buildCommand: pnpm install --frozen-lockfile && pnpm turbo run build --filter=kernel
    startCommand: node apps/kernel/dist/server.js
    healthCheckPath: /health
    autoDeploy: false                  # deploys are decisions, not side effects
    envVars:
      - fromGroup: zeroth-core
      - key: DATABASE_URL
        fromDatabase: { name: zeroth-pg, property: connectionString }
      - key: REDIS_URL
        fromService: { name: zeroth-redis, type: redis, property: connectionString }

  - type: web
    name: zeroth-boardroom
    runtime: node
    plan: starter
    buildCommand: pnpm install --frozen-lockfile && pnpm turbo run build --filter=boardroom
    startCommand: node apps/boardroom/.next/standalone/server.js
    healthCheckPath: /
    autoDeploy: false
    envVars: [{ fromGroup: zeroth-core }]

  - type: worker
    name: zeroth-orchestrator
    runtime: node
    plan: standard
    numInstances: 2                    # §7 scaling
    buildCommand: pnpm install --frozen-lockfile && pnpm turbo run build --filter=orchestrator
    startCommand: node apps/orchestrator/dist/worker.js
    envVars:
      - fromGroup: zeroth-core
      - fromGroup: zeroth-vendors      # only the orchestrator sees vendor keys — §5

  - type: web
    name: zeroth-simpop
    runtime: docker
    dockerfilePath: infra/Dockerfile.simpop
    plan: starter
    healthCheckPath: /health
    envVars: [{ key: SIMPOP_SEED, value: "42" }, { key: SIMPOP_ARCHETYPES, value: "12" }]
    disk: { name: simpop-cache, mountPath: /data, sizeGB: 5 }   # SQLite poll cache + PUMS

  - type: worker
    name: zeroth-voice
    runtime: node
    plan: starter
    envVars: [{ fromGroup: zeroth-core }, { fromGroup: zeroth-vendors }]

  - type: web
    name: zeroth-gateway-linq
    runtime: node
    plan: starter
    healthCheckPath: /health
    envVars: [{ fromGroup: zeroth-core }, { fromGroup: zeroth-vendors }]
```

| Store | Provider | Notes |
|---|---|---|
| Postgres 16 + pgvector | Render managed | The event store lives here. PITR on (§8) |
| Redis 7 | Render managed | BullMQ only. `noeviction` — a dropped WorkOrder is a lost limb |
| Object storage | MinIO in compose locally; Supabase Storage (or any S3 endpoint) in demo/prod | Artifacts bodies >256 KB, call audio, Replay exports, PUMS extract. Keyed `s3://zeroth-artifacts/<venture_id>/…` |

Venture products deploy into the **same Render account** as separate services created by
`build.deployer` via the API, tagged `venture:<venture_id>` for cost attribution (§9) — never
into the ZEROTH blueprint.

---

## 3. Local environment **MVP**

```bash
pnpm up          # docker compose: postgres+pgvector, redis, minio
pnpm db:migrate
pnpm dev         # turbo --parallel: kernel :4000, boardroom :3000, orchestrator, simpop :8080
```

One command each, per the compounding-wins rule ([`02-speed-playbook.md`](02-speed-playbook.md)
§5.7). Four lanes run four copies on port offsets (`PORT_OFFSET=10` → 3010/4010…), sharing the
one compose stack — projections are `venture_id`-scoped so lanes do not collide in data either.

---

## 4. What runs where — component-to-service map

| Logical component ([`../01-platform/01-system-architecture.md`](../01-platform/01-system-architecture.md)) | Service | Why there |
|---|---|---|
| Event store, artifact registry, gate engine, routing, meter, vault | `zeroth-kernel` | One writer of `events`; co-located reducers |
| SSE fan-out to the Boardroom | `zeroth-kernel` | LISTEN/NOTIFY origin, no extra hop |
| Head/worker agent execution | `zeroth-orchestrator` | Long-running LLM calls do not belong in a web process |
| Sandbox leasing | `zeroth-orchestrator` → fleet (§6) | |
| Synthetic population | `zeroth-simpop` | Rust, own disk cache, deterministic |
| Telephony + transcription | `zeroth-voice` | Streaming audio, vendor SDKs, isolated blast radius |
| Linq cards in/out | `zeroth-gateway-linq` | Public webhook surface, kept away from the kernel |
| Boardroom UI | `zeroth-boardroom` | |
| Cron beats (`cos.daily` etc., scaled by `ZEROTH_TIME_SCALE`) | `zeroth-kernel` scheduler | One clock, evented ticks |

---

## 5. Secret injection **MVP**

The rule from [`07-source-control-and-github.md`](07-source-control-and-github.md) §7 extended to
infra: **raw secrets exist in exactly two places** — the local gitignored `.env`, and Render env
groups. Everything else receives scoped handles.

| Env group | Contains | Mounted into |
|---|---|---|
| `zeroth-core` | `ZEROTH_*`, `KERNEL_SHARED_TOKEN`, `ANTHROPIC_API_KEY`, S3 creds | all services |
| `zeroth-vendors` | Every key in `.env.example` §7's sponsor/tool sections | orchestrator, voice, gateway-linq **only** |

Rules:

1. The Boardroom never holds vendor keys — it talks only to the kernel.
2. Sandboxes get **per-lease, per-tool handles** resolved by the vault at spawn
   (`vault handle build.implementer.anthropic`, per
   [`../02-departments/D07-build.md`](../02-departments/D07-build.md) §5), injected as env into
   the sandbox process, never written to its disk.
3. Venture services get their env set by `build.deployer` **as vault handle resolutions at
   deploy time** — the Render service definition holds values, but the deployer never logs them
   and the critic scans for literals (rubric #6).
4. Rotation: `KERNEL_SHARED_TOKEN` and venture PATs rotate weekly by script; vendor keys rotate
   on vendor schedule; any suspected leak → rotate first, investigate second.
5. CI gets exactly: `TURBO_TOKEN`, `REPLAY_API_KEY`, and a read-only DB URL for integration
   tests. CI never sees `zeroth-vendors`.

---

## 6. The sandbox fleet **MVP local / POST-MVP fleet**

Where agent code execution happens — D07 builds, D13 shadow forks, any `shell.*` tool.

| Driver | When | Properties |
|---|---|---|
| `local` (Docker) | All of dev; demo fallback | `zeroth/dept-build` image, cpu/mem caps from the manifest's `sandbox:` block |
| `superserve` (Firecracker) | Demo if the key round-trips ([`05-mvp-scope.md`](05-mvp-scope.md) §2.4); prod later | pause/resume between cycles (~free, seconds), **fork** for D13 shadow mode, FS+memory snapshots |

```
orchestrator ──lease(dept_manifest.sandbox)──► fleet
   │  pool: SUPERSERVE_POOL_SIZE=4 warm sandboxes (prod)
   │  local dev: docker run --rm, no pool
   ├─ exec(task) ── stream stdout → meter + agent.tool_used events
   ├─ pause on cycle end · resume on next WorkOrder
   └─ destroy on venture close; GitHub is the durable state (07-source-control §8)
```

Fleet sizing: one D07 build cycle needs 1 sandbox (worktrees share it). Pool of 4 covers: one
live build, one D13 shadow fork, one office-hours scratch, one spare. **POST-MVP** autoscaling
(pool tracks queue depth) is deliberately deferred — one venue, one build at a time.

### Egress policy

Sandboxes are the least-trusted compute — they run generated code. Egress is default-deny with a
per-department allowlist from the manifest (`sandbox.egress_allowlist`,
[`../02-departments/D07-build.md`](../02-departments/D07-build.md) §4):

| Tier | Destinations | Enforced by |
|---|---|---|
| Always | `api.anthropic.com` | — nothing runs without it |
| Per-manifest | e.g. D07: github.com, api.github.com, registry.npmjs.org, api.render.com, api.replay.io, api.stripe.com, api.lovable.dev, api.whop.com | Docker: iptables/dns-proxy sidecar; Superserve: platform egress rules |
| Never | Everything else — notably: personal email providers, social APIs, other ventures' services | same |

Violations emit `ops.egress_blocked` events — D13 mines them like any other telemetry. The
platform services themselves (kernel etc.) have ordinary egress; the allowlist discipline is for
sandboxed generated code, where it is load-bearing.

---

## 7. Scaling **MVP-light**

Honest sizing: the MVP serves one founder, one venue, one browser. Scaling design is about not
painting into corners, not about load.

| Service | MVP size | Scales by | Corner avoided |
|---|---|---|---|
| kernel | 1× standard | Vertical first; SSE fan-out via Redis pub/sub when >1 instance | LISTEN/NOTIFY is per-connection; the subscribe abstraction hides the swap |
| boardroom | 1× starter | Stateless, N× trivially | — |
| orchestrator | **2×** standard | `numInstances` + BullMQ concurrency per queue | 2 from day one so single-instance assumptions never creep in; idempotency (`processed_messages`) makes N safe |
| simpop | 1× starter | Cache-hit bound; scale = bigger disk | Deterministic + cached ⇒ horizontal is pointless |
| voice / gateway-linq | 1× starter each | Per-call fan-out is vendor-side | — |
| Postgres | basic-1gb | Vertical; read replicas only if projections ever need them | Event-sourced writes are append-only and small |

Load ceilings that matter before Quarter 1: concurrent ventures (orchestrator concurrency),
event-log growth (§8 retention), sandbox pool size. All three are config, not code.

---

## 8. Data durability & disaster recovery **MVP-light**

| Data | Class | Protection | Loss tolerance |
|---|---|---|---|
| `events` table | **The company itself** | Render PITR + nightly `pg_dump` to object storage + the demo laptop carries a same-day snapshot | Zero. Everything else rebuilds from it |
| Projections | Derived | Rebuild by replay (`pnpm db:reset` + replay is the tested path) | Total |
| Object storage | Artifacts/audio/recordings | Provider redundancy; demo-critical files also in `fixtures/` in git | Low |
| Redis | In-flight queue state | `noeviction` + idempotent consumers; on total loss, unacked WorkOrders re-derive from `work_orders` projection | Minutes of retry |
| Sandboxes | Cache | None by design — GitHub + `state.json` mirrors are the truth | Total, one task max |

DR drill (in M7 and monthly after): restore the nightly dump to a fresh DB, replay, diff the
`ventures` projection against prod. If replay-rebuild ever diverges, that is a P0 reducer bug
found on a drill instead of during a disaster.

---

## 9. Cost per environment **MVP**

Rounded, monthly, at 2026-08 Render list prices; hackathon runs a fraction of a month.

| Line | local | staging | prod/demo |
|---|---|---|---|
| Postgres | $0 (compose) | $0 (free tier) | ~$19 (basic-1gb) |
| Redis | $0 | $0 (free 25 MB) | ~$10 (starter) |
| kernel (standard) | $0 | ~$7 (starter-stg) | ~$25 |
| orchestrator ×2 (standard) | $0 | ~$7 (×1 starter) | ~$50 |
| boardroom, simpop, voice, gateway-linq (starter ×4) | $0 | ~$21 (×3, no voice) | ~$28 |
| simpop disk 5 GB | $0 | — | ~$1 |
| Object storage | $0 (MinIO) | shared bucket ~$0 | ~$5 |
| **Infra subtotal** | **$0** | **~$35** | **~$140/mo (≈ $25 for the weekend)** |
| LLM spend | dev keys, ~$30/day/lane peak | ~$10/day | Demo weekend budget **$300** hard cap via the meter; the M1 acceptance run costs <$6 |
| Vendor usage (Twilio, ElevenLabs, Apify…) | $0 (mock) | $0 (mock) | <$50 weekend, most sponsor credits |
| Venture products (per venture) | — | — | ~$14/mo (starter web + starter PG), attributed via `venture:` tag to D11's ledger |

The meter is the governor: infra cost is static and small; **LLM spend is the variable** and it
is budgeted per department envelope with degrade-at-80% ([`06-repo-layout.md`](06-repo-layout.md)
§5, `budgets` table). The company reading its own bill is a demo beat, so the numbers must be
real.

---

## 10. Runbook per service **MVP**

Format: symptom → check → fix. All checks are copy-pasteable. `pnpm log --tail` is the universal
first move.

### zeroth-kernel
| Symptom | Check | Fix |
|---|---|---|
| `/health` non-200 | Render logs; `DATABASE_URL` reachable? | Restart service; if DB, see Postgres runbook |
| Events accepted but UI silent | `SELECT count(*) FROM events WHERE ts > now()-interval '5 min';` vs. SSE: `curl -N $KERNEL_URL/events/stream` | If DB has rows and SSE is silent: LISTEN connection died — restart kernel (auto-reconnect is supposed to cover this; file the bug) |
| Gate stuck open | `GET /gates` — decided but no follow-on event? | `POST /gates/:id/decide` again (idempotent); check routing.yaml matched the `gate.approved` event |
| Webhook 401s | Vendor signature header vs. `*_WEBHOOK_SECRET` | Re-sync the secret from the vendor dashboard; secrets drift when re-provisioned |

### zeroth-orchestrator
| Symptom | Check | Fix |
|---|---|---|
| WorkOrders queueing, nothing running | BullMQ depth (`pnpm log --queues`); worker logs | Restart instances; safe — idempotency + at-least-once |
| One department always failing | `dept.work_failed` payloads; is it Zod-parse (prompt drift) or tool error? | Prompt drift: fix the `.md`, no deploy. Tool: check vendor, consider `ZEROTH_TOOLS_<X>=mock` |
| Meter shows zero spend during activity | `meters` rows for the venture | onUsage hook detached — restart; if persistent, spend is unmetered: freeze the venture (invariant 6) until fixed |
| Sandbox leases failing | Driver? `local`: `docker ps`, disk space. `superserve`: vendor status | Flip `SANDBOX_DRIVER=local` (same interface); the demo continues |

### zeroth-boardroom
| Symptom | Check | Fix |
|---|---|---|
| Blank page | Browser console; `/health` of kernel | Usually `KERNEL_URL`/token mismatch after redeploy — recheck env group |
| Stream stalls after minutes | Network tab: SSE reconnects looping? | Known LB idle-timeout class: the hook's reconnect covers it; on stage, `F`-key to replay per [`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §6 |

### zeroth-simpop
| Symptom | Check | Fix |
|---|---|---|
| Slow first poll | Cold cache? `ls /data/cache.sqlite` size | Expected once; pre-warm in reset script before demo |
| Non-identical reruns | `SIMPOP_SEED` set? PUMS file hash matches fixtures? | Restore seed/fixture; determinism is an acceptance criterion, treat drift as P0 |
| OOM on load | PUMS file size vs. plan memory | Use the slimmed extract (≤80 MB); never the raw download |

### zeroth-voice / zeroth-gateway-linq
| Symptom | Check | Fix |
|---|---|---|
| Calls not placing | Twilio/ElevenLabs dashboards; account balance | Flip D04 to the recorded call — pre-decided cut #3 in [`05-mvp-scope.md`](05-mvp-scope.md) §4 |
| Linq cards not arriving | gateway logs: webhook delivered? Founder phone on LTE? | Boardroom-approve fallback; re-provision the Linq number after the demo, not during |

### Postgres / Redis
| Symptom | Check | Fix |
|---|---|---|
| PG connections exhausted | `SELECT count(*) FROM pg_stat_activity;` | Bounce the leakiest service; pool sizes are in `packages/db/src/client.ts` |
| PG down | Render status page | Wait or restore: latest dump → new instance → repoint `DATABASE_URL` → replay (§8 drill path) |
| Redis full / evicting | `INFO memory`; policy must be `noeviction` | Upgrade plan; investigate queue backlog cause first |

---

## Assumptions & open questions

- **Assumed:** Render remains the deploy target for both worlds (sponsor + one API for
  `build.deployer`). The blueprint isolates the coupling; a port to Fly/Railway is contained in
  `infra/` + the render tool-plane driver.
- **Assumed:** Supabase Storage (or any S3 endpoint) for demo object storage; MinIO locally.
  Only `S3_ENDPOINT` changes.
- **Open:** Render preview environments for the Boardroom in Week 1 — cheap, but preview URLs ×
  shared staging kernel needs a token-per-preview story first.
- **Open:** whether the sandbox egress proxy (local Docker path) is a dns-filtering sidecar or
  iptables rules in the runner image. Sidecar is cleaner; decide when the fleet goes beyond
  local (Quarter 1, [`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md)).
- **Open:** event-log retention policy. Append-only forever is fine for months at MVP volume;
  the archival tier (cold events → object storage parquet) is a Quarter 1 design item.
