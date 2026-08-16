import { useEffect, useState } from 'react';
import { api, type IntegrationStatus } from '../api';
import { useStore } from '../store';
import { Panel } from './Panel';

/** Reusable integrations checklist: status only (never values), inline key entry, live probes. */
export function IntegrationsList({ compact, filter }: { compact?: boolean; filter?: (i: IntegrationStatus) => boolean }) {
  const [list, setList] = useState<IntegrationStatus[]>([]);
  const [drivers, setDrivers] = useState<{ tools: string; llm: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [probeRes, setProbeRes] = useState<Record<string, { ok: boolean; detail: string; degraded?: string; extra?: any }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.integrations().then((r) => { setList(r.integrations); setDrivers({ tools: r.tools_driver, llm: r.llm_driver }); }).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const save = async (env: string) => { const v = edit[env]; if (v == null) return; setBusy(env); try { await api.setVar(env, v); setEdit((e) => { const n = { ...e }; delete n[env]; return n; }); await load(); } finally { setBusy(null); } };
  const probe = async (id: string) => { setBusy(id); try { setProbeRes((p) => ({ ...p, [id]: { ok: false, detail: 'probing…' } })); const r = await api.probe(id); setProbeRes((p) => ({ ...p, [id]: r })); } finally { setBusy(null); } };
  const shown = filter ? list.filter(filter) : list;
  return (
    <div className="col" style={{ gap: 10 }}>
      {drivers && <div className="row wrap" style={{ gap: 6 }}><span className={`chip ${drivers.llm === 'anthropic' ? 'ok' : 'warn'}`}>LLM: {drivers.llm}</span><span className={`chip ${drivers.tools === 'real' ? 'ok' : 'warn'}`}>tools: {drivers.tools}</span><span className="muted tiny">Set ZEROTH_LLM=real / ZEROTH_TOOLS=real in .env to leave mock mode; vendors without keys degrade to mocks automatically.</span></div>}
      {shown.map((i) => {
        const pr = probeRes[i.id];
        return (
          <div key={i.id} className={`integ ${i.ready ? 'ready' : ''}`}>
            <div><div className="name">{i.name} <span className="chip">{i.tier}</span> {i.ready ? <span className="chip ok">ready</span> : <span className="chip warn">missing keys</span>}</div>{!compact && <div className="small muted">{i.purpose}</div>}<div className="tiny muted">powers: {i.powers}</div></div>
            <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
              {i.connect_url && (
                <a className="btn sm" href={i.connect_url} target="_blank" rel="noreferrer noopener" title={`Connect ${i.name} — opens ${i.connect_url}`}>
                  Connect <span aria-hidden="true">↗</span>
                </a>
              )}
              <button className="btn sm" onClick={() => probe(i.id)} disabled={busy === i.id}>Test</button>
              {pr && <span className={`chip ${pr.ok ? 'ok' : 'err'}`} title={pr.degraded}>{pr.detail}</span>}
              {pr?.extra?.tools && <span className="tiny muted">{pr.extra.tools.length} MCP tools</span>}
              {pr?.extra && 'gmail' in pr.extra && <span className="tiny muted">gmail {pr.extra.gmail ? '✓' : '✗'} · calendar {pr.extra.calendar ? '✓' : '✗'}</span>}
              {pr?.extra && 'github' in pr.extra && <span className="tiny muted">github {pr.extra.github ? '✓' : '✗'} · vercel {pr.extra.vercel ? '✓' : '✗'}</span>}
            </div>
            <div className="vars">
              {i.vars.map((v) => (
                <div key={v.env} className="var">
                  <span className="mono" title={v.hint}>{v.env}{v.required ? ' *' : ''}</span>
                  {edit[v.env] != null ? (
                    <input className="input" type={v.secret ? 'password' : 'text'} placeholder={v.hint ?? v.label} value={edit[v.env]} onChange={(e) => setEdit({ ...edit, [v.env]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void save(v.env); if (e.key === 'Escape') setEdit((x) => { const n = { ...x }; delete n[v.env]; return n; }); }} autoFocus />
                  ) : (
                    <span className={`small ${v.configured ? '' : 'muted'}`}>{v.configured ? (v.secret ? `•••• ${v.masked ?? ''}` : v.masked) : <i>{v.hint ?? 'not set'}</i>}</span>
                  )}
                  {edit[v.env] != null ? <button className="btn sm primary" onClick={() => save(v.env)} disabled={busy === v.env}>Save</button> : <button className="btn sm ghost" onClick={() => setEdit({ ...edit, [v.env]: '' })}>{v.configured ? 'Replace' : 'Add'}</button>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Real OAuth connect grid — one button per business toolkit (Gmail, LinkedIn,
 * GitHub, Vercel, …). No API key is ever shown to the founder: clicking
 * "Connect" opens Composio's hosted authorization page for that toolkit,
 * scoped to this venture, and control returns here already connected.
 * Departments then read `connected` to decide whether a channel is usable —
 * see IntegrationsPanel's strategy note below.
 */
function ComposioToolkits() {
  const { ventureId, toast } = useStore();
  const [toolkits, setToolkits] = useState<Array<{ slug: string; name: string; department: string; connected: boolean }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | undefined>();
  const load = () => {
    if (!ventureId) return;
    api.composioToolkits(ventureId).then((r) => { setToolkits(r.toolkits); setDegraded(r.degraded); }).catch(() => undefined);
  };
  useEffect(() => { load(); }, [ventureId]);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const connected = p.get('composio_connected');
    if (connected && ventureId) {
      toast(`${connected} connected`, 'ok');
      load();
      api.composioStrategy(ventureId, connected).catch(() => undefined);
      history.replaceState({}, '', location.pathname);
    }
  }, [ventureId]);
  const connect = async (slug: string) => {
    if (!ventureId) { toast('Launch the company first, then connect tools', 'warn'); return; }
    setBusy(slug);
    try {
      const r = await api.composioConnect(ventureId, slug);
      window.open(r.redirect_url, '_blank', 'noopener');
      toast(`Finish authorizing ${slug} in the new tab`, 'ok');
    } catch (e: any) {
      toast(e?.message?.length > 100 ? 'Composio: could not start the connection' : (e?.message ?? 'connect failed'), 'error');
    } finally { setBusy(null); }
  };
  if (!ventureId) return <div className="small muted">Connect real tools (Gmail, LinkedIn, GitHub, Vercel…) once the company has launched — each connection is scoped to this venture.</div>;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="small muted">Agents reason about how to use each connected tool for its department's work — e.g. LinkedIn connected → D04/D09 plan cold outreach and warm-connection leverage automatically.</div>
      {degraded && <div className="small muted">({degraded})</div>}
      <div className="grid2" style={{ gap: 8 }}>
        {toolkits.map((t) => (
          <div key={t.slug} className={`integ ${t.connected ? 'ready' : ''}`}>
            <div><div className="name">{t.name} {t.connected ? <span className="chip ok">connected</span> : <span className="chip warn">not connected</span>}</div><div className="tiny muted">{t.department}</div></div>
            <button className="btn sm primary" disabled={busy === t.slug} onClick={() => connect(t.slug)}>{busy === t.slug ? 'Opening…' : t.connected ? 'Reconnect' : 'Connect'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IntegrationsPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [linqBusy, setLinqBusy] = useState(false);
  const linq = async () => { setLinqBusy(true); try { const r = await api.linqTest({}); toast(r.ok ? `HELLO sent to ${r.to}` : `Linq: ${r.degraded ?? r.detail}`, r.ok ? 'ok' : 'error'); } finally { setLinqBusy(false); } };
  return (
    <Panel title="Integrations" size="wide" onClose={onClose} sub="Connect real tools with OAuth below. Vendor API keys further down are for the company's own accounts (Stripe, Terac, etc.), not shown to anyone else."
      foot={<><button className="btn" onClick={linq} disabled={linqBusy}>Send HELLO to my phone (Linq)</button></>}>
      <ComposioToolkits />
      <div className="hr" style={{ margin: '14px 0' }} />
      <IntegrationsList filter={(i) => i.id !== 'composio'} />
    </Panel>
  );
}
