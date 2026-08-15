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
}

export const INTEGRATIONS: IntegrationSpec[] = [
  { id: 'anthropic', name: 'Anthropic Claude', tier: 'core', purpose: 'The brains of every department head, worker and critic.', powers: 'All agents (Sonnet only)',
    vars: [{ env: 'ANTHROPIC_API_KEY', label: 'API key', required: true, hint: 'console.anthropic.com → API keys' }] },
  { id: 'linq', name: 'Linq', tier: 'sponsor', purpose: 'Founder phone approvals: gates and alerts arrive as iMessage cards you can reply to.', powers: 'Gates with channel=linq, HELLO test, new-capability approvals',
    vars: [
      { env: 'LINQ_API_KEY', label: 'API key', required: true },
      { env: 'FOUNDER_PHONE', label: 'Founder phone (E.164)', required: true, secret: false, hint: '+16505551234' },
      { env: 'LINQ_FROM_NUMBER', label: 'Linq sender number', required: false, secret: false },
      { env: 'LINQ_WEBHOOK_SECRET', label: 'Webhook secret', required: false },
    ] },
  { id: 'terac', name: 'Terac (MCP)', tier: 'sponsor', purpose: 'The human-labor layer: when agents hit a wall the company hires real experts. MCP-first, REST fallback.', powers: 'D11 HR requisitions, feasibility, launches, submissions',
    vars: [
      { env: 'TERAC_API_KEY', label: 'API key (also the MCP bearer)', required: true },
      { env: 'TERAC_MCP_URL', label: 'MCP URL', required: false, secret: false, hint: 'defaults to https://terac.com/api/mcp' },
      { env: 'TERAC_BASE_URL', label: 'REST base URL (fallback)', required: false, secret: false },
    ] },
  { id: 'stripe', name: 'Stripe', tier: 'sponsor', purpose: 'Money in: payment links + webhooks; wallet top-ups for the agents\' budget.', powers: 'D10 Sales, D11 Treasury, agent wallets',
    vars: [
      { env: 'STRIPE_SECRET_KEY', label: 'Secret key (test mode)', required: true, hint: 'sk_test_…' },
      { env: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable key', required: false, secret: false },
      { env: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook secret', required: false, hint: 'stripe listen --forward-to localhost:4000/v1/webhooks/stripe' },
    ] },
  { id: 'composio', name: 'Composio', tier: 'sponsor', purpose: 'Gmail / Calendar / GitHub / Vercel / other SaaS on behalf of the company. Outbound email, repo pushes and deploys stay behind gates.', powers: 'gmail, calendar, github, vercel through Composio connected accounts',
    vars: [
      { env: 'COMPOSIO_API_KEY', label: 'API key', required: true, hint: 'app.composio.dev' },
      { env: 'COMPOSIO_ENTITY_ID', label: 'Entity ID (per founder)', required: false, secret: false, hint: 'created when you connect Gmail' },
    ] },
  { id: 'elevenlabs', name: 'ElevenLabs', tier: 'sponsor', purpose: 'Voice: consented founder voice clone, phone calls with AI disclosure, transcription.', powers: 'D04 discovery calls, D10 sales calls',
    vars: [
      { env: 'ELEVENLABS_API_KEY', label: 'API key', required: true },
      { env: 'ELEVENLABS_VOICE_ID', label: 'Cloned voice ID', required: false, secret: false, hint: 'set after consent + clone' },
      { env: 'ELEVENLABS_AGENT_ID', label: 'Conversational agent ID', required: false, secret: false },
      { env: 'ELEVENLABS_PHONE_NUMBER_ID', label: 'Phone number ID', required: false, secret: false },
    ] },
  { id: 'solari', name: 'Solari (Pinetree)', tier: 'sponsor', purpose: 'Computer/browser use: the company\'s hands for account creation, forms, and web tasks. Stops at 2FA/CAPTCHA/ToS/payment walls and asks you.', powers: 'solari.browse/act/extract/screenshot',
    vars: [
      { env: 'SOLARI_API_KEY', label: 'API key', required: true },
      { env: 'SOLARI_BASE_URL', label: 'Base URL', required: false, secret: false },
    ] },
  { id: 'band', name: 'Band', tier: 'sponsor', purpose: 'Group chats per department where agents plan; the executive-briefing room.', powers: 'band.publish, dept chat rooms',
    vars: [
      { env: 'BAND_API_KEY', label: 'API key', required: true },
      { env: 'BAND_BASE_URL', label: 'Base URL', required: false, secret: false },
      { env: 'BAND_WORKSPACE_ID', label: 'Workspace ID', required: false, secret: false },
    ] },
  { id: 'render', name: 'Render', tier: 'sponsor', purpose: 'Deploy the built product (deploy gate).', powers: 'render.deploy',
    vars: [{ env: 'RENDER_API_KEY', label: 'API key', required: true }, { env: 'RENDER_OWNER_ID', label: 'Owner ID', required: false, secret: false }] },
  { id: 'vercel', name: 'Vercel', tier: 'sponsor', purpose: 'Frontend hosting for the venture. Prefer Composio-connected Vercel; direct token is supported for deployment status/config.', powers: 'vercel.deploy, production frontend URLs',
    vars: [
      { env: 'VERCEL_TOKEN', label: 'Vercel token', required: false },
      { env: 'VERCEL_TEAM_ID', label: 'Team ID', required: false, secret: false },
      { env: 'VERCEL_PROJECT_ID', label: 'Project ID', required: false, secret: false },
    ] },
  { id: 'replay', name: 'Replay', tier: 'sponsor', purpose: 'Autonomous QA with time-travel recordings; runs before every deploy so buggy code never ships.', powers: 'replay.run_suite',
    vars: [{ env: 'REPLAY_API_KEY', label: 'API key', required: true }] },
  { id: 'github', name: 'GitHub', tier: 'core', purpose: 'Repo work for the venture the company builds.', powers: 'github.push',
    vars: [{ env: 'GITHUB_TOKEN', label: 'Personal access token', required: true }, { env: 'GITHUB_ORG', label: 'Org / owner', required: false, secret: false }] },
  { id: 'business_tools', name: 'Business tools gateway', tier: 'optional', purpose: 'Leadgen / CRM / support / metrics gateway.', powers: 'leadgen.*, crm.upsert, support.upsert_ticket, metrics.record_signal',
    vars: [{ env: 'BUSINESS_TOOLS_URL', label: 'Gateway URL', required: true, secret: false }, { env: 'BUSINESS_TOOLS_API_KEY', label: 'Gateway key', required: false }] },
  { id: 'whop', name: 'Whop', tier: 'optional', purpose: 'Consumer/community revenue rail.', powers: 'whop.create_checkout',
    vars: [{ env: 'WHOP_API_KEY', label: 'API key', required: true }, { env: 'WHOP_COMPANY_ID', label: 'Company ID', required: false, secret: false }] },
  { id: 'dodo', name: 'Dodo Payments', tier: 'optional', purpose: 'Merchant-of-record for non-US ventures.', powers: 'dodo.create_checkout',
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
    return { id: i.id, name: i.name, tier: i.tier, purpose: i.purpose, powers: i.powers, ready: vars.filter((v) => v.required).every((v) => v.configured), vars };
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

export async function probeComposio(): Promise<ProbeResult> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return { ok: false, detail: 'not configured', degraded: 'missing COMPOSIO_API_KEY' };
  const entity = process.env.COMPOSIO_ENTITY_ID;
  try {
    const url = new URL('https://backend.composio.dev/api/v1/connectedAccounts');
    if (entity) url.searchParams.set('user_uuid', entity);
    const res = await fetch(url, { headers: { 'x-api-key': key } });
    if (!res.ok) return { ok: false, detail: `composio ${res.status}`, degraded: (await res.text()).slice(0, 160) };
    const j = (await res.json()) as any;
    const items: any[] = j.items ?? j.connectedAccounts ?? j.data ?? [];
    const apps = items.map((i) => String(i.appName ?? i.appUniqueId ?? i.integrationId ?? '').toLowerCase());
    return { ok: true, detail: `${items.length} connected account(s)`, extra: { apps, gmail: apps.some((a) => a.includes('gmail')), calendar: apps.some((a) => a.includes('calendar')), github: apps.some((a) => a.includes('github')), vercel: apps.some((a) => a.includes('vercel')), entity_id: entity ?? null } };
  } catch (e) {
    return { ok: false, detail: 'network error', degraded: e instanceof Error ? e.message : String(e) };
  }
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
