/* Kernel client. Every call carries the shared bearer token; in dev Vite proxies /v1 → :4000. */

export const TOKEN_KEY = 'zeroth.kernel_token';
export const VENTURE_KEY = 'zeroth.venture_id';
export const KERNEL_URL_KEY = 'zeroth.kernel_url';

export function kernelToken(): string { return localStorage.getItem(TOKEN_KEY) || 'dev-only-token'; }
export function kernelBase(): string { return localStorage.getItem(KERNEL_URL_KEY) || ''; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, extra: RequestInit = {}): Promise<T> {
  const res = await fetch(`${kernelBase()}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${kernelToken()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...extra,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? `HTTP ${res.status}`, json?.error?.details);
  return json as T;
}

export const api = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),

  health: () => call<{ status: string; driver: string }>('GET', '/health'),
  createVenture: (b: unknown) => call<{ venture_id: string; trace_id: string; first_work_order_id: string | null; sse_url: string }>('POST', '/v1/ventures', b),
  venture: (id: string) => call<any>('GET', `/v1/ventures/${id}`),
  timeline: (id: string, q = '') => call<{ events: KernelEvent[]; latest_seq: number }>('GET', `/v1/ventures/${id}/timeline${q}`),
  settings: (id: string) => call<{ settings: VentureSettings }>('GET', `/v1/ventures/${id}/settings`),
  updateSettings: (id: string, patch: unknown) => call<{ settings: VentureSettings }>('PUT', `/v1/ventures/${id}/settings`, patch),
  grantWorkspace: (id: string, b: { workspace_root: string; source: string }) => call<{ settings: VentureSettings; workspace_root: string }>('POST', `/v1/ventures/${id}/workspace`, b),
  gates: (id: string, status?: string) => call<{ gates: Gate[] }>('GET', `/v1/gates?venture_id=${id}${status ? `&status=${status}` : ''}`),
  decide: (gateId: string, b: { option_id: string; decided_by: string; decision: 'approve' | 'reject' | 'redirect'; note?: string }) => call<Gate>('POST', `/v1/gates/${gateId}/decision`, b),
  ask: (id: string, dept: string, question: string) => call<{ answer: string; source: 'llm' | 'facts'; facts: any; department_ids: string[] }>('POST', `/v1/ventures/${id}/departments/${dept}/ask`, { question }),
  facts: (id: string, dept: string) => call<{ department_ids: string[]; facts: any }>('GET', `/v1/ventures/${id}/departments/${dept}/facts`),
  agents: (id: string, dept?: string) => call<{ agents: AgentReport[] }>('GET', `/v1/ventures/${id}/agents${dept ? `?department=${dept}` : ''}`),
  goals: (id: string) => call<any>('GET', `/v1/ventures/${id}/goals`),
  briefing: (id: string) => call<{ briefing: any | null }>('GET', `/v1/ventures/${id}/briefing/latest`),
  artifacts: (id: string, q = '') => call<{ artifacts: any[] }>('GET', `/v1/ventures/${id}/artifacts${q}`),
  startMeeting: (id: string, kind: string) => call<any>('POST', `/v1/ventures/${id}/meetings/${kind}/start`),
  endMeeting: (id: string, kind: string) => call<any>('POST', `/v1/ventures/${id}/meetings/${kind}/end`),
  dailyBriefing: (id: string, b: unknown = {}) => call<any>('POST', `/v1/ventures/${id}/daily-briefing`, b),
  chat: (id: string, b: { room: string; text: string; author?: string; department_id?: string }) => call<any>('POST', `/v1/ventures/${id}/chat`, b),
  wallets: (id: string) => call<any>('GET', `/v1/ventures/${id}/wallets`),
  topup: (id: string, amount_usd: number) => call<{ url: string; driver: string }>('POST', `/v1/ventures/${id}/wallets/topup`, { amount_usd, success_url: `${location.origin}/?topup=success`, cancel_url: `${location.origin}/?topup=cancel` }),
  budgets: (id: string) => call<any>('GET', `/v1/budgets/${id}`),
  integrations: () => call<{ integrations: IntegrationStatus[]; tools_driver: string; llm_driver: string }>('GET', '/v1/integrations'),
  probe: (integrationId: string) => call<{ ok: boolean; detail: string; degraded?: string; extra?: any }>('POST', `/v1/integrations/${integrationId}/probe`),
  setVar: (env: string, value: string) => call<{ env: string; configured: boolean }>('PUT', `/v1/integrations/vars/${env}`, { value }),
  linqTest: (b: { to?: string; text?: string; venture_id?: string }) => call<{ ok: boolean; detail: string; degraded?: string; to: string }>('POST', '/v1/integrations/linq/test-message', b),
  linqConfirm: (venture_id: string, confirmed: boolean) => call<any>('POST', '/v1/integrations/linq/confirm', { venture_id, confirmed }),
  consentText: () => call<{ version: string; text: string }>('GET', '/v1/voice/consent-text'),
  voiceConsent: (id: string, b: { accepted: boolean; display_name?: string }) => call<{ consent_event_id: string }>('POST', `/v1/ventures/${id}/voice/consent`, b),
  voiceClone: (id: string, b: { audio_base64: string; mime_type: string; name?: string; duration_s?: number }) => call<{ voice_id: string; driver: string; degraded?: string }>('POST', `/v1/ventures/${id}/voice/clone`, b),
  voiceRevoke: (id: string) => call<{ deleted: boolean; degraded?: string }>('POST', `/v1/ventures/${id}/voice/revoke`, {}),
  workOrders: (id: string) => call<{ work_orders: any[] }>('GET', `/v1/ventures/${id}/work-orders`),
  killSwitch: (venture_id: string, on: boolean) => call<any>('POST', '/v1/kill-switch', { venture_id, on, actor: 'founder' }),
};

/* ── types (mirrors packages/contracts; kept loose on purpose) ────────────── */
export interface KernelEvent {
  seq: number; id?: string; ts: string; type: string; actor_kind?: string; actor_id: string; department_id?: string | null;
  payload: any; trace_id: string; correlation_id?: string | null;
}
export interface Gate {
  id: string; venture_id: string; gate_type: string; requested_by: string; department_id: string;
  action: { tool: string; args: Record<string, unknown> }; preview: Record<string, any>;
  options: Array<{ id: string; label: string; consequence: string }>; suggested_option_id?: string;
  amount_usd?: number; risk: 'low' | 'medium' | 'high'; reversible: boolean; channel: 'linq' | 'boardroom' | 'auto';
  timeout_s: number; on_timeout: string; status: string; opened_at: string; expires_at: string; decided_by?: string; decided_option_id?: string; decision_note?: string;
}
export interface AgentReport {
  agent_id: string; department_id: string; role?: string; model?: string; status: 'working' | 'idle';
  current: { task: string; since: string; work_order_id?: string } | null;
  history: Array<{ task: string; since: string; until: string; outcome: string }>;
  tools: Record<string, number>; last_seen: string | null; runs: number;
}
export interface IntegrationStatus {
  id: string; name: string; tier: string; purpose: string; powers: string; ready: boolean;
  vars: Array<{ env: string; label: string; required: boolean; configured: boolean; secret: boolean; hint?: string; masked?: string }>;
}
export interface VentureSettings {
  workspace: { workspace_root?: string; agency_workspace_path?: string; source: string; granted_at?: string; permissions: string[] };
  meetings: { timezone: string; work_start: string; work_end: string; exec_meeting_time: string; exec_meeting_minutes: number; all_hands_time: string; all_hands_minutes: number; improvement_time: string; days: string[] };
  voice: { consent_given: boolean; consent_at?: string; consent_event_id?: string; voice_id?: string; voice_name?: string; status: string; sample_meta?: any; revoked_at?: string };
  integrations_ack: string[];
  linq_test_message?: { sent_at: string; delivered: boolean; confirmed_by_founder: boolean; degraded?: string };
  founder_notes: string;
}
