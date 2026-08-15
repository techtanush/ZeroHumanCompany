import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Panel } from './Panel';
import { VoiceRecorder } from './VoiceRecorder';

export function ConsentBox({ text, name, checked, onChange }: { text: string; name?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="consent">
      <b>Voice clone consent (v1)</b>
      <ol>
        <li>I am {name || 'the founder'} and this is my own voice.</li>
        <li>I allow Zeroth to clone my voice for <b>this venture's</b> discovery and sales calls only.</li>
        <li>Every call made in my voice must <b>disclose it is an AI</b> in the first utterance.</li>
        <li>I can <b>revoke</b> this at any time; the clone is then deleted from ElevenLabs.</li>
      </ol>
      <div className="tiny muted" style={{ marginTop: 6 }}>{text}</div>
      <label className="row mt" style={{ cursor: 'pointer' }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> I understand and consent</label>
    </div>
  );
}

/** Voice: consent → sample → clone → (revoke). Calls still require an outbound_to_real_person gate with disclosure:true. */
export function VoicePanel({ onClose }: { onClose: () => void }) {
  const { ventureId, settings, refreshSettings, toast } = useStore();
  const [text, setText] = useState('');
  const [agree, setAgree] = useState(false);
  const [sample, setSample] = useState<{ audio_base64: string; mime_type: string; duration_s: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.consentText().then((r) => setText(r.text)).catch(() => undefined); }, []);
  const v = settings?.voice;
  const consent = async () => { if (!ventureId) return; setBusy(true); try { await api.voiceConsent(ventureId, { accepted: true }); await refreshSettings(); toast('Consent recorded', 'ok'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const clone = async () => { if (!ventureId || !sample) return; setBusy(true); try { const r = await api.voiceClone(ventureId, { audio_base64: sample.audio_base64, mime_type: sample.mime_type, duration_s: sample.duration_s, name: 'Founder voice' }); await refreshSettings(); toast(`Voice cloned (${r.driver})${r.degraded ? ` — ${r.degraded}` : ''}`, r.degraded ? 'warn' : 'ok'); setSample(null); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const revoke = async () => { if (!ventureId) return; setBusy(true); try { const r = await api.voiceRevoke(ventureId); await refreshSettings(); toast(r.deleted ? 'Voice deleted from ElevenLabs' : `Consent revoked${r.degraded ? ` (${r.degraded})` : ''}`, 'ok'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return (
    <Panel title="Your voice" onClose={onClose} sub={<span>status: <b>{v?.status ?? '…'}</b>{v?.voice_id ? ` · voice_id ${v.voice_id.slice(0, 10)}…` : ''}</span>}>
      <div className="card small">Outreach (D04) and Sales (D10) place phone calls in your cloned voice. Every call is a gate you approve, and the first sentence always says it's an AI. Consent first, then a sample, then the clone.</div>
      {(!v || v.status === 'none' || v.status === 'revoked') && (<><ConsentBox text={text} checked={agree} onChange={setAgree} /><button className="btn primary" disabled={!agree || busy} onClick={consent}>Record consent</button></>)}
      {v && (v.status === 'consented' || v.status === 'sample_uploaded') && (<><div className="chip ok">consent recorded {v.consent_at ? new Date(v.consent_at).toLocaleString() : ''}</div><VoiceRecorder onSample={setSample} disabled={busy} /><button className="btn primary" disabled={!sample || busy} onClick={clone}>{busy ? 'Cloning…' : 'Clone my voice'}</button></>)}
      {v?.status === 'cloned' && (<>
        <div className="card"><div className="row"><span className="chip ok">cloned</span><b className="small">{v.voice_name}</b></div><div className="mono small mt">voice_id: {v.voice_id}</div><div className="small muted">sample: {v.sample_meta?.mime_type} · {Math.round((v.sample_meta?.bytes ?? 0) / 1024)} KB{v.sample_meta?.duration_s ? ` · ${Math.round(v.sample_meta.duration_s)}s` : ''} (audio not stored)</div></div>
        <div className="small muted">Calls: agents must open an <b>outbound_to_real_person</b> gate with <b>disclosure: true</b> — you'll see it in Decisions and on your phone.</div>
        <button className="btn danger" onClick={revoke} disabled={busy}>Revoke consent & delete voice</button>
      </>)}
    </Panel>
  );
}
