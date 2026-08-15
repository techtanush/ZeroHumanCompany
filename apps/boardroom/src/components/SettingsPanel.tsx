import { useEffect, useState } from 'react';
import { api, TOKEN_KEY, KERNEL_URL_KEY, type VentureSettings } from '../api';
import { useStore } from '../store';
import { Panel } from './Panel';
import { WorkspacePicker } from './WorkspacePicker';

export function SettingsPanel({ onClose, onReonboard, settings }: { onClose: () => void; onReonboard: () => void; settings: VentureSettings | null }) {
  const { ventureId, venture, refreshSettings, toast, setVentureId } = useStore();
  const [ws, setWs] = useState(settings?.workspace.workspace_root ?? '');
  const [src, setSrc] = useState<'typed' | 'picker'>('typed');
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) ?? 'dev-only-token');
  const [kurl, setKurl] = useState(localStorage.getItem(KERNEL_URL_KEY) ?? '');
  useEffect(() => { setWs(settings?.workspace.workspace_root ?? ''); }, [settings]);
  const save = async () => { if (!ventureId) return; try { await api.grantWorkspace(ventureId, { workspace_root: ws.trim(), source: src }); await refreshSettings(); toast('Workspace updated — Build will use it for new work orders', 'ok'); } catch (e: any) { toast(e.message, 'error'); } };
  return (
    <Panel title="Setup" onClose={onClose} sub={<span>{venture?.name} · <span className="mono">{ventureId?.slice(0, 8)}</span></span>}>
      <div className="spec muted">Workspace the agency can build in</div>
      <WorkspacePicker value={ws} onChange={(p, s) => { setWs(p); setSrc(s); }} />
      {settings?.workspace.workspace_root && <div className="small muted">Current: <span className="mono">{settings.workspace.workspace_root}</span> · granted {settings.workspace.granted_at ? new Date(settings.workspace.granted_at).toLocaleString() : ''}</div>}
      <button className="btn primary" onClick={save} disabled={!ws.trim()}>Save workspace</button>
      <div className="hr" />
      <div className="spec muted">Kernel connection</div>
      <label className="field"><span className="small">Bearer token (KERNEL_SHARED_TOKEN)</span><input className="input" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      <label className="field"><span className="small">Kernel URL (blank = same origin / Vite proxy)</span><input className="input" placeholder="http://localhost:4000" value={kurl} onChange={(e) => setKurl(e.target.value)} /></label>
      <button className="btn" onClick={() => { localStorage.setItem(TOKEN_KEY, token); if (kurl) localStorage.setItem(KERNEL_URL_KEY, kurl); else localStorage.removeItem(KERNEL_URL_KEY); location.reload(); }}>Apply & reload</button>
      <div className="hr" />
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" onClick={onReonboard}>Re-run onboarding</button>
        <button className="btn" onClick={() => { setVentureId(null); }}>Switch / new venture</button>
        <button className="btn danger" onClick={() => ventureId && api.killSwitch(ventureId, !venture?.kill_switch).then(() => toast(venture?.kill_switch ? 'Kill switch released' : 'KILL SWITCH ENGAGED — all agents halt', 'error'))}>{venture?.kill_switch ? 'Release kill switch' : 'Kill switch'}</button>
      </div>
    </Panel>
  );
}
