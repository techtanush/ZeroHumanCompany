import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { DEPT_NAMES, ROOMS } from '../hq/departments';
import type { HqScene, SceneAgent } from '../hq/scene';
import { ago, useStore } from '../store';
import { AgentCard } from './AgentCard';
import { Panel } from './Panel';

/**
 * The executive meeting room. Department heads around the table; the founder can
 * start the 7am briefing on demand, read the latest signed DailyBriefing (company
 * goals, per-department goals/blockers/asks, risks, Band broadcast), and ask the
 * CEO/executive team about vision and goals.
 */
export function BriefingRoom({ selected, scene, onClose }: { selected: SceneAgent | null; scene: HqScene; onClose: () => void }) {
  const { ventureId, events, meeting, toast, settings } = useStore();
  const [tab, setTab] = useState<'briefing' | 'ask' | 'heads'>('briefing');
  const [briefing, setBriefing] = useState<any | null>(null);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [log, setLog] = useState<Array<{ who: 'me' | 'them'; text: string; source?: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const briefingEvents = useMemo(() => events.filter((e) => e.type.startsWith('ops.')).length, [events]);

  useEffect(() => {
    if (!ventureId) return;
    api.briefing(ventureId).then((r) => setBriefing(r.briefing)).catch(() => undefined);
    api.artifacts(ventureId, '?type=DailyBriefing').then((r) => setDrafts(r.artifacts.filter((a) => a.quality !== 'signed').slice(-3))).catch(() => undefined);
  }, [ventureId, briefingEvents]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [log]);
  useEffect(() => { if (selected?.persona) setTab('heads'); }, [selected]);

  const start = async () => {
    if (!ventureId) return;
    setBusy(true);
    try { await api.startMeeting(ventureId, 'executive'); toast('Executive briefing started — D13 is facilitating', 'meeting'); }
    catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const ask = async (question: string) => {
    if (!ventureId || !question.trim()) return;
    setLog((l) => [...l, { who: 'me', text: question }]); setQ(''); setBusy(true);
    try { const r = await api.ask(ventureId, 'exec', question); setLog((l) => [...l, { who: 'them', text: r.answer, source: r.source }]); }
    catch (e: any) { setLog((l) => [...l, { who: 'them', text: e.message, source: 'error' }]); } finally { setBusy(false); }
  };
  const b = briefing?.body;
  const running = meeting === 'executive' || events.some((e) => e.type === 'ops.daily_briefing_started' && Date.now() - new Date(e.ts).getTime() < 15 * 60_000 && !events.some((x) => x.type === 'ops.daily_briefing_published' && x.seq > e.seq));

  return (
    <Panel title="Executive Meeting Room" size="wide" onClose={onClose}
      sub={<span>CEO + 13 department heads · scheduled {settings?.meetings.exec_meeting_time ?? '07:00'} {settings?.meetings.timezone ?? ''} · all-hands {settings?.meetings.all_hands_time ?? '09:00'}</span>}
      tabs={<div className="tabs">{(['briefing', 'ask', 'heads'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'briefing' ? 'Daily briefing' : t === 'ask' ? 'Ask the CEO' : 'Heads at the table'}</button>)}</div>}
      foot={tab === 'ask' ? (
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input className="input" placeholder="What's the vision? What are we optimizing for this week?" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
          <button className="btn primary" disabled={busy || !q.trim()}>Ask</button>
        </form>
      ) : (
        <>
          <button className="btn primary" onClick={start} disabled={busy || running}>{running ? 'Briefing in progress…' : '▶ Start 7am briefing now'}</button>
          <button className="btn" onClick={() => ventureId && api.startMeeting(ventureId, 'all_hands').then(() => toast('All-hands started', 'meeting')).catch((e) => toast(e.message, 'error'))} disabled={meeting === 'all_hands'}>All-hands</button>
          {meeting && <button className="btn" onClick={() => ventureId && api.endMeeting(ventureId, meeting)}>End meeting</button>}
        </>
      )}>
      {tab === 'briefing' && (
        !b ? (
          <div className="card">
            <b>No signed briefing yet.</b>
            <div className="small muted" style={{ marginTop: 6 }}>Every morning at {settings?.meetings.exec_meeting_time ?? '07:00'} the Chief of Staff (D13) gathers all 13 heads here, reads the last 24h of the event log, sets company + department goals, collects blockers and cross-department asks, and broadcasts to Band. Press <b>Start 7am briefing now</b> to run it immediately{running ? ' — one is running.' : '.'}</div>
            {drafts.length > 0 && <div className="small muted mt">{drafts.length} unsigned draft(s) exist — the critic rejected them for missing evidence; the next run will try again.</div>}
          </div>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 6 }}><span className="chip ok">signed</span><span className="chip">{b.meeting_date} · {b.timezone}</span><span className="chip">room {b.band_room}</span><span className="muted small">{ago(briefing.created_at)}</span></div>
            <Section title="Company goals">
              {(b.company_goals ?? []).map((g: any) => <div key={g.id} className="card" style={{ padding: 10 }}><div className="row"><span className={`chip ${g.priority === 'p0' ? 'accent' : ''}`}>{g.priority}</span><b className="small">{g.goal}</b></div><div className="small muted">{DEPT_NAMES[g.owner_department_id] ?? g.owner_department_id} · {g.metric} → {g.target} · due {g.due_at}</div></div>)}
            </Section>
            <Section title="Department heads report">
              {(b.department_briefs ?? []).map((d: any) => (
                <details key={d.department_id} className="card" style={{ padding: 10 }}>
                  <summary style={{ cursor: 'pointer' }}><b className="small">{d.department_id} {DEPT_NAMES[d.department_id]}</b> <span className="muted small">— {d.headline}</span></summary>
                  <div className="small" style={{ marginTop: 6 }}>
                    <div><b>Goals:</b> {(d.goals ?? []).join(' · ')}</div>
                    {d.blockers?.length > 0 && <div><b>Blockers:</b> {d.blockers.join(' · ')}</div>}
                    {d.asks_of_other_departments?.length > 0 && <div><b>Asks:</b> {d.asks_of_other_departments.map((a: any) => `${a.to}: ${a.ask} (by ${a.needed_by})`).join(' · ')}</div>}
                    {d.work_orders?.length > 0 && <div className="muted">Work orders: {d.work_orders.map((w: any) => `${w.intent} $${w.budget_usd}`).join(', ')}</div>}
                  </div>
                </details>
              ))}
            </Section>
            {b.decisions?.length > 0 && <Section title="Decisions">{b.decisions.map((d: any, i: number) => <div key={i} className="small">• <b>{d.decision}</b> — {d.rationale} <span className="muted">({d.owner_department_id}{d.reversible ? ', reversible' : ', irreversible'})</span></div>)}</Section>}
            {b.risks?.length > 0 && <Section title="Risks">{b.risks.map((r: any, i: number) => <div key={i} className="small"><span className={`chip ${r.severity === 'critical' || r.severity === 'high' ? 'err' : r.severity === 'medium' ? 'warn' : ''}`}>{r.severity}</span> {r.risk} <span className="muted">→ {r.mitigation} ({r.owner_department_id})</span></div>)}</Section>}
            {b.broadcasts?.length > 0 && <Section title="Band broadcast">{b.broadcasts.map((x: any, i: number) => <div key={i} className="card dark small"><div className="spec muted">#{x.room}</div>{x.message}</div>)}</Section>}
          </>
        )
      )}
      {tab === 'ask' && (
        <>
          <div className="row wrap" style={{ gap: 6 }}>{['What is our vision?', 'What are the company goals right now?', 'What is each department working on?', 'Where are we stuck?'].map((s) => <button key={s} className="btn sm" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
          <div className="chat-log" ref={logRef} style={{ minHeight: 140 }}>
            {log.length === 0 && <div className="muted small">The executive team answers from the whole company's live facts: goals from the last briefing, every department's open work, milestones and blockers.</div>}
            {log.map((m, i) => <div key={i} className={`bubble ${m.who}`}>{m.text}{m.source && <span className="src">{m.source === 'llm' ? 'claude · company facts' : m.source}</span>}</div>)}
            {busy && <div className="bubble them muted">the room is conferring…</div>}
          </div>
        </>
      )}
      {tab === 'heads' && (
        selected?.persona ? (<><button className="btn sm" onClick={() => scene.closeCard()}>← All heads</button><AgentCard agent={selected} scene={scene} onClose={() => scene.closeCard()} inline /></>) : (
          <div className="grid2">
            {ROOMS.map((r) => (
              <div key={r.id} className="exec-seat">
                <div style={{ width: 40, height: 40, background: r.color, borderRadius: 3, opacity: .85 }} />
                <div><div className="who">Head of {r.name}</div><div className="head">{r.depts.join(' · ')}</div></div>
              </div>
            ))}
            <div className="muted small" style={{ gridColumn: '1 / -1' }}>Click a head at the table for their live report.</div>
          </div>
        )
      )}
    </Panel>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div className="col" style={{ gap: 6 }}><div className="spec muted">{title}</div>{children}</div>; }
