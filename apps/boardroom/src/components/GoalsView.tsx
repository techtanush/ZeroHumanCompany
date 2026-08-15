import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ago, useStore } from '../store';
import { Empty, Panel } from './Panel';

const MILESTONE_LABEL: Record<string, string> = { idea_locked: 'Idea locked', market_validated: 'Market validated', product_live: 'Product live', pipeline_active: 'Pipeline active', revenue_real: 'Real revenue' };

/** Goals & achievements: milestones, company + department goals, a live roadmap per department, and the improvement branch's findings. */
export function GoalsView({ onClose }: { onClose: () => void }) {
  const { ventureId, events, gates } = useStore();
  const [g, setG] = useState<any | null>(null);
  const [tab, setTab] = useState<'overview' | 'roadmap' | 'achievements' | 'improvement'>('overview');
  const tick = useMemo(() => events.filter((e) => e.type.startsWith('artifact.') || e.type.startsWith('dept.work') || e.type.startsWith('venture.') || e.type.startsWith('cos.')).length, [events]);
  useEffect(() => { if (ventureId) api.goals(ventureId).then(setG).catch(() => undefined); }, [ventureId, tick]);
  if (!g) return <Panel title="Goals & achievements" onClose={onClose}><Empty>Loading…</Empty></Panel>;
  const done = g.milestones.filter((m: any) => m.done).length;
  const improvementGates = gates.filter((x) => x.gate_type === 'new_department');
  return (
    <Panel title="Goals & achievements" size="wide" onClose={onClose} sub={<span>{done}/5 milestones · {g.achievements.length} achievements · roadmap across 13 departments</span>}
      tabs={<div className="tabs">{(['overview', 'roadmap', 'achievements', 'improvement'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>}>
      {tab === 'overview' && (
        <>
          <div className="card">
            <div className="spec muted">The journey</div>
            <div className="progress mt"><i style={{ width: `${(done / 5) * 100}%` }} /></div>
            <div className="row wrap mt" style={{ gap: 14 }}>{g.milestones.map((m: any) => <div key={m.id} className={`milestone ${m.done ? 'done' : ''}`}><span className="box">{m.done ? '✓' : ''}</span><span className="small">{MILESTONE_LABEL[m.id]}</span></div>)}</div>
          </div>
          <div className="spec muted">Trying to achieve — company goals</div>
          {g.company_goals.length === 0 && <div className="muted small">No goals yet — the executive briefing sets them. Start one from the exec room.</div>}
          {g.company_goals.map((c: any) => <div key={c.id} className="card" style={{ padding: 10 }}><div className="row"><span className={`chip ${c.priority === 'p0' ? 'accent' : ''}`}>{c.priority}</span><b className="small">{c.goal}</b></div><div className="small muted">{c.owner_department_id} · {c.metric} → {c.target} · due {c.due_at}</div></div>)}
          <div className="spec muted">Department goals</div>
          {g.department_goals.map((d: any) => <div key={d.department_id} className="small"><b>{d.department_id} {d.name}</b> — {d.headline}<div className="muted">{(d.goals ?? []).join(' · ')}{d.blockers?.length ? ` · ⚠ ${d.blockers.join('; ')}` : ''}</div></div>)}
          {g.risks?.length > 0 && <><div className="spec muted">Risks</div>{g.risks.map((r: any, i: number) => <div key={i} className="small"><span className={`chip ${r.severity === 'high' || r.severity === 'critical' ? 'err' : 'warn'}`}>{r.severity}</span> {r.risk} <span className="muted">→ {r.mitigation}</span></div>)}</>}
        </>
      )}
      {tab === 'roadmap' && (
        <>
          <div className="muted small">Every work order per department, live. Orange = running, green = done, red = failed.</div>
          {g.roadmap.map((r: any) => (
            <div key={r.department_id} className="roadmap-row">
              <div className="small"><b>{r.department_id}</b> <span className="muted">{r.name}</span></div>
              <div className="lane">{r.work.length === 0 ? <span className="muted tiny">—</span> : r.work.map((w: any, i: number) => <span key={i} className={`node ${w.status}`} title={`${w.status} · ${ago(w.at)}`}>{w.intent}</span>)}</div>
            </div>
          ))}
        </>
      )}
      {tab === 'achievements' && (
        <>
          {g.achievements.length === 0 && <Empty>Nothing achieved yet — signed artifacts, milestones, deploys, deals and hires land here.</Empty>}
          {[...g.achievements].reverse().map((a: any, i: number) => (
            <div key={i} className="event-row"><div className="t">{ago(a.at)}</div><div><span className="type">{a.kind}</span> <span className="small">{a.detail?.type ? `${a.detail.type} by ${a.detail.department_id}` : a.detail?.milestone ?? a.detail?.url ?? (a.detail?.amount_usd ? `$${a.detail.amount_usd}` : '')}</span></div></div>
          ))}
        </>
      )}
      {tab === 'improvement' && (
        <>
          <div className="card small"><b>How the improvement branch works.</b> After the workday ends, the Chief of Staff (D13) mines the day's telemetry for capability gaps. If it finds something worth building, it texts you on Linq and opens a gate — <b>nothing is built until you approve</b>. On approval, Build (D07) implements it inside your granted workspace and runs Replay before shipping.</div>
          {improvementGates.length > 0 && <><div className="spec muted">Approvals</div>{improvementGates.map((x) => <div key={x.id} className="small">⚖ {String(x.preview?.summary ?? x.gate_type)} <span className={`chip ${x.status === 'pending' ? 'warn' : x.status.includes('approved') ? 'ok' : ''}`}>{x.status}</span></div>)}</>}
          <div className="spec muted">Gaps found</div>
          {g.improvement.length === 0 && <div className="muted small">No gaps logged yet. Trigger a run from the clock panel to try now.</div>}
          {g.improvement.map((x: any) => <div key={x.id} className="card" style={{ padding: 10 }}><div className="row"><span className="chip">{x.taxonomy}</span><span className={`chip ${x.quality === 'signed' ? 'ok' : ''}`}>{x.quality}</span><span className="muted tiny" style={{ marginLeft: 'auto' }}>{ago(x.at)}</span></div><div className="small mt"><b>{x.summary}</b></div><div className="small muted">Fix: {x.proposed_fix} · impact: {x.expected_impact} · risk {x.risk}</div></div>)}
        </>
      )}
    </Panel>
  );
}
