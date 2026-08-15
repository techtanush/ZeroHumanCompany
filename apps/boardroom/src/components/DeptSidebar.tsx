import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AgentReport } from '../api';
import type { Room } from '../hq/departments';
import type { HqScene, SceneAgent } from '../hq/scene';
import { fmtTime, useStore } from '../store';
import { AgentCard } from './AgentCard';
import { Panel } from './Panel';

/**
 * The department sidebar: appears on entering a room. Live Q&A with the
 * department, "now / done / trying / goals" at a glance, the team's group chat,
 * and the roster. Clicking a sprite swaps to that agent's live report.
 */
export function DeptSidebar({ room, agents, selected, scene, onClose }: { room: Room; agents: AgentReport[]; selected: SceneAgent | null; scene: HqScene; onClose: () => void }) {
  const { ventureId, events } = useStore();
  const [tab, setTab] = useState<'ask' | 'status' | 'chat' | 'team'>('ask');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<{ who: 'me' | 'them'; text: string; source?: string }>>([]);
  const [facts, setFacts] = useState<any | null>(null);
  const [chatText, setChatText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const deptKey = room.id;

  useEffect(() => { setLog([]); setFacts(null); setTab('ask'); }, [room.id]);
  useEffect(() => { if (!ventureId) return; api.facts(ventureId, deptKey).then((r) => setFacts(r.facts)).catch(() => undefined); }, [ventureId, deptKey, events.length]);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [log]);
  useEffect(() => { if (selected?.persona) setTab('team'); }, [selected]);

  const chat = useMemo(() => events.filter((e) => e.type === 'dept.chat_posted' && room.depts.includes(e.department_id ?? '')).slice(-60), [events, room]);
  const working = agents.filter((a) => a.status === 'working');

  const ask = async (question: string) => {
    if (!ventureId || !question.trim()) return;
    setLog((l) => [...l, { who: 'me', text: question }]);
    setQ(''); setBusy(true);
    try { const r = await api.ask(ventureId, deptKey, question); setLog((l) => [...l, { who: 'them', text: r.answer, source: r.source }]); }
    catch (e: any) { setLog((l) => [...l, { who: 'them', text: `Sorry — ${e.message}`, source: 'error' }]); }
    finally { setBusy(false); }
  };
  const quick = ['What are you doing right now?', 'What have you done so far?', 'What are you trying to do next?', 'What are your goals and blockers?'];

  return (
    <Panel title={room.name} sub={<span>{room.depts.join(' · ')} · {working.length} working / {agents.length} agents</span>} onClose={onClose}
      tabs={<div className="tabs">{(['ask', 'status', 'chat', 'team'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t === 'ask' ? 'Ask' : t === 'status' ? 'Now · Done · Goals' : t === 'chat' ? `Group chat (${chat.length})` : 'Team'}</button>)}</div>}
      foot={tab === 'ask' ? (
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <input className="input" placeholder={`Ask ${room.short.toLowerCase()} anything…`} value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
          <button className="btn primary" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</button>
        </form>
      ) : tab === 'chat' ? (
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); if (!ventureId || !chatText.trim()) return; api.chat(ventureId, { room: `dept-${room.depts[0].toLowerCase()}`, text: chatText, author: 'founder', department_id: room.depts[0] }).then(() => setChatText('')).catch(() => undefined); }}>
          <input className="input" placeholder="Say something to the team…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
          <button className="btn primary" disabled={!chatText.trim()}>Post</button>
        </form>
      ) : undefined}
    >
      {tab === 'ask' && (
        <>
          <div className="row wrap" style={{ gap: 6 }}>{quick.map((s) => <button key={s} className="btn sm" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
          <div className="chat-log" ref={logRef} style={{ minHeight: 120 }}>
            {log.length === 0 && <div className="muted small">Ask the department head anything about what the room is doing, has done, is trying to do, or its goals. Answers come from the live event log{' '}— narrated by Claude when a key is set, plain facts otherwise.</div>}
            {log.map((m, i) => <div key={i} className={`bubble ${m.who}`}>{m.text}{m.source && <span className="src">{m.source === 'llm' ? 'claude · from live facts' : m.source === 'facts' ? 'facts only (no LLM key)' : m.source}</span>}</div>)}
            {busy && <div className="bubble them muted">thinking…</div>}
          </div>
        </>
      )}
      {tab === 'status' && facts && (
        <>
          <Section title="Right now">
            {facts.now.work_orders.length ? facts.now.work_orders.map((w: any) => <Line key={w.id}><b>{w.intent}</b> <span className="chip">{w.status}</span> <span className="muted">${Number(w.budget_usd).toFixed(2)}</span></Line>) : <div className="muted small">No open work orders.</div>}
          </Section>
          <Section title="Done">
            {facts.done.signed_artifacts.map((a: any) => <Line key={a.id}>Signed <b>{a.type}</b> <span className="muted">by {a.produced_by}</span></Line>)}
            {facts.done.completed_work_orders.map((w: any) => <Line key={w.id}>Completed <b>{w.intent}</b></Line>)}
            {!facts.done.signed_artifacts.length && !facts.done.completed_work_orders.length && <div className="muted small">Nothing finished yet.</div>}
          </Section>
          <Section title="Trying to do · goals">
            {facts.goals.department.length ? facts.goals.department.map((g: any, i: number) => <Line key={i}>◎ {g.goal}</Line>) : <div className="muted small">Goals are set at the executive briefing (7am by default) — start one from the clock panel.</div>}
            {facts.goals.company.slice(0, 4).map((g: any) => <Line key={g.id}><span className="chip">{g.priority}</span> {g.goal} <span className="muted">· {g.metric} → {g.target}</span></Line>)}
          </Section>
          {(facts.goals.blockers.length > 0 || facts.pending_gates.length > 0) && (
            <Section title="Blockers">
              {facts.goals.blockers.map((b: string, i: number) => <Line key={i}>⚠ {b}</Line>)}
              {facts.pending_gates.map((g: any) => <Line key={g.id}>⚖ Waiting on you: <b>{g.gate_type}</b>{g.channel === 'linq' ? ' (also texted via Linq)' : ''}</Line>)}
            </Section>
          )}
          {facts.budget.length > 0 && (
            <Section title="Wallet">{facts.budget.map((b: any) => <Line key={b.department_id}>{b.department_id}: ${Number(b.spent_usd).toFixed(2)} spent of ${Number(b.envelope_usd).toFixed(2)} <span className="chip">{b.state}</span></Line>)}</Section>
          )}
        </>
      )}
      {tab === 'chat' && (
        <div className="chat-log">
          {chat.length === 0 && <div className="muted small">The team's planning channel (Band when a key is set). Heads post when they pick up, finish, or get blocked on work.</div>}
          {chat.map((e) => (
            <div key={e.seq} className={`bubble ${e.actor_id === 'founder' || e.payload?.author === 'founder' ? 'me' : 'them'}`}>
              <b style={{ fontSize: 12 }}>{e.payload?.author}</b> <span className="muted tiny">{fmtTime(e.ts)}{e.payload?.transport === 'band' ? ' · band' : ''}</span>
              <div>{e.payload?.text}</div>
            </div>
          ))}
        </div>
      )}
      {tab === 'team' && (
        selected?.persona ? (
          <>
            <button className="btn sm" onClick={() => scene.closeCard()}>← All agents</button>
            <AgentCard agent={selected} scene={scene} onClose={() => scene.closeCard()} inline />
          </>
        ) : (
          <>
            <div className="muted small">Click a sprite in the room for its live report. Roster from the kernel:</div>
            {agents.length === 0 && <div className="muted small">No agent activity recorded yet for this room — they appear as soon as a work order runs.</div>}
            {agents.map((a) => (
              <div key={a.agent_id} className="card" style={{ padding: 10 }}>
                <div className="row"><span className={`dot ${a.status === 'working' ? 'live' : ''}`} /><b className="small">{a.agent_id}</b><span className="muted tiny" style={{ marginLeft: 'auto' }}>{a.role ?? ''} {a.model ?? ''}</span></div>
                <div className="small muted">{a.current ? `now: ${a.current.task}` : a.history[0] ? `last: ${a.history[0].task} — ${a.history[0].outcome}` : 'idle'}</div>
              </div>
            ))}
          </>
        )
      )}
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div className="col" style={{ gap: 6 }}><div className="spec muted">{title}</div>{children}</div>; }
function Line({ children }: { children: React.ReactNode }) { return <div className="small" style={{ lineHeight: 1.5 }}>{children}</div>; }
