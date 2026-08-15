import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { IntegrationsList } from './IntegrationsPanel';
import { WorkspacePicker } from './WorkspacePicker';
import { ConsentBox } from './VoicePanel';
import { VoiceRecorder } from './VoiceRecorder';
import { toE164 } from '../lib/phone';

/**
 * Onboarding: founder → phone (Linq HELLO) → idea or autonomous → budget →
 * workspace folder → schedule → integrations (Composio etc.) → voice consent →
 * launch. Everything lands in POST /v1/ventures (+ settings) and the HQ opens
 * with the SSE stream live.
 */
const STEPS = ['You', 'Phone', 'Idea', 'Budget', 'Workspace', 'Schedule', 'Integrations', 'Voice', 'Launch'] as const;
const TZ_GUESS = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

// Module-level so React keeps the same component identity across renders;
// defining it inside Onboarding remounted every input on each keystroke
// (focus jumped back to the autoFocus field, typed text landed in Name).

/** Declared at module scope so typing never remounts the input (a component created inside render loses focus on every keystroke). */
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span className="spec muted">{label}</span>{children}</label>; }

export function Onboarding({ onDone, initialProfile }: { onDone: () => void; initialProfile?: { display_name?: string; email?: string } }) {
  const { setVentureId, ventureId, toast, kernelOk } = useStore();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ display_name: initialProfile?.display_name ?? '', email: initialProfile?.email ?? '', phone: '', timezone: TZ_GUESS, background: '' });
  const [mode, setMode] = useState<'founder_led' | 'autonomous_origination'>('founder_led');
  const [idea, setIdea] = useState('');
  const [caps, setCaps] = useState({ spend_cap_usd: 50, terac_cap_usd: 200, autonomy: 'supervised' as 'copilot' | 'supervised' | 'autonomous' });
  const [ws, setWs] = useState({ path: '', source: 'typed' as 'typed' | 'picker' });
  const [sched, setSched] = useState({ timezone: TZ_GUESS, work_start: '09:00', work_end: '17:00', exec_meeting_time: '07:00', exec_meeting_minutes: 30, all_hands_time: '09:00', all_hands_minutes: 15, improvement_time: '17:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] });
  const [linq, setLinq] = useState<{ sent: boolean; ok: boolean; detail: string; confirmed: boolean }>({ sent: false, ok: false, detail: '', confirmed: false });
  const [linqBusy, setLinqBusy] = useState(false);
  const [voice, setVoice] = useState<{ agree: boolean; text: string; sample: any | null }>({ agree: false, text: '', sample: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ venture_id: string; first_work_order_id: string | null; trace_id: string } | null>(null);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<{ busy: boolean; status: string }>({ busy: false, status: '' });
  const phoneE164 = useMemo(() => toE164(f.phone), [f.phone]);
  const phoneOk = /^\+[1-9]\d{6,14}$/.test(phoneE164);
  useEffect(() => { api.consentText().then((r) => setVoice((v) => ({ ...v, text: r.text }))).catch(() => undefined); }, []);
  useEffect(() => { setSched((s) => ({ ...s, timezone: f.timezone })); }, [f.timezone]);

  const canNext = [f.display_name.trim().length > 1, true, mode === 'autonomous_origination' || idea.trim().length > 12, true, true, true, true, true, true][step];

  const sendHello = async () => {
    setLinqBusy(true);
    try {
      // FOUNDER_PHONE is written to .env so gates reach this phone from now on.
      await api.setVar('FOUNDER_PHONE', phoneE164).catch(() => undefined);
      const r = await api.linqTest({ to: phoneE164, text: `HELLO ${f.display_name || 'founder'} 👋 — this is Zeroth, your AI company. Approvals and alerts will arrive here. Reply YES to confirm.` });
      setLinq({ sent: true, ok: r.ok, detail: r.ok ? `Sent to ${r.to}` : (r.degraded ?? r.detail), confirmed: false });
      toast(r.ok ? 'HELLO sent — check your phone' : `Linq: ${r.degraded ?? r.detail}`, r.ok ? 'ok' : 'warn');
    } finally { setLinqBusy(false); }
  };

  const launch = async () => {
    setBusy(true); setLaunchLog([]);
    const log = (s: string) => setLaunchLog((l) => [...l, s]);
    try {
      const founder_profile = { display_name: f.display_name.trim(), email: f.email.trim() || undefined, phone_e164: phoneOk ? phoneE164 : undefined, timezone: f.timezone, background: f.background };
      const body: any = {
        mode, founder_profile, autonomy_level: caps.autonomy, spend_cap_usd: caps.spend_cap_usd, terac_cap_usd: caps.terac_cap_usd,
        name: mode === 'founder_led' ? idea.trim().slice(0, 40) : `${f.display_name.split(' ')[0]}'s autonomous venture`,
        settings: { meetings: sched, integrations_ack: [], founder_notes: '' },
        workspace_root: ws.path.trim() || undefined, agency_workspace_path: ws.path.trim() || undefined, workspace_source: ws.source,
      };
      if (mode === 'founder_led') {
        body.idea_seed = { raw_statement: idea.trim(), normalized: { problem: idea.trim().slice(0, 300), who_hurts: 'to be discovered by D01', current_workaround: 'unknown', proposed_solution: idea.trim().slice(0, 300), business_model_guess: 'unknown', category: 'unknown' }, constraints: [], ambiguities: ['founder statement not yet normalized'] };
      }
      log('Creating venture…');
      const r = await api.createVenture(body);
      setResult(r); log(`Venture ${r.venture_id.slice(0, 8)} · first work order ${r.first_work_order_id?.slice(0, 8) ?? '—'} → ${mode === 'founder_led' ? 'D01 normalize_idea' : 'D01 originate_opportunities'}`);
      if (voice.agree) { log('Recording voice consent…'); await api.voiceConsent(r.venture_id, { accepted: true, display_name: f.display_name }); if (voice.sample) { log('Cloning voice…'); const c = await api.voiceClone(r.venture_id, { audio_base64: voice.sample.audio_base64, mime_type: voice.sample.mime_type, duration_s: voice.sample.duration_s, name: `${f.display_name} voice` }).catch((e) => ({ voice_id: '', driver: 'error', degraded: e.message })); log(`Voice: ${c.voice_id ? `cloned (${c.driver})` : c.degraded}`); } }
      if (linq.sent) await api.linqConfirm(r.venture_id, linq.confirmed).catch(() => undefined);
      log('Ready. Open the HQ when you want the SSE stream to connect.');
    } catch (e: any) { log(`Error: ${e.message}`); toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const transferToPhone = async () => {
    if (!result?.venture_id || !phoneOk) return;
    setTransfer({ busy: true, status: 'sending...' });
    try {
      const r = await api.transferOnboardingToPhone(result.venture_id, {
        phone_e164: phoneE164,
        step: STEPS[step].toLowerCase(),
        text: "Let's continue the onboarding process here. I'll ask the next question by text.",
        idempotency_key: `onboarding-transfer-${result.venture_id}-${STEPS[step].toLowerCase()}`,
      });
      setTransfer({ busy: false, status: r.delivery.delivered ? 'sent to phone' : (r.delivery.degraded ?? 'not delivered') });
      toast(r.delivery.delivered ? 'Onboarding transferred to phone' : `Phone transfer: ${r.delivery.degraded ?? 'not delivered'}`, r.delivery.delivered ? 'ok' : 'warn');
    } catch (e: any) {
      setTransfer({ busy: false, status: e.message });
      toast(e.message, 'error');
    }
  };
  const openHq = () => {
    if (!result?.venture_id) return;
    setVentureId(result.venture_id);
    onDone();
  };

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  return (
    <div className="onboard">
      <aside className="onboard-side">
        <div><div className="brand">Zeroth</div><div className="spec muted">The AI-run company · onboarding</div></div>
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
            <p className="lede">Zeroth builds a company around <i>you</i>: it interviews you, researches the market, calls people in your voice, builds, sells, and hires humans when it must. It needs to know who it works for.</p>
            <div className="grid2">
              <Field label="Name"><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} placeholder="Ada Lovelace" autoFocus /></Field>
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ada@example.com" /></Field>
              <Field label="Timezone"><input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} list="tzs" /><datalist id="tzs">{['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'].map((t) => <option key={t} value={t} />)}</datalist></Field>
              <Field label="Background (optional)"><input className="input" value={f.background} onChange={(e) => setF({ ...f, background: e.target.value })} placeholder="ex-nurse, sold B2B SaaS…" /></Field>
            </div>
          </>)}
          {step === 1 && (<>
            <h1>Your phone is the approval channel.</h1>
            <p className="lede">Anything that spends money, contacts a real person, deploys, or builds something new pauses for you. Those decisions arrive as iMessage cards via <b>Linq</b>; you reply to approve. Let's make sure it reaches you.</p>
            <div className="grid2">
              <Field label="Mobile number"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1 650 555 0123" autoFocus /></Field>
              <div className="field"><span className="spec muted">Normalized (E.164)</span><div className="pathbox">{phoneE164 || '—'} {phoneOk ? '✓' : ''}</div></div>
            </div>
            <div className="card">
              <div className="row wrap" style={{ gap: 10 }}>
                <button className="btn primary" disabled={!phoneOk || linqBusy} onClick={sendHello}>{linqBusy ? 'Sending…' : 'Send me a HELLO text'}</button>
                {linq.sent && <span className={`chip ${linq.ok ? 'ok' : 'err'}`}>{linq.detail}</span>}
              </div>
              {linq.sent && linq.ok && <label className="opt check on mt" style={{ cursor: 'pointer' }} onClick={() => setLinq({ ...linq, confirmed: !linq.confirmed })}><span className="rad" style={{ background: linq.confirmed ? 'var(--filament)' : 'transparent' }} /><span>I got the HELLO on my phone {linq.confirmed ? '✓' : ''}</span></label>}
              {linq.sent && !linq.ok && <div className="small muted mt">Linq isn't configured yet (LINQ_API_KEY) — you can add it in the Integrations step; approvals still work in the Boardroom meanwhile.</div>}
              <div className="small muted mt">Optional: skip phone for now. Money, outreach and deploy gates will stay in the Boardroom until Linq is connected.</div>
            </div>
          </>)}
          {step === 2 && (<>
            <h1>Bring an idea — or none at all.</h1>
            <p className="lede">Founder-led: you describe the idea and Intake (D01) normalizes it, then Office Hours asks one sharp GStack-style question at a time. Autonomous: D01 originates opportunities, D02 stress-tests the generated idea, and you approve before market research starts.</p>
            <div className="opt" onClick={() => setMode('founder_led')}><span className={`rad ${mode === 'founder_led' ? '' : ''}`} style={{ background: mode === 'founder_led' ? 'radial-gradient(var(--filament) 45%, transparent 50%)' : 'transparent', borderColor: mode === 'founder_led' ? 'var(--filament)' : undefined }} /><div><b>I have an idea</b><div className="small muted">Even a rough one. The company sharpens it against evidence.</div></div></div>
            <div className="opt" onClick={() => setMode('autonomous_origination')}><span className="rad" style={{ background: mode === 'autonomous_origination' ? 'radial-gradient(var(--filament) 45%, transparent 50%)' : 'transparent', borderColor: mode === 'autonomous_origination' ? 'var(--filament)' : undefined }} /><div><b>Find one for me (autonomous origination)</b><div className="small muted">D01 mines pain signals and proposes candidates; you approve the niche.</div></div></div>
            {mode === 'founder_led' && <textarea className="textarea" placeholder="Dental clinics with 2–5 chairs lose patients between visits; I want an automatic recall-reminder service they can turn on in 10 minutes…" value={idea} onChange={(e) => setIdea(e.target.value)} autoFocus />}
          </>)}
          {step === 3 && (<>
            <h1>How much can the company spend?</h1>
            <p className="lede">Treasury splits the cap into a wallet per department; every token, tool call and human hire is metered. Departments downgrade models at 80% and freeze at 100%. Money out always asks you first.</p>
            <div className="grid3">
              <Field label="Spend cap (USD)"><input className="input" type="number" min={1} max={10000} value={caps.spend_cap_usd} onChange={(e) => setCaps({ ...caps, spend_cap_usd: Number(e.target.value) })} /></Field>
              <Field label="Terac human-hiring cap (USD)"><input className="input" type="number" min={0} max={10000} value={caps.terac_cap_usd} onChange={(e) => setCaps({ ...caps, terac_cap_usd: Number(e.target.value) })} /></Field>
              <Field label="Autonomy"><select className="select" value={caps.autonomy} onChange={(e) => setCaps({ ...caps, autonomy: e.target.value as any })}><option value="copilot">copilot — ask often</option><option value="supervised">supervised — ask on gates</option><option value="autonomous">autonomous — only money/humans/deploys ask</option></select></Field>
            </div>
            <div className="card small">Stripe funds top-ups later from the Wallets panel (test mode). Terac hires draft first and only launch (spend) behind a money gate.</div>
          </>)}
          {step === 4 && (<>
            <h1>Choose the workspace this AI company can build inside.</h1>
            <p className="lede">When the plan reaches Build (D07), engineers write real code with Claude — but only in one folder you grant. Replay runs before anything ships.</p>
            <WorkspacePicker value={ws.path} onChange={(p, s) => setWs({ path: p, source: s })} />
            <div className="small muted">You can change this later from Setup. Leave blank to decide when Build starts (Build will pause and ask).</div>
          </>)}
          {step === 5 && (<>
            <h1>When does the company work and meet?</h1>
            <p className="lede">Heads meet the CEO each morning to set goals; the leads address the whole company at the all-hands (every agent gathers in the boardroom); the improvement branch reviews the day after hours.</p>
            <div className="grid3">
              <Field label="Timezone"><input className="input" value={sched.timezone} onChange={(e) => setSched({ ...sched, timezone: e.target.value })} list="tzs" /></Field>
              <Field label="Workday starts"><input className="input" type="time" value={sched.work_start} onChange={(e) => setSched({ ...sched, work_start: e.target.value })} /></Field>
              <Field label="Workday ends"><input className="input" type="time" value={sched.work_end} onChange={(e) => setSched({ ...sched, work_end: e.target.value })} /></Field>
              <Field label="Executive meeting (heads + CEO)"><input className="input" type="time" value={sched.exec_meeting_time} onChange={(e) => setSched({ ...sched, exec_meeting_time: e.target.value })} /></Field>
              <Field label="All-hands (whole company)"><input className="input" type="time" value={sched.all_hands_time} onChange={(e) => setSched({ ...sched, all_hands_time: e.target.value })} /></Field>
              <Field label="Improvement branch"><input className="input" type="time" value={sched.improvement_time} onChange={(e) => setSched({ ...sched, improvement_time: e.target.value })} /></Field>
            </div>
            <div className="field"><span className="spec muted">Days</span><div className="row wrap" style={{ gap: 6 }}>{DAYS.map((d) => <button key={d} className={`btn sm ${sched.days.includes(d) ? 'primary' : ''}`} onClick={() => setSched({ ...sched, days: sched.days.includes(d) ? sched.days.filter((x) => x !== d) : [...sched.days, d] })}>{d}</button>)}</div></div>
          </>)}
          {step === 6 && (<>
            <h1>Connect the company's tools.</h1>
            <p className="lede">Keys are stored in <span className="kbd">.env</span> on this machine and never displayed again. Anything missing degrades to a mock — the company still runs. If a department later needs an integration you haven't connected, it texts you on Linq.</p>
            <div className="card small"><b>Composio:</b> add the API key here, connect Gmail/Calendar plus GitHub and Vercel at app.composio.dev, then paste the entity id. If GitHub or Vercel is missing at build/deploy time, the dashboard and Linq will ask you to connect it before D07 continues.</div>
            <IntegrationsList compact />
          </>)}
          {step === 7 && (<>
            <h1>Lend the company your voice — with consent.</h1>
            <p className="lede">Outreach and Sales place discovery/sales calls in your cloned voice (ElevenLabs). Every call is a gate you approve and always discloses it's an AI. Optional — skip and set it up later.</p>
            <ConsentBox text={voice.text} name={f.display_name} checked={voice.agree} onChange={(v) => setVoice({ ...voice, agree: v })} />
            {voice.agree && <VoiceRecorder onSample={(s) => setVoice({ ...voice, sample: s })} />}
          </>)}
          {step === 8 && (<>
            <h1>Ready to open the doors.</h1>
            <div className="grid2">
              <div className="card"><div className="spec muted">Founder</div><b>{f.display_name}</b><div className="small muted">{f.email || '—'} · {phoneE164} {linq.confirmed ? '(HELLO confirmed ✓)' : linq.ok ? '(HELLO sent)' : ''} · {f.timezone}</div></div>
              <div className="card"><div className="spec muted">Mode</div><b>{mode === 'founder_led' ? 'Founder-led' : 'Autonomous origination'}</b><div className="small muted">{mode === 'founder_led' ? idea.slice(0, 120) : 'D01 will originate opportunities'}</div></div>
              <div className="card"><div className="spec muted">Budget</div><b>${caps.spend_cap_usd}</b> spend · ${caps.terac_cap_usd} Terac · {caps.autonomy}</div>
              <div className="card"><div className="spec muted">Workspace</div><span className="mono small">{ws.path || 'not granted yet'}</span></div>
              <div className="card"><div className="spec muted">Schedule</div><span className="small">exec {sched.exec_meeting_time} · all-hands {sched.all_hands_time} · work {sched.work_start}–{sched.work_end} · improve {sched.improvement_time} · {sched.days.join(' ')}</span></div>
              <div className="card"><div className="spec muted">Voice</div><span className="small">{voice.agree ? (voice.sample ? 'consent + sample → clone on launch' : 'consent only (record later)') : 'skipped'}</span></div>
            </div>
            {launchLog.length > 0 && <div className="card mono small" style={{ whiteSpace: 'pre-wrap' }}>{launchLog.join('\n')}</div>}
            {result && <div className="card" style={{ borderColor: 'var(--ok)' }}><b>Venture created.</b> <span className="mono small">venture_id {result.venture_id} · first_work_order_id {result.first_work_order_id ?? '—'} · trace {result.trace_id}</span></div>}
          </>)}
        </div>
        {result && phoneOk && (
          <div className="phone-transfer">
            <div className="bubble them">You can also transfer the onboarding process to phone.</div>
            <button className="btn primary" onClick={transferToPhone} disabled={transfer.busy}>{transfer.busy ? 'Sending...' : 'Transfer to phone'}</button>
            {transfer.status && <span className="chip">{transfer.status}</span>}
          </div>
        )}
        <div className="onboard-foot">
          <button className="btn ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>&larr; Back</button>
          <div className="row">
            {step === 1 && <button className="btn ghost" onClick={() => setStep((s) => s + 1)}>Skip phone</button>}
            {step < STEPS.length - 1 ? <button className="btn primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next &rarr;</button> : result ? <button className="btn primary pulse" onClick={openHq}>Open HQ &rarr;</button> : <button className="btn primary pulse" onClick={launch} disabled={busy}>{busy ? 'Launching…' : 'Launch the company'}</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
