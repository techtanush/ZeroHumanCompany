# Boardroom — the Zeroth frontend

Vite + React single-page app with two worlds:

1. **Onboarding wizard** — collects the founder, phone, idea, budget, workspace folder,
   schedule, integrations and voice consent, then `POST /v1/ventures`.
2. **Live pixel-art HQ** — a canvas building (exterior → cutaway → rooms) whose sprites are
   bound to the kernel's real agents, meetings and workday clock, with a dock of panels for
   gates, events, briefings, goals, wallets, voice, keys and settings.

The venture id persists in `localStorage` (`zeroth.venture_id`); `?onboarding=1` reopens the wizard.

## Run

```bash
pnpm dev:kernel        # kernel on http://localhost:4000
pnpm dev:orchestrator  # consumes work orders so agents actually move
pnpm dev:boardroom     # http://localhost:5173
```

Vite proxies `/v1` and `/health` to `KERNEL_URL` (default `http://localhost:4000`), so there is no
CORS setup. Every request carries `Authorization: Bearer <token>` where the token is read from
`localStorage['zeroth.kernel_token']` and defaults to `dev-only-token`. An optional
`zeroth.kernel_url` key overrides the base URL (`src/api.ts`). If `/health` fails, a red banner
tells you to start the kernel; the app keeps retrying.

Other scripts: `pnpm -F @zeroth/boardroom test` (vitest, pure logic in `src/logic.test.ts`),
`typecheck`, `build`.

## Onboarding steps (`src/components/Onboarding.tsx`)

| Step | What happens | Kernel calls |
|---|---|---|
| You | Name, email, timezone, background | — |
| Phone | Number normalised to E.164; sends a Linq HELLO iMessage and asks you to confirm it arrived | `PUT /v1/integrations/vars/FOUNDER_PHONE`, `POST /v1/integrations/linq/test-message` |
| Idea | Founder-led idea text, or "autonomous origination" (D01 finds the opportunity) | — |
| Budget | `spend_cap_usd`, `terac_cap_usd`, autonomy level (copilot / supervised / autonomous) | — |
| Workspace | Folder the build agents may touch (typed path or picker) | sent as `workspace_root` on launch |
| Schedule | Timezone, work start/end, exec meeting, all-hands, improvement run, working days | sent as `settings.meetings` |
| Integrations | Which keys are present; probe / set them | `GET /v1/integrations`, `POST …/:id/probe`, `PUT …/vars/:ENV` |
| Voice | Consent text, optional voice sample | `GET /v1/voice/consent-text` |
| Launch | Creates the venture, then records consent, clones the voice, confirms the HELLO | `POST /v1/ventures`, `POST …/voice/consent`, `POST …/voice/clone`, `POST /v1/integrations/linq/confirm` |

## HQ dock panels (`src/hq/HqCanvas.tsx`)

| Dock button | Component | Kernel routes |
|---|---|---|
| gates | `GatesPanel` | `GET /v1/gates?venture_id=` (via store), `POST /v1/gates/:id/decision` |
| live | `TimelinePanel` | events from `GET /v1/ventures/:id/stream` (SSE; replays from `after_seq`, then live) |
| exec | `BriefingRoom` (jumps to the exec room) | `GET …/briefing/latest`, `GET …/artifacts`, `POST …/departments/exec/ask`, `POST …/meetings/:kind/start|end` |
| goals | `GoalsView` | `GET …/goals` |
| clock | `MeetingsPanel` | `PUT …/settings`, `POST …/meetings/{executive,all_hands,improvement,workday_start,workday_end}/start|end` |
| wallets | `WalletsPanel` | `GET …/wallets`, `POST …/wallets/topup` (Stripe Checkout URL) |
| voice | `VoicePanel` | `GET /v1/voice/consent-text`, `POST …/voice/{consent,clone,revoke}` |
| keys | `IntegrationsPanel` | `GET /v1/integrations`, `POST …/:id/probe`, `PUT …/vars/:ENV`, `POST …/linq/test-message` |
| setup | `SettingsPanel` | `POST …/workspace` (grant folder), `POST /v1/kill-switch` |

Entering a non-exec room opens `DeptSidebar` (`GET …/departments/:dept/facts`,
`POST …/departments/:dept/ask`, `POST …/chat`). The store polls `GET …/agents` every 15 s and
derives gates, settings, meeting state and the workday from the SSE stream (`ops.meeting_*`,
`ops.workday_*`, `gate.*` events).

## Rooms → departments (`src/hq/departments.ts`)

| Room | Departments |
|---|---|
| Research & Product | D01 Intake, D02 Office Hours, D03 Market Research |
| Outreach & Customer Validation | D04 Outreach & Validation, D05 Synthetic Population |
| Engineering & Build | D07 Build |
| Strategy & Growth | D06 Pivot & Decision, D08 Strategy |
| Lead Intelligence | D09 Leads |
| Sales | D10 Sales |
| Finance & Treasury / People & Terac Hiring | D11 Finance & HR (shown in both rooms) |
| Chief of Staff / Improvement Branch | D13 Chief of Staff (shown in both rooms) |
| Customer Support & Retention | D12 Support |
| Central Executive Meeting Room | all 13 |

`roomForDept()` returns the first matching room; `HqCanvas` also mirrors agents into every room
that lists their department, so shared departments appear in both.

## Live binding (`src/hq/scene.ts`)

* Agents from `GET …/agents` are grouped by room and bound to sprites: heads first, then
  `working` agents, then idle. Working agents sit at workstations; idle ones wander. Extra live
  agents beyond the walker count are seated at desks. Clicking a sprite shows its live report
  (current task, history, tools used).
* `ops.meeting_started {kind: all_hands}` empties every room into the exec room; `executive` pulls
  each department head out of its room to the boardroom table.
* `ops.workday_ended` switches to night mode: floors dim and most idle sprites leave; agents with a current task stay at their desks.
* Pending gates are counted per room and shown as badges.

## Safety story

* Anything consequential opens a **gate** and pauses until the founder decides (Linq iMessage or the
  gates panel): `money_out`, `outbound_to_real_person`, `public_content`, `deploy`,
  `account_creation`, `new_department`, `voice_clone_consent`, plus pivot/refund/niche gates.
* Build agents touch files only through `workspace.*` tools, which resolve every path against the
  founder-granted `workspace_root` and reject anything that escapes it (`packages/tool-plane`).
* **Replay** runs its suite before any push/deploy (`use_replay_before_deploy`).
* Voice cloning is consent-first: the consent event is recorded before any audio is sent; only the
  `voice_id` is stored and it can be revoked from the voice panel.
* The `setup` panel exposes the kill switch (`POST /v1/kill-switch`).
