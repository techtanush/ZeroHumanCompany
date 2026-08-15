import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AgentReport } from '../api';
import { useStore } from '../store';
import { HqScene, type UiState } from './scene';
import { ROOMS, ROOM_BY_ID, roomForDept } from './departments';
import { AgentCard } from '../components/AgentCard';
import { DeptSidebar } from '../components/DeptSidebar';
import { GatesPanel } from '../components/GatesPanel';
import { TimelinePanel } from '../components/TimelinePanel';
import { BriefingRoom } from '../components/BriefingRoom';
import { GoalsView } from '../components/GoalsView';
import { WalletsPanel } from '../components/WalletsPanel';
import { IntegrationsPanel } from '../components/IntegrationsPanel';
import { VoicePanel } from '../components/VoicePanel';
import { MeetingsPanel } from '../components/MeetingsPanel';
import { SettingsPanel } from '../components/SettingsPanel';

type PanelId = 'gates' | 'timeline' | 'dept' | 'briefing' | 'goals' | 'wallets' | 'integrations' | 'voice' | 'meetings' | 'settings' | null;

export function Hq({ onReonboard }: { onReonboard: () => void }) {
  const store = useStore();
  const { ventureId, venture, events, sse, gates, settings, meeting, workday } = store;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HqScene | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [panel, setPanel] = useState<PanelId>(null);
  const [agents, setAgents] = useState<AgentReport[]>([]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new HqScene(canvasRef.current);
    sceneRef.current = scene;
    scene.setUiListener(setUi);
    return () => { scene.destroy(); sceneRef.current = null; };
  }, []);

  // Live agents: refresh on agent events + every 15s.
  // Coarse tick: refetch at most every 5 relevant events (plus the 15s poll) so a busy run doesn't hammer the kernel.
  const agentTick = useMemo(() => Math.floor(events.filter((e) => e.type.startsWith('agent.') || e.type.startsWith('dept.work')).length / 5), [events]);
  useEffect(() => {
    if (!ventureId) return;
    let alive = true;
    const load = () => api.agents(ventureId).then((r) => { if (alive) setAgents(r.agents); }).catch(() => undefined);
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [ventureId, agentTick]);

  useEffect(() => {
    const byRoom: Record<string, AgentReport[]> = {};
    for (const a of agents) { const room = roomForDept(a.department_id); if (!room) continue; (byRoom[room.id] ??= []).push(a); }
    // Rooms sharing a department (finance/hr) both show D11; that's intentional.
    for (const r of ROOMS) if (!byRoom[r.id]) byRoom[r.id] = agents.filter((a) => r.depts.includes(a.department_id));
    const pendingGatesByRoom: Record<string, number> = {};
    for (const g of gates.filter((g) => g.status === 'pending')) { const room = roomForDept(g.department_id); if (room) pendingGatesByRoom[room.id] = (pendingGatesByRoom[room.id] ?? 0) + 1; }
    sceneRef.current?.setLive({ agentsByRoom: byRoom, meeting, workday, ventureName: venture?.name, pendingGatesByRoom });
  }, [agents, meeting, workday, venture, gates]);

  // Open the dept sidebar automatically when entering a room; briefing room in exec.
  const activeRoom = ui?.activeRoomId ?? null;
  useEffect(() => {
    if (ui?.view === 'room' && activeRoom) setPanel(activeRoom === 'exec' ? 'briefing' : 'dept');
    else if (ui?.view !== 'room' && (panel === 'dept' || panel === 'briefing')) setPanel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.view, activeRoom]);

  const pendingGates = gates.filter((g) => g.status === 'pending');
  const scene = sceneRef.current;
  const toggle = (id: PanelId) => setPanel((p) => (p === id ? null : id));

  return (
    <div className="stage">
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', cursor: ui?.cursor ?? 'default' }} />
      <div className="gradient-top" /><div className="gradient-bottom" />

      <div className="hud-top">
        <div className="row">
          {ui?.view !== 'exterior' && <button className="btn" onClick={() => scene?.goBack()}>&larr; Back</button>}
          <div className="spec muted">{ui?.breadcrumb}</div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span className="chip"><span className={`dot ${sse === 'live' ? 'live' : sse === 'idle' ? '' : 'off'}`} /> SSE {sse}</span>
          <span className="chip">{venture?.name ?? '…'} · {venture?.status ?? ''}</span>
          {venture?.kill_switch && <span className="chip err">KILL SWITCH ON</span>}
          <span className="chip">{workday === 'night' ? '🌙 after hours' : workday === 'day' ? '☀ workday' : '· clock'}</span>
          <span className="spec" style={{ color: 'var(--bone)', opacity: .6 }}>// ZEROTH_HQ · {ui?.view.toUpperCase()}</span>
        </div>
      </div>

      {meeting && (
        <div className="meeting-banner">
          {meeting === 'all_hands' ? 'All-hands in progress — every agent is in the boardroom' : meeting === 'executive' ? 'Executive meeting — department heads with the CEO' : 'Department meeting'}
          <button className="btn" onClick={() => { scene?.goTo('room', 'exec'); }}>Join</button>
          <button className="btn" onClick={() => ventureId && api.endMeeting(ventureId, meeting).catch(() => undefined)}>End</button>
        </div>
      )}

      {ui?.showEnter && (
        <div className="enter-cta"><button className="btn primary pulse" onClick={() => scene?.enterBuilding()}>Enter Headquarters</button></div>
      )}
      {ui?.hoverLabel && ui.hoverPos && <div className="hover-label" style={{ left: ui.hoverPos.x, top: ui.hoverPos.y - 6 }}>{ui.hoverLabel}</div>}
      {ui?.view === 'room' && (
        <div className="zoom">
          <button onClick={() => scene?.zoomIn()}>+</button><div className="lbl">{Math.round((ui.zoom ?? 1) * 100)}%</div><button onClick={() => scene?.zoomOut()}>&minus;</button><button style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }} onClick={() => scene?.resetZoom()}>FIT</button>
        </div>
      )}
      <div className="hint spec muted">{ui?.hint}</div>

      {ui?.view !== 'exterior' && (
        <div className="dock">
          <button className={panel === 'gates' ? 'active' : ''} onClick={() => toggle('gates')} title="Decisions waiting on you"><span className="ico">⚖</span>gates{pendingGates.length > 0 && <span className="badge">{pendingGates.length}</span>}</button>
          <button className={panel === 'timeline' ? 'active' : ''} onClick={() => toggle('timeline')} title="Live event log"><span className="ico">≋</span>live</button>
          <button className={panel === 'briefing' ? 'active' : ''} onClick={() => { scene?.goTo('room', 'exec'); setPanel('briefing'); }} title="Executive briefing room"><span className="ico">◈</span>exec</button>
          <button className={panel === 'goals' ? 'active' : ''} onClick={() => toggle('goals')} title="Goals, roadmap, achievements"><span className="ico">◎</span>goals</button>
          <button className={panel === 'meetings' ? 'active' : ''} onClick={() => toggle('meetings')} title="Meetings & workday"><span className="ico">◷</span>clock</button>
          <button className={panel === 'wallets' ? 'active' : ''} onClick={() => toggle('wallets')} title="Agent wallets"><span className="ico">$</span>wallets</button>
          <button className={panel === 'voice' ? 'active' : ''} onClick={() => toggle('voice')} title="Voice clone"><span className="ico">◉</span>voice</button>
          <button className={panel === 'integrations' ? 'active' : ''} onClick={() => toggle('integrations')} title="Integrations"><span className="ico">⚙</span>keys</button>
          <button className={panel === 'settings' ? 'active' : ''} onClick={() => toggle('settings')} title="Workspace & settings"><span className="ico">▤</span>setup</button>
        </div>
      )}

      {ui?.selected && ui.selected.persona && panel !== 'dept' && panel !== 'briefing' && (
        <AgentCard agent={ui.selected} scene={scene!} onClose={() => scene?.closeCard()} />
      )}
      {panel === 'dept' && activeRoom && activeRoom !== 'exec' && (
        <DeptSidebar room={ROOM_BY_ID[activeRoom]} agents={agents.filter((a) => ROOM_BY_ID[activeRoom].depts.includes(a.department_id))} selected={ui?.selected ?? null} scene={scene!} onClose={() => { setPanel(null); scene?.closeCard(); }} />
      )}
      {panel === 'briefing' && <BriefingRoom selected={ui?.selected ?? null} scene={scene!} onClose={() => setPanel(null)} />}
      {panel === 'gates' && <GatesPanel onClose={() => setPanel(null)} />}
      {panel === 'timeline' && <TimelinePanel onClose={() => setPanel(null)} />}
      {panel === 'goals' && <GoalsView onClose={() => setPanel(null)} />}
      {panel === 'wallets' && <WalletsPanel onClose={() => setPanel(null)} />}
      {panel === 'integrations' && <IntegrationsPanel onClose={() => setPanel(null)} />}
      {panel === 'voice' && <VoicePanel onClose={() => setPanel(null)} />}
      {panel === 'meetings' && <MeetingsPanel onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel onClose={() => setPanel(null)} onReonboard={onReonboard} settings={settings} />}
    </div>
  );
}
