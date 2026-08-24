import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Integration registry: which vendor keys the company needs, whether each is
 * configured, and where to get it. Values are NEVER returned — only status.
 * Keys entered in the Boardroom are written to the repo-root `.env` (gitignored)
 * and into process.env so the running kernel picks them up immediately.
 */

export interface IntegrationVar {
  env: string;
  label: string;
  required: boolean;
  /** Free-text hint shown in the UI ("dashboard.stripe.com → test keys"). */
  hint?: string;
  secret?: boolean;
}

export interface IntegrationSpec {
  id: string;
  name: string;
  purpose: string;
  /** What in the company this integration powers. */
  powers: string;
  tier: 'core' | 'sponsor' | 'optional';
  vars: IntegrationVar[];
  docs?: string;
  /** Where the founder goes to authorize/collect this vendor's credentials. */
  connect_url?: string;
}

export const INTEGRATIONS: IntegrationSpec[] = [
  { id: 'anthropic', name: 'Anthropic Claude', tier: 'core', purpose: 'The brains of every department head, worker and critic.', connect_url: 'https://console.anthropic.com/settings/keys', powers: 'All agents (Sonnet only)',
    vars: [{ env: 'ANTHROPIC_API_KEY', label: 'API key', required: true, hint: 'console.anthropic.com → API keys' }] },
  { id: 'linq', name: 'Linq', tier: 'sponsor', purpose: 'Founder phone approvals: gates and alerts arrive as iMessage cards you can reply to.', connect_url: 'https://app.linqapp.com/settings/api', powers: 'Gates with channel=linq, HELLO test, new-capability approvals',
    vars: [
      { env: 'LINQ_API_KEY', label: 'API key', required: true },
      { env: 'FOUNDER_PHONE', label: 'Founder phone (E.164)', required: true, secret: false, hint: '+16505551234' },
      { env: 'LINQ_FROM_NUMBER', label: 'Linq sender number', required: false, secret: false },
      { env: 'LINQ_WEBHOOK_SECRET', label: 'Webhook secret', required: false },
    ] },
  { id: 'terac', name: 'Terac (MCP)', tier: 'sponsor', purpose: 'The human-labor layer: when agents hit a wall the company hires real experts. MCP-first, REST fallback.', connect_url: 'https://terac.com/dashboard', powers: 'D11 HR requisitions, feasibility, launches, submissions',
    vars: [
      { env: 'TERAC_API_KEY', label: 'API key (also the MCP bearer)', required: true },
      { env: 'TERAC_MCP_URL', label: 'MCP URL', required: false, secret: false, hint: 'defaults to https://terac.com/api/mcp' },
      { env: 'TERAC_BASE_URL', label: 'REST base URL (fallback)', required: false, secret: false },
    ] },
  { id: 'stripe', name: 'Stripe', tier: 'sponsor', purpose: 'Money in: payment links + webhooks; wallet top-ups for the agents\' budget.', connect_url: 'https://dashboard.stripe.com/test/apikeys', powers: 'D10 Sales, D11 Treasury, agent wallets',
    vars: [
      { env: 'STRIPE_SECRET_KEY', label: 'Secret key (test mode)', required: true, hint: 'sk_test_…' },
      { env: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable key', required: false, secret: false },
      { env: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook secret', required: false, hint: 'stripe listen --forward-to localhost:4000/v1/webhooks/stripe' },
    ] },
  { id: 'composio', name: 'Composio', tier: 'sponsor', purpose: 'Gmail / Calendar / GitHub / Vercel / other SaaS on behalf of the company. Outbound email, repo pushes and deploys stay behind gates.', connect_url: 'https://app.composio.dev/developers', powers: 'gmail, calendar, github, vercel through Composio connected accounts',
    vars: [
      { env: 'COMPOSIO_API_KEY', label: 'API key', required: true, hint: 'app.composio.dev' },
      { env: 'COMPOSIO_ENTITY_ID', label: 'Entity ID (per founder)', required: false, secret: false, hint: 'created when you connect Gmail' },
    ] },
  { id: 'elevenlabs', name: 'ElevenLabs', tier: 'sponsor', purpose: 'Voice: consented founder voice clone, phone calls with AI disclosure, transcription.', connect_url: 'https://elevenlabs.io/app/settings/api-keys', powers: 'D04 discovery calls, D10 sales calls',
    vars: [
      { env: 'ELEVENLABS_API_KEY', label: 'API key', required: true },
      { env: 'ELEVENLABS_VOICE_ID', label: 'Cloned voice ID', required: false, secret: false, hint: 'set after consent + clone' },
      { env: 'ELEVENLABS_AGENT_ID', label: 'Conversational agent ID', required: false, secret: false },
      { env: 'ELEVENLABS_PHONE_NUMBER_ID', label: 'Phone number ID', required: false, secret: false },
    ] },
  { id: 'solari', name: 'Solari (Pinetree)', tier: 'sponsor', purpose: 'Computer/browser use: the company\'s hands for account creation, forms, and web tasks. Stops at 2FA/CAPTCHA/ToS/payment walls and asks you.', connect_url: 'https://pinetree-research.com', powers: 'solari.browse/act/extract/screenshot',
    vars: [
      { env: 'SOLARI_API_KEY', label: 'API key', required: true },
      { env: 'SOLARI_BASE_URL', label: 'Base URL', required: false, secret: false },
    ] },
  { id: 'band', name: 'Band', tier: 'sponsor', purpose: 'Group chats per department where agents plan; the executive-briefing room.', connect_url: 'https://www.band.ai', powers: 'band.publish, dept chat rooms',
    vars: [
      { env: 'BAND_API_KEY', label: 'API key', required: true },
      { env: 'BAND_BASE_URL', label: 'Base URL', required: false, secret: false },
      { env: 'BAND_WORKSPACE_ID', label: 'Workspace ID', required: false, secret: false },
    ] },
  { id: 'render', name: 'Render', tier: 'sponsor', purpose: 'Deploy the built product (deploy gate).', connect_url: 'https://dashboard.render.com/u/settings#api-keys', powers: 'render.deploy',
    vars: [{ env: 'RENDER_API_KEY', label: 'API key', required: true }, { env: 'RENDER_OWNER_ID', label: 'Owner ID', required: false, secret: false }] },
  { id: 'vercel', name: 'Vercel', tier: 'sponsor', purpose: 'Frontend hosting for the venture. Prefer Composio-connected Vercel; direct token is supported for deployment status/config.', connect_url: 'https://vercel.com/account/settings/tokens', powers: 'vercel.deploy, production frontend URLs',
    vars: [
      { env: 'VERCEL_TOKEN', label: 'Vercel token', required: false },
      { env: 'VERCEL_TEAM_ID', label: 'Team ID', required: false, secret: false },
      { env: 'VERCEL_PROJECT_ID', label: 'Project ID', required: false, secret: false },
    ] },
  { id: 'replay', name: 'Replay', tier: 'sponsor', purpose: 'Autonomous QA with time-travel recordings; runs before every deploy so buggy code never ships.', connect_url: 'https://app.replay.io', powers: 'replay.run_suite',
    vars: [{ env: 'REPLAY_API_KEY', label: 'API key', required: true }] },
  { id: 'github', name: 'GitHub', tier: 'core', purpose: 'Repo work for the venture the company builds.', connect_url: 'https://github.com/settings/tokens', powers: 'github.push',
    vars: [{ env: 'GITHUB_TOKEN', label: 'Personal access token', required: true }, { env: 'GITHUB_ORG', label: 'Org / owner', required: false, secret: false }] },
  { id: 'business_tools', name: 'Business tools gateway', tier: 'optional', purpose: 'Leadgen / CRM / support / metrics gateway.', connect_url: 'https://app.composio.dev/apps', powers: 'leadgen.*, crm.upsert, support.upsert_ticket, metrics.record_signal',
    vars: [{ env: 'BUSINESS_TOOLS_URL', label: 'Gateway URL', required: true, secret: false }, { env: 'BUSINESS_TOOLS_API_KEY', label: 'Gateway key', required: false }] },
  { id: 'whop', name: 'Whop', tier: 'optional', purpose: 'Consumer/community revenue rail.', connect_url: 'https://whop.com/dashboard/developer', powers: 'whop.create_checkout',
    vars: [{ env: 'WHOP_API_KEY', label: 'API key', required: true }, { env: 'WHOP_COMPANY_ID', label: 'Company ID', required: false, secret: false }] },
  { id: 'dodo', name: 'Dodo Payments', tier: 'optional', purpose: 'Merchant-of-record for non-US ventures.', connect_url: 'https://app.dodopayments.com/developer/api-keys', powers: 'dodo.create_checkout',
    vars: [{ env: 'DODO_API_KEY', label: 'API key', required: true }] },
];

const KNOWN_ENV = new Set(INTEGRATIONS.flatMap((i) => i.vars.map((v) => v.env)));

export interface IntegrationStatus {
  id: string;
  name: string;
  tier: string;
  purpose: string;
  powers: string;
  ready: boolean;
  vars: Array<{ env: string; label: string; required: boolean; configured: boolean; secret: boolean; hint?: string; masked?: string }>;
}

function mask(v: string): string {
  if (v.length <= 6) return '••••';
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

export function integrationStatus(): IntegrationStatus[] {
  return INTEGRATIONS.map((i) => {
    const vars = i.vars.map((v) => {
      const val = process.env[v.env];
      const configured = Boolean(val && val.trim());
      const secret = v.secret !== false;
      return { env: v.env, label: v.label, required: v.required, configured, secret, hint: v.hint, masked: configured ? (secret ? mask(val!) : val) : undefined };
    });
    return { id: i.id, name: i.name, tier: i.tier, purpose: i.purpose, powers: i.powers, connect_url: i.connect_url, ready: vars.filter((v) => v.required).every((v) => v.configured), vars };
  });
}

/** Repo-root .env (two levels above apps/kernel), overridable for tests. */
export function envFilePath(): string {
  return process.env.ZEROTH_ENV_FILE ?? path.resolve(process.cwd(), process.cwd().endsWith(path.join('apps', 'kernel')) ? '../../.env' : '.env');
}

/**
 * Sets one env var: validates the name is a known integration var, writes/updates
 * the line in .env, and updates process.env. Returns status only, never the value.
 */
export async function setIntegrationVar(env: string, value: string): Promise<{ env: string; configured: boolean; file: string }> {
  if (!KNOWN_ENV.has(env)) throw new Error(`unknown integration variable ${env}`);
  const clean = value.trim();
  const file = envFilePath();
  let text = existsSync(file) ? await readFile(file, 'utf8') : '';
  const re = new RegExp(`^${env}=.*$`, 'm');
  const line = `${env}=${clean}`;
  text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  await writeFile(file, text, 'utf8');
  if (clean) process.env[env] = clean; else delete process.env[env];
  return { env, configured: Boolean(clean), file };
}

/* ── Live probes (never throw; report degraded reasons) ────────────────────── */

export interface ProbeResult { ok: boolean; detail: string; degraded?: string; extra?: Record<string, unknown> }

export async function sendLinqText(to: string, text: string, meta: Record<string, unknown> = {}): Promise<ProbeResult> {
  const apiKey = process.env.LINQ_API_KEY;
  if (!apiKey) return { ok: false, detail: 'not sent', degraded: 'missing LINQ_API_KEY' };
  if (!/^\+[1-9]\d{6,14}$/.test(to)) return { ok: false, detail: 'not sent', degraded: `bad E.164 phone ${to}` };
  const baseUrl = process.env.LINQ_BASE_URL ?? 'https://api.linqapp.com/api/partner/v3';
  const body = { from: process.env.LINQ_FROM_NUMBER || undefined, to: [to], message: { parts: [{ type: 'text', value: text }], metadata: meta } };
  try {
    const res = await fetch(`${baseUrl}/chats`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const raw = await res.text();
    if (!res.ok) return { ok: false, detail: `linq ${res.status}`, degraded: raw.slice(0, 200) };
    let id: string | undefined;
    try { const j = JSON.parse(raw); id = j.message_id ?? j.chat_id ?? j.id ?? j.data?.id; } catch { /* non-json */ }
    return { ok: true, detail: 'sent', extra: { message_id: id } };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
}

/** Post a line into a department's Band room. Best-effort — never throws into a caller's happy path. */
export async function postToBandRoom(room: string, text: string): Promise<ProbeResult> {
  const key = process.env.BAND_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing BAND_API_KEY' };
  const baseUrl = process.env.BAND_BASE_URL ?? 'https://api.band.dev';
  const workspace_id = process.env.BAND_WORKSPACE_ID;
  try {
    const res = await fetch(`${baseUrl}/v1/rooms/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ room, text, ...(workspace_id ? { workspace_id } : {}) }),
    });
    if (!res.ok) return { ok: false, detail: `band ${res.status}`, degraded: (await res.text()).slice(0, 160) };
    return { ok: true, detail: 'posted' };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeComposio(): Promise<ProbeResult> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing COMPOSIO_API_KEY' };
  const entity = process.env.COMPOSIO_ENTITY_ID;
  try {
    // v3 is the current API; v1 now answers 410 "please upgrade to v3".
    const url = new URL('https://backend.composio.dev/api/v3/connected_accounts');
    if (entity) url.searchParams.set('user_ids', entity);
    const res = await fetch(url, { headers: { 'x-api-key': key } });
    if (!res.ok) return { ok: false, detail: `composio ${res.status}`, degraded: (await res.text()).slice(0, 160) };
    const j = (await res.json()) as any;
    const items: any[] = j.items ?? j.connectedAccounts ?? j.data ?? [];
    const apps = items.map((i) => String(i.toolkit?.slug ?? i.appName ?? i.appUniqueId ?? i.integrationId ?? '').toLowerCase());
    return { ok: true, detail: `${items.length} connected account(s)`, extra: { apps, gmail: apps.some((a) => a.includes('gmail')), calendar: apps.some((a) => a.includes('calendar')), github: apps.some((a) => a.includes('github')), vercel: apps.some((a) => a.includes('vercel')), entity_id: entity ?? null } };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
}

/* ── Composio toolkit connect (real OAuth, not a pasted key) ────────────────
 * The founder never sees a Composio API key. They click "Connect" on a
 * toolkit (Gmail, LinkedIn, GitHub, Vercel, …), we ask Composio for a hosted
 * OAuth link scoped to this founder's entity, they authorize in a new tab,
 * Composio redirects back here, and from then on every department's Composio
 * tool calls run as that connected account. */

export interface ToolkitSpec { slug: string; name: string; department: string; }

/** The toolkits Zeroth's departments actually use — the connect list, not Composio's full catalog. */
export const COMPOSIO_TOOLKITS: ToolkitSpec[] = [
  { slug: 'gmail', name: 'Gmail', department: 'D04 Outreach, D12 Support — email' },
  { slug: 'googlecalendar', name: 'Google Calendar', department: 'D04 Outreach — booking calls' },
  { slug: 'linkedin', name: 'LinkedIn', department: 'D04 Outreach, D09 Leads — sourcing & DMs' },
  { slug: 'github', name: 'GitHub', department: 'D07 Build — repo, commits, PRs' },
  { slug: 'vercel', name: 'Vercel', department: 'D07 Build — deploys' },
  { slug: 'slack', name: 'Slack', department: 'D12 Support, D13 Chief of Staff' },
  { slug: 'notion', name: 'Notion', department: 'D08 Strategy — docs & specs' },
];

export function composioEntityId(venture_id: string): string {
  return `zeroth-${venture_id}`;
}

/** Cache of toolkit slug -> auth_config id for this process, so we don't refetch every click. */
const authConfigCache = new Map<string, string>();

async function findAuthConfigId(key: string, slug: string): Promise<string | null> {
  if (authConfigCache.has(slug)) return authConfigCache.get(slug)!;
  const res = await fetch(`https://backend.composio.dev/api/v3/auth_configs?toolkit_slug=${encodeURIComponent(slug)}&limit=1`, { headers: { 'x-api-key': key } });
  if (!res.ok) return null;
  const j = (await res.json()) as any;
  const id = j.items?.[0]?.id as string | undefined;
  if (id) authConfigCache.set(slug, id);
  return id ?? null;
}

/**
 * Start a hosted OAuth connection for one toolkit and return the link to send
 * the founder to. `identity` is the Composio `user_id` this connection is
 * filed under — usually `composioEntityId(venture_id)`, but onboarding uses a
 * venture-less draft identity so GitHub etc. can be connected before the
 * venture exists (see the /v1/onboarding/composio/* routes).
 */
export async function composioInitiateConnect(identity: string, toolkitSlug: string, callbackUrl: string): Promise<
  { ok: true; redirect_url: string; connection_id: string } | { ok: false; detail: string; degraded: string }
> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing COMPOSIO_API_KEY' };
  const toolkit = COMPOSIO_TOOLKITS.find((t) => t.slug === toolkitSlug);
  if (!toolkit) return { ok: false, detail: 'unknown toolkit', degraded: `${toolkitSlug} is not in the connect list` };

  const auth_config_id = await findAuthConfigId(key, toolkitSlug);
  const body: any = {
    connection: { user_id: identity, callback_url: callbackUrl },
  };
  if (auth_config_id) body.auth_config = { id: auth_config_id };
  else body.auth_config = { toolkit_slug: toolkitSlug };

  const res = await fetch('https://backend.composio.dev/api/v3/connected_accounts', {
    method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    let detail = `composio ${res.status}`;
    try {
      const j = JSON.parse(raw);
      if (j?.error?.code === 812) detail = 'Composio key needs write access — grant "connected_accounts" and "auth_configs" write in the Composio dashboard, then retry';
      else detail = j?.error?.message ?? detail;
    } catch { /* not json */ }
    return { ok: false, detail, degraded: raw.slice(0, 300) };
  }
  const j = JSON.parse(raw) as any;
  const redirect_url = j.connectionData?.redirectUrl ?? j.redirect_url ?? j.redirectUrl;
  const connection_id = j.id ?? j.connectionId;
  if (!redirect_url) return { ok: false, detail: 'composio: no redirect url', degraded: raw.slice(0, 300) };
  return { ok: true, redirect_url, connection_id };
}

/** Which toolkits are connected under this Composio identity, right now. */
export async function composioConnectedToolkits(identity: string): Promise<{ ok: boolean; connected: string[]; degraded?: string }> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return { ok: false, connected: [], degraded: 'missing COMPOSIO_API_KEY' };
  const url = new URL('https://backend.composio.dev/api/v3/connected_accounts');
  url.searchParams.set('user_ids', identity);
  url.searchParams.set('statuses', 'ACTIVE');
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  if (!res.ok) return { ok: false, connected: [], degraded: `composio ${res.status}` };
  const j = (await res.json()) as any;
  const items: any[] = j.items ?? [];
  return { ok: true, connected: items.map((i) => String(i.toolkit?.slug ?? '').toLowerCase()).filter(Boolean) };
}

/** The Composio connected_account id (`ca_...`) for one toolkit under this identity, if active. Needed to execute tools (e.g. GitHub repo/file actions) on the founder's behalf. */
export async function composioConnectedAccountId(identity: string, toolkitSlug: string): Promise<string | null> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return null;
  const url = new URL('https://backend.composio.dev/api/v3/connected_accounts');
  url.searchParams.set('user_ids', identity);
  url.searchParams.set('toolkit_slugs', toolkitSlug);
  url.searchParams.set('statuses', 'ACTIVE');
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  if (!res.ok) return null;
  const j = (await res.json()) as any;
  return j.items?.[0]?.id ?? null;
}

/** Execute a Composio tool (e.g. a GitHub action) using the founder's connected account. */
export async function composioExecuteTool(connectedAccountId: string, toolSlug: string, args: Record<string, unknown>): Promise<
  { ok: true; data: unknown } | { ok: false; detail: string; degraded: string }
> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing COMPOSIO_API_KEY' };
  const res = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(toolSlug)}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ connected_account_id: connectedAccountId, arguments: args }),
  });
  const raw = await res.text();
  if (!res.ok) return { ok: false, detail: `composio ${res.status}`, degraded: raw.slice(0, 400) };
  let j: any;
  try { j = JSON.parse(raw); } catch { return { ok: false, detail: 'composio: bad JSON response', degraded: raw.slice(0, 400) }; }
  if (j.successful === false || j.error) return { ok: false, detail: 'tool execution failed', degraded: String(j.error ?? '').slice(0, 400) };
  return { ok: true, data: j.data ?? j };
}

export async function probeTeracMcp(): Promise<ProbeResult> {
  const key = process.env.TERAC_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing TERAC_API_KEY' };
  const url = process.env.TERAC_MCP_URL ?? 'https://terac.com/api/mcp';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, detail: `mcp ${res.status}`, degraded: text.slice(0, 160) };
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('') || text;
    const j = JSON.parse(data) as any;
    const tools: string[] = (j.result?.tools ?? []).map((t: any) => t.name);
    return { ok: true, detail: `${tools.length} MCP tools`, extra: { tools, url } };
  } catch (e) {
    return { ok: false, detail: 'mcp unreachable', degraded: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeAnthropic(): Promise<ProbeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing ANTHROPIC_API_KEY' };
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    return res.ok ? { ok: true, detail: 'key valid' } : { ok: false, detail: `anthropic ${res.status}`, degraded: (await res.text()).slice(0, 120) };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeStripe(): Promise<ProbeResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing STRIPE_SECRET_KEY' };
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', { headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` } });
    if (!res.ok) return { ok: false, detail: `stripe ${res.status}`, degraded: (await res.text()).slice(0, 120) };
    const j = (await res.json()) as any;
    return { ok: true, detail: j.livemode ? 'LIVE mode key' : 'test mode', extra: { livemode: Boolean(j.livemode) } };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
}

export async function probe(id: string): Promise<ProbeResult> {
  switch (id) {
    case 'anthropic': return probeAnthropic();
    case 'stripe': return probeStripe();
    case 'composio': return probeComposio();
    case 'terac': return probeTeracMcp();
    default: {
      const spec = INTEGRATIONS.find((i) => i.id === id);
      if (!spec) return { ok: false, detail: 'unknown integration', degraded: id };
      const st = integrationStatus().find((s) => s.id === id)!;
      return { ok: st.ready, detail: st.ready ? 'configured (no live probe for this vendor)' : 'missing required keys' };
    }
  }
}
