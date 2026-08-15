# 08 — CI/CD & Testing

CI pipelines, the test pyramid, Replay-driven QA gating, contract tests on the Zod schemas,
migration testing, preview environments, release process, rollback plans, and post-launch
monitoring — for both the ZEROTH monorepo and the venture repos D07 generates.

> **The testing thesis, inherited from [`06-repo-layout.md`](06-repo-layout.md) §6:** test what
> breaks silently. Schemas, reducers, evidence enforcement, idempotency, and determinism break
> silently; LLM prose and UI pixels do not. CI exists to make the silent failures loud, in under
> five minutes, on every push.

Read alongside [`07-source-control-and-github.md`](07-source-control-and-github.md) (what
triggers CI), [`09-deployment-architecture.md`](09-deployment-architecture.md) (where deploys
land), and [`../02-departments/D07-build.md`](../02-departments/D07-build.md) §6 (the QA agent
whose scenarios CI re-runs).

---

## 1. The test pyramid

```
                        ┌────────────┐
                        │    e2e     │  ~5 scenarios · Replay-recorded · minutes
                        │ (demo path)│  the 4-minute story as a Playwright script
                        ├────────────┤
                        │integration │  ~15 tests · real PG in docker · tens of seconds
                        │            │  event→routing→work-order, webhook→projection
                        ├────────────┤
                        │  contract  │  ~40 tests · pure · seconds
                        │            │  every Zod schema × every fixture, mock/real parity
                        ├────────────┤
                        │    unit    │  ~120 tests · pure · seconds
                        │            │  reducers, meter math, gate logic, sign.ts, routing eval
                        └────────────┘
        Deliberately NOT in the pyramid: LLM output content, Boardroom components,
        prompt quality. Tuned by eye, per 06-repo-layout.md §6.
```

| Layer | Runner | Where | Budget | Gate? |
|---|---|---|---|---|
| unit | vitest | next to source, `*.test.ts` | <20 s total | every push |
| contract | vitest | `packages/contracts`, `packages/tool-plane` | <15 s | every push |
| integration | vitest + testcontainers-style compose | `apps/kernel/src/**/*.int.test.ts` | <60 s | every PR |
| e2e | Playwright + Replay | `e2e/` | <5 min | pre-release + nightly |

`pnpm test` runs unit + contract only and must stay under 60 seconds — a suite nobody runs is
worse than none. Integration and e2e run via `pnpm test:int` and `pnpm test:e2e`.

---

## 2. World A CI — the ZEROTH monorepo **MVP-light / Week 1 full**

During the hackathon, CI is the local pre-merge ritual (`pnpm build && pnpm test`, enforced
socially at the 45-minute cadence). The pipeline below ships in Week 1
([`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md)) and is written now so the repo
is born CI-shaped.

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request:
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }

jobs:
  build-test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: zeroth, POSTGRES_PASSWORD: zeroth, POSTGRES_DB: zeroth }
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 5s --health-retries 10
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build typecheck lint --cache-dir=.turbo   # remote cache via TURBO_TOKEN
      - run: pnpm test                                                # unit + contract, <60s
      - run: pnpm fixtures:check                                      # every fixture parses its schema
      - run: pnpm db:migrate && pnpm test:int
        env: { DATABASE_URL: postgres://zeroth:zeroth@localhost:5432/zeroth }
      - run: pnpm test:migrations                                     # §6 — fresh vs. stepped parity
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2                             # thorough version of the pre-push grep
  e2e:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      # compose up full stack (ZEROTH_TOOLS=mock), then the demo-path Playwright suite
      - run: docker compose -f infra/docker-compose.yml up -d && pnpm dev:ci &
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: e2e-traces, path: e2e/traces/ }
```

Required status checks on `main` (Week 1): `build-test`, `secrets-scan`. `e2e` is
required-for-release, not required-for-merge — a 20-minute merge gate kills iteration speed.

---

## 3. Contract tests on the Zod schemas **MVP**

The highest-value tests in the repo, because a contract break is a four-lane outage. Three
families, all generated or near-generated from the schemas themselves
(per the codegen accelerator, [`02-speed-playbook.md`](02-speed-playbook.md) §5.1):

```ts
// packages/contracts/src/artifacts.test.ts — family 1: fixture round-trip
import { readFixture } from './test-util';
for (const [name, schema] of Object.entries(allArtifactSchemas)) {
  test(`${name} parses its committed fixture`, () => {
    const fx = readFixture(`demo-1/artifacts/${kebab(name)}.json`);
    expect(() => schema.parse(fx)).not.toThrow();
  });
  test(`${name} round-trips through JSON`, () => {
    const fx = schema.parse(readFixture(`demo-1/artifacts/${kebab(name)}.json`));
    expect(schema.parse(JSON.parse(JSON.stringify(fx)))).toEqual(fx);
  });
}
```

```ts
// packages/contracts/src/events.test.ts — family 2: taxonomy closure
test('every event in fixtures/demo-1/events.jsonl parses the discriminated union', () => {
  for (const line of readLines('demo-1/events.jsonl')) {
    expect(() => ZerothEvent.parse(JSON.parse(line))).not.toThrow();
  }
});
test('no event type exists in fixtures that is missing from the union', /* inverse check */);
```

```ts
// packages/tool-plane/src/parity.test.ts — family 3: mock/real driver parity
for (const tool of toolFamilies) {
  test(`${tool} mock satisfies the driver interface and return schema`, async () => {
    const out = await mockDrivers[tool].happyPathCall(fixtureInput(tool));
    expect(() => driverReturnSchemas[tool].parse(out)).not.toThrow();
  });
}
```

**The breaking-change tripwire:** a snapshot of every schema's JSON Schema form is committed
(`contracts-codegen` output). CI diffs it; any non-additive change (removed field, narrowed type,
changed name) fails with the exact path. Additive changes update the snapshot in the same PR.
This mechanizes the freeze protocol of [`02-speed-playbook.md`](02-speed-playbook.md) §1 after
the humans stop watching.

---

## 4. Replay-driven QA gating **MVP for venture repos**

Replay is the QA evidence layer: every e2e scenario runs under a Replay recording, pass or fail,
and the recording URL travels with the result — into events, PR bodies, and founder cards.

### 4.1 In venture-repo CI (`ci/qa-replay`, the required check from
[`07-source-control-and-github.md`](07-source-control-and-github.md) §4.3)

```yaml
# venture repo .github/workflows/qa.yml — generated by build.architect with the scaffold
name: qa
on: { pull_request: { branches: [main] } }
jobs:
  qa-replay:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile && pnpm build
      - run: pnpm exec replay-playwright run --suite qa/scenarios/ --record all
        env: { REPLAY_API_KEY: ${{ secrets.REPLAY_API_KEY }} }
      - run: node qa/gate.js   # the gating logic below
```

```js
// qa/gate.js — the gate policy, exactly D07's rules in code
// p0 scenario failed        → exit 1 (blocks merge, blocks deploy gate)
// p1 failed                 → warn; deployable with quality:'partial'
// flaky (fail then 2× pass) → labeled flaky, non-blocking, filed as ProductSignal
// any pass with console errors or failed same-origin network calls
//                           → reclassified FAIL (the critic's honesty rule #4)
// output: qa-summary.json {scenarios_total, passed, failed, recordings:[{id,status,replay_url,founder_summary}]}
```

The `qa-summary.json` is what `build.deployer` embeds in the `Deployment` artifact and what the
founder's `[Watch QA]` button opens. CI and the QA agent produce the same shape — one schema,
`Deployment.qa`, from [`../02-departments/D07-build.md`](../02-departments/D07-build.md) §2.

### 4.2 In ZEROTH's own e2e **Week 1**

The demo-path suite (§1) runs under Replay nightly. A regression in the Boardroom's story path is
a demo-day risk even after demo day — the sales demo is the same path.

---

## 5. Testing the agents without testing the LLM **MVP**

The line between "test the machine" and "eyeball the model":

| Tested mechanically | How |
|---|---|
| Head loop terminates (one critic revision max) | unit test with a scripted always-reject critic |
| Zod-invalid worker output triggers exactly one retry then `Escalation` | unit, mocked SDK returning garbage |
| Evidence enforcement rejects uncited numerics | the sign.ts test — the judge's question, automated |
| Meter records every mocked SDK call | unit |
| Manifest loader rejects malformed YAML, including D13's generated D14 | contract test + a corpus of 10 deliberately-broken manifests |
| Idempotent event consumption | integration: deliver each `demo-1` event twice, projections unchanged |
| simpop determinism | same seed → byte-identical output, diffed in CI (Rust side: `cargo test`) |

| Eyeballed, never CI-gated | Why |
|---|---|
| Prompt output quality | Non-deterministic; a flaky gate teaches people to ignore CI |
| Card visual polish | You look at it constantly |
| Demo pacing | That's what rehearsals are for ([`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §11) |

---

## 6. Migration testing **MVP-light**

Migrations break silently and unrecoverably, which by the thesis makes them a test target.

```bash
pnpm test:migrations   # scripts/test-migrations.ts, in CI on every PR touching packages/db
```

```
1. FRESH:    empty DB → run all migrations → dump schema A
2. STEPPED:  empty DB → migrations up to HEAD~1 → seed 50 demo-1 events + projections
             → run the new migration → dump schema B, verify data survived
3. PARITY:   schema A == schema B (a migration that only works from empty is broken)
4. DRIZZLE:  drizzle-kit check — schema.ts and migrations/ agree; drift fails CI
```

| Rule | Enforced by |
|---|---|
| Additive-only during the hackathon (add column/table/index; never drop, never rename) | review + the reviewer agent post-MVP |
| Venture-repo migrations run as a pre-deploy job, never in web boot | deployer prompt rule #3, [`../02-departments/D07-build.md`](../02-departments/D07-build.md) §6 |
| Destructive migrations (post-MVP) ship in two releases: N marks deprecated, N+1 drops | release checklist §7 |
| Every migration file is immutable once merged | CI hash check |

---

## 7. Preview environments, release process, rollback

### 7.1 Preview environments **POST-MVP (Week 1)**

| Repo | Preview | Mechanism |
|---|---|---|
| ZEROTH boardroom | per-PR preview URL | Render preview environments off `infra/render.yaml` (`previews: enabled`) |
| ZEROTH kernel+orchestrator | one shared `staging` env, not per-PR | stateful (PG/Redis); per-PR DBs cost more than they catch. See [`09-deployment-architecture.md`](09-deployment-architecture.md) §2 |
| Venture repos | none in MVP | the deploy gate + QA green is the preview; post-MVP: Render previews per PR |

Preview data policy: previews run `ZEROTH_TOOLS=mock` and seed from `fixtures/demo-1` — no live
vendor calls, no real personal data outside prod, ever.

### 7.2 Release process

**Hackathon (MVP):** a release is a milestone tag on green `main`
([`01-build-order.md`](01-build-order.md) §13). Deploys to the demo environment are manual
(`pnpm deploy:demo`), because a surprise auto-deploy during rehearsal is a self-inflicted outage.

**Week 1 onward:** tag-driven.

```
release checklist (scripts/release.ts prints and enforces):
□ main green: build-test + secrets-scan + e2e all passing
□ pnpm test:migrations green
□ CHANGELOG.md section written (agent-drafted from commit trailers, human-skimmed)
□ tag v0.<minor>.<patch> → GitHub Release → render deploy of the exact tag sha
□ post-deploy: health probes green 5× over 60 s, error rate < 1% for 15 min
□ previous_release_sha recorded in the release notes  ← the rollback pointer
```

**Venture repos:** the release process *is* D07's gated deploy
([`07-source-control-and-github.md`](07-source-control-and-github.md) §6). Nothing extra.

### 7.3 Rollback plans

| System | Rollback | Time | Gate? |
|---|---|---|---|
| ZEROTH services | Render redeploy of `previous_release_sha` (Render retains builds) | ~2 min | No — rollback is always allowed |
| ZEROTH DB | Additive-only migrations mean rollback = deploy old code; no down-migrations in anger. Point-in-time restore is the disaster path ([`09-deployment-architecture.md`](09-deployment-architecture.md) §8) | minutes / PITR | No |
| Venture app | `build.deployer` redeploys previous sha + emits `build.rolled_back` + opens Escalation | ~2 min | **No** — deploying is gated, undeploying never is |
| Contracts | Revert commit + snapshot restore; consumers were protected by the tripwire (§3) so blast radius is the one PR | minutes | No |
| A bad prompt (behavior regression) | Prompts are data ([`02-speed-playbook.md`](02-speed-playbook.md) §5.4): `git revert` the `.md`, no redeploy | seconds | No |

The demo-day rollback is different in kind: it is the fallback-key system in
[`04-demo-seed-and-fallbacks.md`](04-demo-seed-and-fallbacks.md) §6 — you do not redeploy on
stage, you switch to the recording.

---

## 8. Post-launch monitoring

### 8.1 MVP (demo weekend)

The event stream is the monitoring system — it already exists and the Boardroom already renders it.

| Signal | Source | Surfaced |
|---|---|---|
| Service liveness | `GET /health` per service, kernel polls every 30 s → `ops.health_changed` | Boardroom status strip |
| Agent failures | `dept.work_failed`, `Escalation` events | event log + red room tint |
| Spend | budget meter → `budget.degraded` at 80% | budget bars |
| Queue depth | BullMQ counts → `ops.queue_depth` event each minute | log; alarm if >20 for 5 min |
| Venture app health | deployer's probe schedule (5× over 30 s post-deploy, then per-minute) | `Deployment.health` field |

Alerting: `ops.*` events at `severity>=high` render a Linq card to the founder phone — the same
rail as gates, zero new infra.

### 8.2 Week 1 / Month 1 **POST-MVP**

| Add | Tool | Why then |
|---|---|---|
| Error aggregation with source maps | Sentry (boardroom + kernel + venture scaffold default) | Real users produce real stack traces |
| Uptime checks from outside | Render health checks + a external ping | Self-reported health lies during network partitions |
| Log retention + search | Render log streams → object storage | Postmortems need history |
| Cost dashboards | meter projections + vendor billing APIs reconciled daily by D11 | The metered numbers get audited against invoices |
| SLO page | p95 kernel API < 300 ms, SSE reconnect < 2 s, deploy-to-live < 10 min | The numbers sales will quote |
| Replay nightly demo-path run | §4.2 | The demo is now the sales demo |

Monitoring for venture products ships **in the scaffold** (health route, Sentry hook, uptime
check registered by the deployer), so every product the company builds is born observable — a
D12 requirement once support goes live.

---

## Assumptions & open questions

- **Assumed:** GitHub Actions is the CI runner for both worlds (venue-network-independent,
  free tier sufficient at MVP volume). Render's build pipeline is deploy, not CI.
- **Assumed:** Replay's Playwright integration works headless in Actions with `REPLAY_API_KEY`;
  the 30-minute rule applies, and the fallback is plain Playwright traces uploaded as artifacts
  (loses shareable URLs, keeps the gate).
- **Open:** Turborepo remote-cache token in CI (`TURBO_TOKEN`) — set up with the same
  `npx turbo link` at `T+0:15` or defer to Week 1. Costs nothing; leaning do-it-at-T+0.
- **Open:** whether the e2e demo-path suite should assert on *timings* (beat budget regression)
  as well as behavior. Attractive but flake-prone in shared runners; revisit when it runs
  nightly on stable infra.
- **Open:** per-PR ephemeral DBs for kernel integration tests (currently shared staging) — cost
  vs. isolation tradeoff belongs to the Month 1 review in
  [`10-roadmap-and-milestones.md`](10-roadmap-and-milestones.md).
