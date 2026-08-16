import { useEffect, useRef, useState } from 'react';
import type { HqScene, SceneAgent } from '../hq/scene';
import { ago, useStore } from '../store';
import { api } from '../api';

/** "Actually live" report for one sprite: what they're doing now, what they did, tools they use. */
export function AgentCard({ agent, scene, onClose, inline }: { agent: SceneAgent; scene: HqScene; onClose: () => void; inline?: boolean }) {
  const p = agent.persona!;
  const live = p.live ?? null;
  const av = useRef<HTMLCanvasElement>(null);
  const { ventureId } = useStore();
  const [ask, setAsk] = useState<{ busy: boolean; reply: string | null; err: string | null }>({ busy: false, reply: null, err: null });
  useEffect(() => { if (av.current) scene.drawAvatar(av.current, agent); }, [agent, scene]);
  const askAgent = async () => {
    if (!ventureId || !live?.agent_id) return;
    setAsk({ busy: true, reply: null, err: null });
    try {
      const r = await api.askAgent(ventureId, live.agent_id);
      setAsk({ busy: false, reply: r.reply, err: null });
    } catch (e: any) {
      setAsk({ busy: false, reply: null, err: e?.message?.length > 100 ? 'could not reach the agent' : (e?.message ?? 'failed') });
    }
  };
  const body = (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <canvas ref={av} width={48} height={48} className="avatar" />
        <div className="grow">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1.15 }}>{p.name}</div>
          <div className="muted small">{p.role}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {live ? <span className={`chip ${live.status === 'working' ? 'ok' : ''}`}>{live.status === 'working' ? '● working' : 'idle'}</span> : <span className="chip">ambient</span>}
            {live?.model && <span className="chip">{live.model}</span>}
            {agent.isHead && <span className="chip accent">head</span>}
          </div>
        </div>
      </div>
      <div className="hr" />
      <div className="col" style={{ gap: 6 }}>
        <div className="spec muted">Right now</div>
        <div style={{ fontSize: 14 }}>{live?.current ? <>Working on <b>{live.current.task}</b> <span className="muted small">since {ago(live.current.since)}</span></> : live ? 'Idle — waiting for the next work order.' : p.doing}</div>
        <div className="row wrap" style={{ gap: 6 }}><span className="chip">{p.mood}</span><span className="chip">{p.where ?? (p.seated ? 'At their desk' : 'On the floor')}</span></div>
      </div>
      {live && live.history.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="spec muted">Previously</div>
          {live.history.slice(0, 6).map((h, i) => (
            <div key={i} className="small" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <span><b>{h.task}</b> — {h.outcome}</span><span className="muted">{ago(h.until)}</span>
            </div>
          ))}
        </div>
      )}
      {live && Object.keys(live.tools).length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="spec muted">Tools used</div>
          <div className="row wrap" style={{ gap: 6 }}>{Object.entries(live.tools).sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={t} className="chip">{t} ×{n}</span>)}</div>
        </div>
      )}
      <div className="col" style={{ gap: 6, borderTop: '1px solid var(--paper-3)', paddingTop: 12 }}>
        <div className="spec muted">Personality</div>
        <div className="row wrap" style={{ gap: 6 }}>{p.traits.map((t) => <span key={t} className="chip">{t}</span>)}</div>
        <div className="small muted">{p.habit}</div>
        <div style={{ fontStyle: 'italic', fontSize: 14 }}>&ldquo;{p.thought}&rdquo;</div>
      </div>
      {live?.agent_id && (
        <div className="col" style={{ gap: 6, borderTop: '1px solid var(--paper-3)', paddingTop: 12 }}>
          <button className="btn sm" onClick={askAgent} disabled={ask.busy || !ventureId}>{ask.busy ? 'Asking…' : 'Ask what they’re doing'}</button>
          {ask.reply && <div className="small" style={{ fontStyle: 'italic' }}>&ldquo;{ask.reply}&rdquo;</div>}
          {ask.err && <div className="small muted">{ask.err}</div>}
        </div>
      )}
      <div className="spec muted">{p.deptLabel}{live ? ` · ${live.agent_id}` : ''}</div>
    </>
  );
  if (inline) return <div className="col" style={{ gap: 12 }}>{body}</div>;
  return (
    <div className="panel" style={{ width: 320 }}>
      <div className="panel-head"><div className="title">Agent</div><button className="close" onClick={onClose}>&times;</button></div>
      <div className="panel-body">{body}</div>
    </div>
  );
}
