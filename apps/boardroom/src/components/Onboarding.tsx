import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { IntegrationsList } from './IntegrationsPanel';
import { WorkspacePicker } from './WorkspacePicker';
import { ConsentBox } from './VoicePanel';
import { VoiceRecorder } from './VoiceRecorder';
import { toE164 } from '../lib/phone';

/**
 * Onboarding: founder → idea or autonomous → budget →
 * workspace folder → schedule → integrations (Composio etc.) → voice consent →
 * launch. Everything lands in POST /v1/ventures (+ settings) and the HQ opens
 * with the SSE stream live.
 */
const STEPS = ['You', 'Idea', 'Budget', 'Workspace', 'Schedule', 'Integrations', 'Voice', 'Launch'] as const;
const TZ_GUESS = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Module-level so React keeps the same component identity across renders;
// defining it inside Onboarding remounted every input on each keystroke
// (focus jumped back to the autoFocus field, typed text landed in Name).

/** Declared at module scope so typing never remounts the input (a component created inside render loses focus on every keystroke). */
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span className="spec muted">{label}</span>{children}</label>; }


const DRAFT_IDENTITY_KEY = 'zeroth.draft_composio_identity';

/** GitHub's mark — inline so the button carries the brand with no asset fetch. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor" style={{ flex: '0 0 auto' }}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Connect GitHub before the venture even exists: OAuth against a client-generated
 * draft identity (no venture_id yet), carried into the venture at launch via
 * settings.composio_identity so the connection survives — the founder never
 * has to reconnect. Lets auto-build push straight to their own GitHub.
 */
function GithubConnect({ identity }: { identity: string }) {
  const { toast } = useStore();
  const [state, setState] = useState<{ connected: boolean; busy: boolean; checked: boolean }>({ connected: false, busy: true, checked: false });
  const check = async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const r = await api.onboardingComposioToolkits(identity);
      const gh = r.toolkits.find((t) => t.slug === 'github');
      setState({ connected: Boolean(gh?.connected), busy: false, checked: true });
    } catch { setState((s) => ({ ...s, busy: false, checked: true })); }
  };
  useEffect(() => { void check(); }, [identity]);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('composio_connected') === 'github') { toast('GitHub connected', 'ok'); void check(); history.replaceState({}, '', location.pathname); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const connect = async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      const r = await api.onboardingComposioConnect(identity, 'github', `${location.origin}${location.pathname}?onboarding=1`);
      window.open(r.redirect_url, '_blank', 'noopener');
      toast('Finish authorizing GitHub in the new tab, then come back here', 'ok');
    } catch (e: any) {
      toast(e?.message?.length > 100 ? 'Composio: could not start the connection' : (e?.message ?? 'connect failed'), 'error');
    } finally { setState((s) => ({ ...s, busy: false })); }
  };
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <GithubMark />
        <b>GitHub</b>
        {!state.checked ? <span className="chip">checking…</span> : <span className={`chip ${state.connected ? 'ok' : 'warn'}`}>{state.connected ? 'connected' : 'not connected'}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={connect} disabled={state.busy}>{state.busy ? '…' : state.connected ? 'Reconnect' : 'Connect GitHub'}</button>
        <button className="btn sm ghost" onClick={check} disabled={state.busy}>Re-check</button>
      </div>
      <div className="small muted mt">When you bring an idea, Build (D07) auto-generates a first working version and pushes it here — to <b>your own</b> GitHub — as soon as it's ready. Skip this and it lands in the company's own GitHub instead.</div>
    </div>
  );
}

/** Stripe's wordmark 'S' — inline so the button carries the brand with no asset fetch. */
function StripeMark() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <rect width="32" height="32" rx="6" fill="#635BFF" />
      <path fill="#fff" d="M15.1 12.3c0-.7.6-1 1.5-1 1.3 0 3 .4 4.3 1.1V8.6a11.4 11.4 0 0 0-4.3-.8c-3.5 0-5.9 1.8-5.9 4.9 0 4.7 6.5 4 6.5 6 0 .8-.7 1.1-1.7 1.1-1.4 0-3.3-.6-4.7-1.4v3.9c1.6.7 3.2 1 4.7 1 3.6 0 6.1-1.8 6.1-4.9 0-5.1-6.5-4.3-6.5-6.1Z" />
    </svg>
  );
}

/**
 * Connect Stripe from onboarding: opens the founder's Stripe dashboard to grab a
 * key, takes the paste, writes it to .env via the kernel, then live-probes it.
 * (Full Stripe Connect OAuth needs a platform client_id we don't have; this is
 * the same end state — an authenticated key the Treasury can spend against.)
 */
function StripeConnect({ limits, onLimits }: { limits: { total_usd: number; monthly_usd: number }; onLimits: (l: { total_usd: number; monthly_usd: number }) => void }) {
  const [st, setSt] = useState<{ connected: boolean; detail: string; busy: boolean; editing: boolean; key: string }>({ connected: false, detail: '', busy: true, editing: false, key: '' });
  const check = async () => {
    setSt((s) => ({ ...s, busy: true }));
    try { const r = await api.probe('stripe'); setSt((s) => ({ ...s, connected: r.ok, detail: r.ok ? r.detail : (r.degraded ?? r.detail), busy: false })); }
    catch (e: any) { setSt((s) => ({ ...s, connected: false, detail: e?.message ?? 'probe failed', busy: false })); }
  };
  useEffect(() => { void check(); }, []);
  const save = async () => {
    if (!st.key.trim()) return;
    setSt((s) => ({ ...s, busy: true }));
    try { await api.setVar('STRIPE_SECRET_KEY', st.key.trim()); setSt((s) => ({ ...s, key: '', editing: false })); await check(); }
    catch (e: any) { setSt((s) => ({ ...s, busy: false, detail: e?.message ?? 'save failed' })); }
  };
  return (
    <div className="card">
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <StripeMark />
        <b>Stripe</b>
        {st.busy ? <span className="chip">checking…</span> : <span className={`chip ${st.connected ? 'ok' : 'warn'}`}>{st.connected ? `connected · ${st.detail}` : 'not connected'}</span>}
        <span style={{ flex: 1 }} />
        <a className="btn" href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noreferrer noopener">Open my Stripe →</a>
        <button className="btn primary" onClick={() => setSt((s) => ({ ...s, editing: !s.editing }))} disabled={st.busy}>{st.connected ? 'Replace key' : 'Connect Stripe'}</button>
        <button className="btn sm ghost" onClick={check} disabled={st.busy}>Re-test</button>
      </div>
      {st.editing && (
        <div className="row wrap mt" style={{ gap: 8 }}>
          <input className="input" type="password" placeholder="sk_test_…" value={st.key} autoFocus style={{ flex: 1, minWidth: 240 }}
            onChange={(e) => setSt((s) => ({ ...s, key: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setSt((s) => ({ ...s, editing: false, key: '' })); }} />
          <button className="btn primary" onClick={save} disabled={st.busy || !st.key.trim()}>Save & verify</button>
        </div>
      )}
      <div className="grid2 mt">
        <Field label="Total Stripe spend limit (USD)">
          <input className="input" type="number" min={0} max={100000} value={limits.total_usd}
            onChange={(e) => onLimits({ ...limits, total_usd: Number(e.target.value) })} />
        </Field>
        <Field label="Per-month limit (USD · 0 = no monthly cap)">
          <input className="input" type="number" min={0} max={100000} value={limits.monthly_usd}
            onChange={(e) => onLimits({ ...limits, monthly_usd: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="small muted mt">Stripe funds wallet top-ups for the agents' budget and collects revenue in D10/D11. The <b>total</b> limit is the wallet cap Treasury splits across departments; the <b>monthly</b> limit blocks any top-up that would push this calendar month's funding past it. Use a <b>test-mode</b> key (<span className="mono">sk_test_…</span>) — the key is written to <span className="kbd">.env</span> on this machine and never displayed again. Money out still asks you first.</div>
    </div>
  );
}

export function Onboarding({ onDone, initialProfile }: { onDone: () => void; initialProfile?: { display_name?: string; email?: string } }) {
  const { setVentureId, ventureId, toast, kernelOk } = useStore();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ display_name: initialProfile?.display_name ?? '', email: initialProfile?.email ?? '', phone: '', timezone: TZ_GUESS, background: '' });
  const [mode, setMode] = useState<'founder_led' | 'autonomous_origination'>('founder_led');
  const [idea, setIdea] = useState('');
  const [caps, setCaps] = useState({ spend_cap_usd: 50, monthly_cap_usd: 0, terac_cap_usd: 200, autonomy: 'supervised' as 'copilot' | 'supervised' | 'autonomous' });
  // Stable across the onboarding session so a toolkit connected pre-launch (GitHub, typically)
  // is still there when the venture is created — carried over via settings.composio_identity.
  const [draftIdentity] = useState(() => {
    const existing = localStorage.getItem(DRAFT_IDENTITY_KEY);
    if (existing) return existing;
    const id = `zeroth-draft-${crypto.randomUUID()}`;
    localStorage.setItem(DRAFT_IDENTITY_KEY, id);
    return id;
  });
  const [ws, setWs] = useState({ path: '', source: 'typed' as 'typed' | 'picker' });
  const [sched, setSched] = useState({ timezone: TZ_GUESS, work_start: '09:00', work_end: '17:00', exec_meeting_time: '07:00', exec_meeting_minutes: 30, all_hands_time: '09:00', all_hands_minutes: 15, improvement_time: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  const [voice, setVoice] = useState<{ agree: boolean; text: string; sample: any | null }>({ agree: false, text: '', sample: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ venture_id: string; first_work_order_id: string | null; trace_id: string } | null>(null);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const phoneE164 = useMemo(() => toE164(f.phone), [f.phone]);
  const phoneOk = /^\+[1-9]\d{6,14}$/.test(phoneE164);
  useEffect(() => { api.consentText().then((r) => setVoice((v) => ({ ...v, text: r.text }))).catch(() => undefined); }, []);
  useEffect(() => { setSched((s) => ({ ...s, timezone: f.timezone })); }, [f.timezone]);

  const canNext = [f.display_name.trim().length > 1, mode === 'autonomous_origination' || idea.trim().length > 12, true, true, true, true, true, true][step];




  const launch = async () => {
    setBusy(true); setLaunchLog([]);
    const log = (s: string) => setLaunchLog((l) => [...l, s]);
    try {
      const founder_profile = { display_name: f.display_name.trim(), email: f.email.trim() || undefined, phone_e164: phoneOk ? phoneE164 : undefined, timezone: f.timezone, background: f.background };
      const body: any = {
        mode, founder_profile, autonomy_level: caps.autonomy, spend_cap_usd: caps.spend_cap_usd, terac_cap_usd: caps.terac_cap_usd,
        name: mode === 'founder_led' ? idea.trim().slice(0, 40) : `${f.display_name.split(' ')[0]}'s autonomous venture`,
        settings: { meetings: sched, integrations_ack: [], founder_notes: '', spend_limits: { total_usd: caps.spend_cap_usd, monthly_usd: caps.monthly_cap_usd }, composio_identity: draftIdentity },
        workspace_root: ws.path.trim() || undefined, agency_workspace_path: ws.path.trim() || undefined, workspace_source: ws.source,
      };
      if (mode === 'founder_led') {
        body.idea_seed = { raw_statement: idea.trim(), normalized: { problem: idea.trim().slice(0, 300), who_hurts: 'to be discovered by D01', current_workaround: 'unknown', proposed_solution: idea.trim().slice(0, 300), business_model_guess: 'unknown', category: 'unknown' }, constraints: [], ambiguities: ['founder statement not yet normalized'] };
      }
      log('Creating venture…');
      const r = await api.createVenture(body);
      setResult(r); log(`Venture ${r.venture_id.slice(0, 8)} · first work order ${r.first_work_order_id?.slice(0, 8) ?? '—'} → ${mode === 'founder_led' ? 'D01 normalize_idea' : 'D01 originate_opportunities'}`);
      if (voice.agree) { log('Recording voice consent…'); await api.voiceConsent(r.venture_id, { accepted: true, display_name: f.display_name }); if (voice.sample) { log('Cloning voice…'); const c = await api.voiceClone(r.venture_id, { audio_base64: voice.sample.audio_base64, mime_type: voice.sample.mime_type, duration_s: voice.sample.duration_s, name: `${f.display_name} voice` }).catch((e) => ({ voice_id: '', driver: 'error', degraded: e.message })); log(`Voice: ${c.voice_id ? `cloned (${c.driver})` : c.degraded}`); } }
      log('Ready. Open the HQ when you want the SSE stream to connect.');
    } catch (e: any) { log(`Error: ${e.message}`); toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const openHq = () => {
    if (!result?.venture_id) return;
    setVentureId(result.venture_id);
    onDone();
  };

  const twentyFourSeven = sched.work_start === '00:00' && sched.work_end === '23:59' && ALL_DAYS.every((d) => sched.days.includes(d));

  return (
    <div className="onboard">
      <aside className="onboard-side">
        <div><div className="brand">YCBF</div><div className="spec muted">The AI-run company · onboarding</div></div>
        <div className="steps">
          {STEPS.map((s, i) => <button key={s} className={`${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => i <= step && setStep(i)}><span className="n">{i < step ? '✓' : i + 1}</span>{s}</button>)}
        </div>
        <div className="small muted" style={{ marginTop: 'auto' }}>
          <div className="row"><span className={`dot ${kernelOk ? 'live' : kernelOk === false ? 'off' : ''}`} /> kernel {kernelOk ? 'connected' : kernelOk === false ? 'offline' : '…'}</div>
          {ventureId && <button className="btn sm mt" onClick={onDone}>Skip → open existing HQ</button>}
        </div>
      </aside>
      <main className="onboard-main">
        <div className="onboard-body">
          {step === 0 && (<>
            <h1>Who is the founder?</h1>
            <p className="lede">YCBF builds a company around <i>you</i>: it interviews you, researches the market, calls people in your voice, builds, sells, and hires humans when it must. It needs to know who it works for.</p>
            <div className="grid2">
              <Field label="Name"><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Ada Lovelace" autoFocus /></Field>
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ada@example.com" /></Field>
              <Field label="Timezone"><input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} list="tzs" /><datalist id="tzs">{['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'].map((t) => <option key={t} value={t} />)}</datalist></Field>
              <Field label="Mobile number (optional)"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1 650 555 0123" /></Field>
              <Field label="Background (optional)"><input className="input" value={f.background} onChange={(e) => setF({ ...f, background: e.target.value })} placeholder="ex-nurse, sold B2B SaaS…" /></Field>
            </div>
          </>)}
          {step === 1 && (<>
            <h1>Bring an idea — or none at all.</h1>
            <p className="lede">Founder-led: you describe the idea and Intake (D01) normalizes it, then Office Hours asks one sharp GStack-style question at a time. Autonomous: D01 originates opportunities, D02 stress-tests the generated idea, and you approve before market research starts.</p>
            <div className="opt" onClick={() => setMode('founder_led')}><span className={`rad ${mode === 'founder_led' ? '' : ''}`} style={{ background: mode === 'founder_led' ? 'radial-gradient(var(--filament) 45%, transparent 50%)' : 'transparent', borderColor: mode === 'founder_led' ? 'var(--filament)' : undefined }} /><div><b>I have an idea</b><div className="small muted">Even a rough one. The company sharpens it against evidence.</div></div></div>
            <div className="opt" onClick={() => setMode('autonomous_origination')}><span className="rad" style={{ background: mode === 'autonomous_origination' ? 'radial-gradient(var(--filament) 45%, transparent 50%)' : 'transparent', borderColor: mode === 'autonomous_origination' ? 'var(--filament)' : undefined }} /><div><b>Find one for me (autonomous origination)</b><div className="small muted">D01 mines pain signals and proposes candidates; you approve the niche.</div></div></div>
            {mode === 'founder_led' && <textarea className="textarea" placeholder="Dental clinics with 2–5 chairs lose patients between visits; I want an automatic recall-reminder service they can turn on in 10 minutes…" value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus />}
          </>)}
          {step === 2 && (<>
            <h1>How much can the company spend?</h1>
            <p className="lede">Treasury splits the cap into a wallet per department; every token, tool call and human hire is metered. Departments downgrade models at 80% and freeze at 100%. Money out always asks you first.</p>
            <div className="grid3">
              <Field label="Spend cap (USD)"><input className="input" type="number" min={1} max={10000} value={caps.spend_cap_usd} onChange={(e) => setCaps({ ...caps, spend_cap_usd: Number(e.target.value) })} /></Field>
              <Field label="Terac human-hiring cap (USD)"><input className="input" type="number" min={0} max={10000} value={caps.terac_cap_usd} onChange={(e) => setCaps({ ...caps, terac_cap_usd: Number(e.target.value) })} /></Field>
              <Field label="Autonomy"><select className="select" value={caps.autonomy} onChange={(e) => setCaps({ ...caps, autonomy: e.target.value as any })}><option value="copilot">copilot — ask often</option><option value="supervised">supervised — ask on gates</option><option value="autonomous">autonomous — only money/humans/deploys ask</option></select></Field>
            </div>
            <StripeConnect limits={{ total_usd: caps.spend_cap_usd, monthly_usd: caps.monthly_cap_usd }} onLimits={(l) => setCaps({ ...caps, spend_cap_usd: l.total_usd, monthly_cap_usd: l.monthly_usd })} />
            <div className="card small">Terac hires draft first and only launch (spend) behind a money gate.</div>
          </>)}
          {step === 3 && (<>
            <h1>Choose the workspace this AI company can build inside.</h1>
            <p className="lede">When the plan reaches Build (D07), engineers write real code with Claude — but only in one folder you grant. Replay runs before anything ships.</p>
            <WorkspacePicker value={ws.path} onChange={(p, s) => setWs({ path: p, source: s })} />
            <div className="small muted">You can change this later from Setup. Leave blank to decide when Build starts (Build will pause and ask).</div>
          </>)}
          {step === 4 && (<>
            <h1>When does the company work and meet?</h1>
            <p className="lede">Heads meet the CEO each morning to set goals; the leads address the whole company at the all-hands (every agent gathers in the boardroom); the improvement branch reviews the day after hours.</p>
            <div className="row wrap mb" style={{ gap: 8 }}>
              <button
                className={`btn ${twentyFourSeven ? 'primary' : ''}`}
                onClick={() => setSched({ ...sched, work_start: '00:00', work_end: '23:59', days: ALL_DAYS })}
              >
                24/7 agents
              </button>
              <button
                className={`btn ${!twentyFourSeven ? 'primary' : ''}`}
                onClick={() => setSched({ ...sched, work_start: '09:00', work_end: '17:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })}
              >
                Business hours
              </button>
            </div>
            <div className="grid3">
              <Field label="Timezone"><input className="input" value={sched.timezone} onChange={(e) => setSched({ ...sched, timezone: e.target.value })} list="tzs" /></Field>
              <Field label="Workday starts"><input className="input" type="time" value={sched.work_start} onChange={(e) => setSched({ ...sched, work_start: e.target.value })} /></Field>
              <Field label="Workday ends"><input className="input" type="time" value={sched.work_end} onChange={(e) => setSched({ ...sched, work_end: e.target.value })} /></Field>
              <Field label="Executive meeting (heads + CEO)"><input className="input" type="time" value={sched.exec_meeting_time} onChange={(e) => setSched({ ...sched, exec_meeting_time: e.target.value })} /></Field>
              <Field label="All-hands (whole company)"><input className="input" type="time" value={sched.all_hands_time} onChange={(e) => setSched({ ...sched, all_hands_time: e.target.value })} /></Field>
              <Field label="Improvement branch"><input className="input" type="time" value={sched.improvement_time} onChange={(e) => setSched({ ...sched, improvement_time: e.target.value })} /></Field>
            </div>
            <div className="field"><span className="spec muted">Days</span><div className="row wrap" style={{ gap: 6 }}>{ALL_DAYS.map((d) => <button key={d} className={`btn sm ${sched.days.includes(d) ? 'primary' : ''}`} onClick={() => setSched({ ...sched, days: sched.days.includes(d) ? sched.days.filter((x) => x !== d) : [...sched.days, d] })}>{d}</button>)}</div></div>
          </>)}
          {step === 5 && (<>
            <h1>Connect the company's tools.</h1>
            <p className="lede">GitHub connects right now, before launch, so Build (D07) can push straight to it the moment it has something to ship. Gmail, LinkedIn, Vercel and more connect with a real sign-in too — once launched, open Setup → Integrations for those. Anything not connected degrades to a mock — the company still runs.</p>
            <GithubConnect identity={draftIdentity} />
            <IntegrationsList compact />
          </>)}
          {step === 6 && (<>
            <h1>Lend the company your voice — with consent.</h1>
            <p className="lede">Outreach and Sales place discovery/sales calls in your cloned voice (ElevenLabs). Every call is a gate you approve and always discloses it's an AI. Optional — skip and set it up later.</p>
            <ConsentBox text={voice.text} name={f.display_name} checked={voice.agree} onChange={(v) => setVoice({ ...voice, agree: v })} />
            {voice.agree && <VoiceRecorder onSample={(s) => setVoice({ ...voice, sample: s })} />}
          </>)}
          {step === 7 && (<>
            <h1>Ready to open the doors.</h1>
            <div className="grid2">
              <div className="card"><div className="spec muted">Founder</div><b>{f.display_name}</b><div className="small muted">{f.email || '—'} · {phoneE164}  · {f.timezone}</div></div>
              <div className="card"><div className="spec muted">Mode</div><b>{mode === 'founder_led' ? 'Founder-led' : 'Autonomous origination'}</b><div className="small muted">{mode === 'founder_led' ? idea.slice(0, 120) : 'D01 will originate opportunities'}</div></div>
              <div className="card"><div className="spec muted">Budget</div><b>${caps.spend_cap_usd}</b> spend{caps.monthly_cap_usd > 0 ? ` · $${caps.monthly_cap_usd}/mo cap` : ''} · ${caps.terac_cap_usd} Terac · {caps.autonomy}</div>
              <div className="card"><div className="spec muted">Workspace</div><span className="mono small">{ws.path || 'not granted yet'}</span></div>
              <div className="card"><div className="spec muted">Schedule</div><span className="small">exec {sched.exec_meeting_time} · all-hands {sched.all_hands_time} · work {sched.work_start}–{sched.work_end} · improve {sched.improvement_time} · {sched.days.join(' ')}</span></div>
              <div className="card"><div className="spec muted">Voice</div><span className="small">{voice.agree ? (voice.sample ? 'consent + sample → clone on launch' : 'consent only (record later)') : 'skipped'}</span></div>
            </div>
            {launchLog.length > 0 && <div className="card mono small" style={{ whiteSpace: 'pre-wrap' }}>{launchLog.join('\n')}</div>}
            {result && <div className="card" style={{ borderColor: 'var(--ok)' }}><b>Venture created.</b> <span className="mono small">venture_id {result.venture_id} · first_work_order_id {result.first_work_order_id ?? '—'} · trace {result.trace_id}</span></div>}
          </>)}
        </div>
        <div className="onboard-foot">
          <button className="btn ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>&larr; Back</button>
          <div className="row">
            {step < STEPS.length - 1 ? <button className="btn primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next &rarr;</button> : result ? <button className="btn primary pulse" onClick={openHq}>Open HQ &rarr;</button> : <button className="btn primary pulse" onClick={launch} disabled={busy}>{busy ? 'Launching…' : 'Launch the company'}</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
