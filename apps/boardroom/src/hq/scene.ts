/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HqScene — the pixel-art headquarters (exterior → cutaway building → rooms),
 * ported from the "AI Company HQ" prototype and wired to live company data:
 *   • agents that are working sit at workstations; idle ones wander
 *   • an all-hands empties every room into the boardroom
 *   • an executive meeting pulls the department heads out of their rooms
 *   • after work hours the floors go dark
 * Pure canvas; React talks to it through `setLive()`, `setUiListener()` and a few commands.
 */
import { EXEC, FLOOR_LAYOUT, ROOMS, ROOM_BY_ID, humanizeAgent, type Room } from './departments';
import type { AgentReport } from '../api';

const SHEET = { blockW: 48, blockH: 64, cell: 16, perRow: 5, nChars: 10 };
const WALK = [1, 0, 1, 2];
const WALK_FPS = 8;
const NAMES = ['Alex', 'Priya', 'Sam', 'Jordan', 'Riya', 'Chen', 'Morgan', 'Tariq', 'Elena', 'Kofi', 'Nina', 'Owen', 'Sara', 'Leo', 'Maya', 'Ivan', 'Zoe', 'Ravi', 'Ana', 'Theo'];
const SURNAMES = ['Johnson', 'Patel', 'Chen', 'Garcia', 'Kim', 'Novak', 'Osei', 'Rossi', 'Nguyen', 'Brooks', 'Haddad', 'Lindqvist', 'Silva', 'Okafor', 'Reyes'];
const TRAITS = ['methodical', 'blunt', 'warm', 'impatient', 'curious', 'unflappable', 'detail-obsessed', 'big-picture', 'dry humour', 'over-caffeinated', 'quietly competitive', 'relentlessly optimistic', 'skeptical', 'fast talker', 'night owl', 'early riser'];
const HABITS = ['takes notes on paper', 'never joins a call without an agenda', 'walks laps while thinking', 'replies in three words or fewer', 'keeps a running spreadsheet of everything', 'brings pastries on Fridays', 'labels every folder twice', 'has opinions about keyboard switches', 'reads the changelog for fun', 'always the last to leave'];
const MOODS = ['focused', 'in the zone', 'a little frazzled', 'cheerful', 'heads-down', 'restless', 'calm', 'buzzing'];
const IDLE_THOUGHTS = ['waiting on the next work order', 'reading the last briefing', 'coffee, then back at it', 'checking the group chat', 'tidying my notes'];

export interface Persona { name: string; age: number; role: string; traits: string[]; thought: string; habit: string; mood: string; doing: string; tenure: string; seated: boolean; where?: string; deptLabel?: string; live?: AgentReport | null }
export interface SceneAgent { seed: number; char: number; x: number; y: number; dir: number; frame: number; frameClock: number; ang: number; speed: number; turnClock: number; name: string; bubbleUntil: number; bubbleText: string; seated?: boolean; persona?: Persona; deptId?: string; isHead?: boolean; live?: AgentReport | null; wsIndex?: number }
export type View = 'exterior' | 'building' | 'room';
export interface UiState { view: View; activeRoomId: string | null; breadcrumb: string; hint: string; hoverLabel: string | null; hoverPos: { x: number; y: number } | null; zoom: number; showEnter: boolean; selected: SceneAgent | null; selectedScreen: { x: number; y: number } | null; cursor: string }
export interface LiveData { agentsByRoom: Record<string, AgentReport[]>; meeting: 'executive' | 'all_hands' | 'department' | null; workday: 'day' | 'night' | 'unknown'; ventureName?: string; pendingGatesByRoom?: Record<string, number> }

const ROOM_W = 1400, ROOM_H = 840;
const CENTER_X = ROOM_W / 2;
const FRONT_Y = 800, HORIZON_Y = 230, FRONT_HALF_W = 640, BACK_HALF_W = 400, BACK_WALL_TOP_Y = 46, WALL_TOP_Y = -160;
const DEPTH_MINY = 150, DEPTH_MAXY = ROOM_H * 0.72 - 20;
const BUILD_SHX = 90, BUILD_SHY = -46, FLOOR_SHX = 70, FLOOR_SHY = -30, WALL_H = 165;
const AGENTS_PER_ROOM = 9;

function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function perspAt(t: number) { const e = smoothstep(Math.max(0, Math.min(1, t))); return { y: FRONT_Y + (HORIZON_Y - FRONT_Y) * e, halfW: FRONT_HALF_W + (BACK_HALF_W - FRONT_HALF_W) * e, scale: 1 + (0.36 - 1) * e }; }
function worldToPersp(x: number, y: number) { const t = 1 - Math.max(0, Math.min(1, (y - DEPTH_MINY) / (DEPTH_MAXY - DEPTH_MINY))); const p = perspAt(t); const relX = (x - CENTER_X) / (ROOM_W / 2 - 40); return { x: CENTER_X + relX * p.halfW, y: p.y, scale: p.scale }; }
function shear(x: number, y: number, d: number, shx: number, shy: number) { return { x: x + d * shx, y: y + d * shy }; }
type Pt = { x: number; y: number };
function quadPath(ctx: CanvasRenderingContext2D, p1: Pt, p2: Pt, p3: Pt, p4: Pt) { ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); }
function lerpPt(a: Pt, b: Pt, t: number) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function mulberry32(a: number) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function withAlpha(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function mix(hexA: string, hexB: string, t: number) { const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16); const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t), g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t), bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * t); return `rgb(${r},${g},${bl})`; }
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function personaFor(room: Room, a: SceneAgent): Persona {
  const rng = mulberry32((a.seed >>> 0) * 2654435761 + 17);
  const live = a.live ?? null;
  const h = live ? humanizeAgent(live.agent_id) : null;
  const name = h ? h.name : `${NAMES[(a.seed * 3) % NAMES.length]} ${SURNAMES[(a.seed * 7 + 1) % SURNAMES.length]}`;
  const age = 24 + Math.floor(rng() * 34);
  const t1 = TRAITS[Math.floor(rng() * TRAITS.length)]; let t2 = TRAITS[Math.floor(rng() * TRAITS.length)]; if (t2 === t1) t2 = TRAITS[(TRAITS.indexOf(t1) + 5) % TRAITS.length];
  const years = 1 + Math.floor(rng() * 7);
  const doing = live?.current?.task ? `working on "${live.current.task}"` : live ? 'idle — waiting for the next work order' : 'getting on with it';
  const thought = live?.current?.task ? live.current.task : IDLE_THOUGHTS[Math.floor(rng() * IDLE_THOUGHTS.length)];
  return { name, age, role: h ? h.role : (a.isHead ? `Head of ${room.name}` : 'Team member'), traits: [t1, t2, room.short.toLowerCase()], thought, habit: HABITS[Math.floor(rng() * HABITS.length)], mood: live?.status === 'working' ? 'in the zone' : MOODS[Math.floor(rng() * MOODS.length)], doing, tenure: years === 1 ? '1 year here' : `${years} years here`, seated: !!a.seated, live, deptLabel: room.name };
}

export class HqScene {
  private canvas: HTMLCanvasElement;
  private sprite = new Image();
  private spriteReady = false;
  private state = { view: 'exterior' as View, activeRoomId: null as string | null, hoverRoomId: null as string | null, hoverLabelPos: null as Pt | null, selectedAgent: null as SceneAgent | null, transitionOpacity: 0, roomZoom: 1, roomPan: { x: 0, y: 0 } };
  private roomAgents: Record<string, SceneAgent[]> = {};
  private ambient: Record<string, Array<{ x: number; y: number; ang: number; speed: number }>> = {};
  private lastRoomBoxes: Array<{ id: string; name: string; x: number; y: number; w: number; h: number }> = [];
  private lastAgentScreens: Record<number, Pt> = {};
  private roomCam = { scale: 1, offX: 0, offY: 0 };
  private dragging = false; private lastMouse = { x: 0, y: 0 }; private mouseWasDragged = false;
  private lastT = 0; private timer: number | null = null; private raf: number | null = null;
  private enterFx: { t0: number; box: any; id: string } | null = null; private introT0 = 0;
  private execHeadList: SceneAgent[] | null = null;
  private wsCache: Record<string, any[]> = {}; private rectCache: Record<string, any[]> = {};
  private live: LiveData = { agentsByRoom: {}, meeting: null, workday: 'unknown' };
  private ui: ((u: UiState) => void) | null = null;
  private crowd: SceneAgent[] = [];
  private cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.sprite.onload = () => { this.spriteReady = true; };
    this.sprite.src = '/assets/sprites.png';
    ROOMS.forEach((d) => { this.ambient[d.id] = Array.from({ length: 8 }, () => ({ x: 0.12 + Math.random() * 0.76, y: 0.3 + Math.random() * 0.55, ang: Math.random() * Math.PI * 2, speed: 0.02 + Math.random() * 0.03 })); });
    this.ambient.exec = Array.from({ length: 5 }, () => ({ x: 0.25 + Math.random() * 0.5, y: 0.35 + Math.random() * 0.4, ang: Math.random() * Math.PI * 2, speed: 0.015 }));
    this.crowd = Array.from({ length: 22 }, (_, i) => ({ seed: 700000 + i * 3, char: i % SHEET.nChars, x: 260 + (i % 11) * 82 + Math.random() * 20, y: 560 + Math.floor(i / 11) * 60, dir: 3, frame: 1, frameClock: Math.random() * 1000, ang: 0, speed: 0, turnClock: 0, name: NAMES[i % NAMES.length], bubbleUntil: 0, bubbleText: '' }));
    const onMove = (e: MouseEvent) => this.handleMouseMove(e); const onDown = (e: MouseEvent) => this.handleMouseDown(e); const onUp = () => this.handleMouseUp(); const onClick = (e: MouseEvent) => this.handleClick(e); const onDbl = (e: MouseEvent) => this.handleDoubleClick(e); const onWheel = (e: WheelEvent) => { e.preventDefault(); this.handleWheel(e); }; const onKey = (e: KeyboardEvent) => this.handleKey(e);
    canvas.addEventListener('mousemove', onMove); canvas.addEventListener('mousedown', onDown); canvas.addEventListener('mouseup', onUp); canvas.addEventListener('mouseleave', onUp); canvas.addEventListener('click', onClick); canvas.addEventListener('dblclick', onDbl); canvas.addEventListener('wheel', onWheel, { passive: false }); window.addEventListener('keydown', onKey);
    this.cleanup.push(() => { canvas.removeEventListener('mousemove', onMove); canvas.removeEventListener('mousedown', onDown); canvas.removeEventListener('mouseup', onUp); canvas.removeEventListener('mouseleave', onUp); canvas.removeEventListener('click', onClick); canvas.removeEventListener('dblclick', onDbl); canvas.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); });
    this.lastT = performance.now();
    this.timer = window.setInterval(() => this.draw(performance.now()), 16);
  }

  destroy() { if (this.timer) clearInterval(this.timer); if (this.raf) cancelAnimationFrame(this.raf); this.cleanup.forEach((f) => f()); }
  setUiListener(fn: (u: UiState) => void) { this.ui = fn; this.emitUi(); }
  setLive(live: LiveData) { this.live = live; this.bindLiveAgents(); }
  getView() { return this.state.view; }
  getActiveRoom() { return this.state.activeRoomId; }

  private setState(patch: Partial<typeof this.state>) { Object.assign(this.state, patch); this.emitUi(); }
  private emitUi() {
    if (!this.ui) return;
    const s = this.state; const room = s.activeRoomId ? ROOM_BY_ID[s.activeRoomId] : null;
    let breadcrumb = 'Outside'; if (s.view === 'building') breadcrumb = 'Building Overview'; if (s.view === 'room' && room) breadcrumb = `Building Overview / ${room.name}`;
    const hint = s.view === 'exterior' ? 'Click Enter Headquarters to go inside.' : s.view === 'building' ? 'Hover a room to see its name · click to enter.' : 'Scroll or double-click to zoom · drag to pan · click an agent for their live report.';
    const sel = s.selectedAgent; const sp = sel ? this.lastAgentScreens[sel.seed] : null;
    this.ui({ view: s.view, activeRoomId: s.activeRoomId, breadcrumb, hint, hoverLabel: s.view === 'building' && s.hoverRoomId ? ROOM_BY_ID[s.hoverRoomId].name : null, hoverPos: s.hoverLabelPos, zoom: s.roomZoom, showEnter: s.view === 'exterior', selected: sel, selectedScreen: sp ?? null, cursor: s.view === 'building' && s.hoverRoomId ? 'pointer' : s.view === 'room' ? 'grab' : 'default' });
  }

  /* ── live binding: real agents ↔ sprites ────────────────────────────── */
  private bindLiveAgents() {
    for (const room of ROOMS) {
      const list = this.roomAgents[room.id]; if (!list) continue;
      const live = this.live.agentsByRoom[room.id] ?? [];
      const heads = live.filter((a) => a.agent_id.endsWith('.head'));
      const others = live.filter((a) => !a.agent_id.endsWith('.head'));
      const ordered = [...heads, ...others.filter((a) => a.status === 'working'), ...others.filter((a) => a.status !== 'working')];
      list.forEach((a, i) => { const l = ordered[i] ?? null; a.live = l; a.isHead = Boolean(l?.agent_id.endsWith('.head')); if (a.persona) a.persona = personaFor(room, a); });
      // extra live agents beyond walker count get seated at workstations
      const ws = this.workstations(room); const extra = ordered.slice(list.length);
      ws.forEach((w, i) => { w.agent.live = extra[i] ?? null; w.agent.isHead = Boolean(extra[i]?.agent_id.endsWith('.head')); if (w.agent.persona) w.agent.persona = personaFor(room, w.agent); });
    }
    if (this.execHeadList) this.execHeadList.forEach((h) => { const live = (this.live.agentsByRoom[h.deptId!] ?? []).find((a) => a.agent_id.endsWith('.head')) ?? null; h.live = live; if (h.persona) h.persona = personaFor(ROOM_BY_ID[h.deptId!], h); });
    if (this.state.selectedAgent?.persona) this.emitUi();
  }

  private ensureRoomAgents(id: string) {
    if (this.roomAgents[id] || id === 'exec') return;
    const rng = mulberry32(id.length * 7919 + id.charCodeAt(0)); const lanes = [190, 332, 418, 530];
    this.roomAgents[id] = Array.from({ length: AGENTS_PER_ROOM }, (_, i) => ({ x: 90 + rng() * (ROOM_W - 180), y: lanes[i % lanes.length] + (rng() - 0.5) * 18, char: i % SHEET.nChars, dir: 0, frame: 1, frameClock: rng() * 1000, ang: rng() * Math.PI * 2, speed: 18 + rng() * 22, turnClock: rng() * 3, seed: id.length * 1000 + i, name: NAMES[(id.length * 3 + i) % NAMES.length], bubbleUntil: 0, bubbleText: '' }));
    this.bindLiveAgents();
  }

  /* ── navigation ─────────────────────────────────────────────────────── */
  goTo(view: View, activeRoomId?: string | null) {
    this.setState({ transitionOpacity: 1 });
    setTimeout(() => { if (view === 'room' && activeRoomId) this.ensureRoomAgents(activeRoomId); this.setState({ view, activeRoomId: activeRoomId ?? null, hoverRoomId: null, selectedAgent: null, roomZoom: 1, roomPan: { x: 0, y: 0 } }); requestAnimationFrame(() => setTimeout(() => this.setState({ transitionOpacity: 0 }), 20)); }, 260);
  }
  enterBuilding = () => this.goTo('building');
  enterRoom = (id: string) => { if (!id || id === 'LOBBY') return; const box = this.lastRoomBoxes.find((b) => b.id === id); if (!box) { this.goTo('room', id); return; } this.enterFx = { t0: performance.now(), box, id }; this.setState({ hoverRoomId: null, hoverLabelPos: null }); };
  goBack = () => { if (this.state.view === 'room') this.goTo('building'); else if (this.state.view === 'building') this.goTo('exterior'); };
  ZOOM_MIN = 1; ZOOM_MAX = 3.2;
  zoomIn = () => this.zoomBy(1.3); zoomOut = () => this.zoomBy(1 / 1.3); resetZoom = () => this.setState({ roomZoom: 1, roomPan: { x: 0, y: 0 } });
  closeCard = () => this.setState({ selectedAgent: null });
  private zoomTo(z: number, anchor?: Pt) { const s = this.state; const next = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, z)); if (Math.abs(next - s.roomZoom) < 0.001) return; if (next <= 1.001) { this.setState({ roomZoom: 1, roomPan: { x: 0, y: 0 } }); return; } const cam = this.roomCam; const p = anchor || { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 }; const scaleNext = cam.scale * (next / s.roomZoom); const wx = (p.x - cam.offX) / cam.scale, wy = (p.y - cam.offY) / cam.scale; const baseX = cam.offX - s.roomPan.x + (ROOM_W / 2) * (cam.scale - scaleNext); const baseY = cam.offY - s.roomPan.y + 34 * (cam.scale - scaleNext); this.setState({ roomZoom: next, roomPan: { x: p.x - wx * scaleNext - baseX, y: p.y - wy * scaleNext - baseY } }); }
  private zoomBy(f: number, anchor?: Pt) { this.zoomTo(this.state.roomZoom * f, anchor); }
  private canvasPoint(e: MouseEvent): Pt { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private handleWheel(e: WheelEvent) { if (this.state.view !== 'room') return; const dy = e.deltaY || 0; if (!dy) return; this.zoomBy(dy < 0 ? 1.12 : 1 / 1.12, this.canvasPoint(e)); }
  private handleDoubleClick(e: MouseEvent) { if (this.state.view !== 'room') return; this.zoomBy(1.6, this.canvasPoint(e)); }
  private handleKey(e: KeyboardEvent) { if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return; if (this.state.view !== 'room') return; if (e.key === '+' || e.key === '=') this.zoomBy(1.3); else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.3); else if (e.key === '0') this.resetZoom(); }
  private handleMouseDown(e: MouseEvent) { this.dragging = true; this.mouseWasDragged = false; this.lastMouse = this.canvasPoint(e); }
  private handleMouseUp() { this.dragging = false; }
  private clickables(id: string): SceneAgent[] { const room = ROOM_BY_ID[id]; const walkers = this.roomAgents[id] || []; if (id === 'exec') return [...this.execHeads(), ...(this.live.meeting === 'all_hands' ? this.crowd : [])]; if (!room) return walkers; return walkers.concat(this.workstations(room).map((ws: any) => ws.agent)); }
  private execHeads(): SceneAgent[] { if (!this.execHeadList) this.execHeadList = ROOMS.map((d, i) => ({ seed: 900000 + i * 7, char: i % SHEET.nChars, seated: true, deptId: d.id, isHead: true, x: 0, y: 0, dir: 0, frame: 1, frameClock: 0, ang: 0, speed: 0, turnClock: 0, name: '', bubbleUntil: 0, bubbleText: '' })); return this.execHeadList; }
  private pickAgent(id: string, p: Pt) { let hit: SceneAgent | null = null, bestD = 30 * 30; for (const a of this.clickables(id)) { const sp = this.lastAgentScreens[a.seed]; if (!sp) continue; const d = (p.x - sp.x) ** 2 + (p.y - sp.y) ** 2; if (d < bestD) { bestD = d; hit = a; } } return hit; }
  private handleMouseMove(e: MouseEvent) { const p = this.canvasPoint(e); if (this.state.view === 'building') { let hit: any = null; for (const b of this.lastRoomBoxes) { if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { hit = b; break; } } if ((hit ? hit.id : null) !== this.state.hoverRoomId) this.setState({ hoverRoomId: hit ? hit.id : null, hoverLabelPos: hit ? { x: hit.x + hit.w / 2, y: hit.y } : null }); } else if (this.state.view === 'room' && this.dragging && this.state.roomZoom > 1.02) { const dx = p.x - this.lastMouse.x, dy = p.y - this.lastMouse.y; if (Math.abs(dx) + Math.abs(dy) > 2) this.mouseWasDragged = true; this.state.roomPan = { x: this.state.roomPan.x + dx, y: this.state.roomPan.y + dy }; this.lastMouse = p; } }
  private handleClick(e: MouseEvent) {
    if (this.mouseWasDragged) { this.mouseWasDragged = false; return; }
    const p = this.canvasPoint(e);
    if (this.state.view === 'building') { for (const b of this.lastRoomBoxes) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { this.enterRoom(b.id); return; } }
    else if (this.state.view === 'room' && this.state.activeRoomId) {
      const hit = this.pickAgent(this.state.activeRoomId, p); const room = ROOM_BY_ID[(hit && hit.deptId) || this.state.activeRoomId];
      if (hit) { hit.persona = personaFor(room, hit); if (hit.isHead && !hit.live) { hit.persona.role = `Head of ${room.name}`; hit.persona.where = 'Chairing the exec meeting'; } if (hit.isHead && hit.live) hit.persona.where = this.state.activeRoomId === 'exec' ? 'In the executive meeting' : 'Leading the room'; hit.bubbleUntil = performance.now() + 3200; hit.bubbleText = hit.persona.thought.slice(0, 40); this.setState({ selectedAgent: hit }); }
      else this.setState({ selectedAgent: null });
    }
  }
  drawAvatar(canvas: HTMLCanvasElement, a: SceneAgent) { if (!canvas || !this.spriteReady) return; const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, canvas.width, canvas.height); const bx = (a.char % SHEET.perRow) * SHEET.blockW, by = Math.floor(a.char / SHEET.perRow) * SHEET.blockH; ctx.drawImage(this.sprite, bx + SHEET.cell, by, SHEET.cell, SHEET.cell, 0, 0, canvas.width, canvas.height); }

  /* ── main loop ──────────────────────────────────────────────────────── */
  private resize() { const c = this.canvas; const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight; if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return { w, h }; }
  private draw(now: number) {
    const { w, h } = this.resize(); const ctx = this.canvas.getContext('2d')!; const dt = Math.min(0.05, (now - this.lastT) / 1000); this.lastT = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, w, h);
    if (this.enterFx && this.state.view === 'building') {
      const fx = this.enterFx, p = Math.min(1, (now - fx.t0) / 520), e = smoothstep(p); const cx = fx.box.x + fx.box.w / 2, cy = fx.box.y + fx.box.h / 2; const k = 1 + 2.6 * e;
      ctx.save(); ctx.translate(cx + (w / 2 - cx) * e, cy + (h / 2 - cy) * e); ctx.scale(k, k); ctx.translate(-cx, -cy); this.drawBuilding(ctx, w, h, now, dt); ctx.restore();
      ctx.fillStyle = `rgba(10,14,26,${(e * e).toFixed(3)})`; ctx.fillRect(0, 0, w, h);
      if (p >= 1) { this.enterFx = null; this.introT0 = performance.now(); this.ensureRoomAgents(fx.id); this.setState({ view: 'room', activeRoomId: fx.id, selectedAgent: null, roomZoom: 1, roomPan: { x: 0, y: 0 }, transitionOpacity: 0 }); }
      return;
    }
    if (this.state.view === 'exterior') this.drawExterior(ctx, w, h, now); else if (this.state.view === 'building') this.drawBuilding(ctx, w, h, now, dt); else this.drawRoom(ctx, w, h, now, dt);
    if (this.state.transitionOpacity > 0) { ctx.fillStyle = `rgba(10,14,26,${this.state.transitionOpacity})`; ctx.fillRect(0, 0, w, h); }
    if (this.state.selectedAgent) this.emitUi(); // keep the card anchored while sprites move
  }

  /* ── exterior ───────────────────────────────────────────────────────── */
  private extrudedBox(ctx: CanvasRenderingContext2D, x0: number, x1: number, yTop: number, yBot: number, shx: number, shy: number, colors: { roof: string; side: string; front: string }) { const bTL = shear(x0, yTop, 1, shx, shy), bTR = shear(x1, yTop, 1, shx, shy), bBR = shear(x1, yBot, 1, shx, shy); ctx.fillStyle = colors.roof; quadPath(ctx, { x: x0, y: yTop }, { x: x1, y: yTop }, bTR, bTL); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = colors.side; quadPath(ctx, { x: x1, y: yTop }, { x: x1, y: yBot }, bBR, bTR); ctx.fill(); ctx.stroke(); ctx.fillStyle = colors.front; ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop); }
  private skyline(ctx: CanvasRenderingContext2D, w: number, seed: number, baseY: number, maxH: number, color: string, alpha: number, litAlpha: number, now: number) { const rng = mulberry32(seed); let x = -30; while (x < w + 40) { const bw = 40 + rng() * 90, bh = 40 + rng() * maxH, top = baseY - bh; ctx.fillStyle = withAlpha(color, alpha); ctx.fillRect(x, top, bw, baseY - top); if (rng() > 0.6) ctx.fillRect(x + bw * 0.35, top - 10, 4, 10); const cols = Math.max(1, Math.floor(bw / 14)), rows = Math.max(1, Math.floor(bh / 16)); for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (rng() > 0.72) { const flick = Math.sin(now / 1600 + c * 3.1 + r * 1.7 + seed) > -0.9 ? 1 : 0.35; ctx.fillStyle = withAlpha('#F4A661', litAlpha * flick); ctx.fillRect(x + 6 + c * 14, top + 8 + r * 16, 5, 6); } x += bw + 6 + rng() * 14; } }
  private cityTree(ctx: CanvasRenderingContext2D, x: number, groundY: number, s: number) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, groundY + 2, 20 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#242b40'; ctx.fillRect(x - 15 * s, groundY - 12 * s, 30 * s, 12 * s); ctx.fillStyle = '#3b3226'; ctx.fillRect(x - 2.5 * s, groundY - 44 * s, 5 * s, 32 * s); [[0, -52, 15], [-11, -46, 11], [11, -47, 10], [-5, -62, 10], [7, -60, 9]].forEach((b, i) => { ctx.fillStyle = i % 2 ? '#2f5a41' : '#3c6b4b'; ctx.beginPath(); ctx.arc(x + b[0] * s, groundY + b[1] * s, b[2] * s, 0, Math.PI * 2); ctx.fill(); }); }
  private streetLamp(ctx: CanvasRenderingContext2D, x: number, groundY: number, dir: number, now: number, i: number) { const poleH = 96; ctx.fillStyle = '#2b3247'; ctx.fillRect(x - 2, groundY - poleH, 4, poleH); ctx.fillRect(x - 5, groundY - 4, 10, 4); ctx.fillRect(x, groundY - poleH - 2, dir * 22, 4); const hx = x + dir * 22, hy = groundY - poleH; ctx.fillStyle = '#3a4258'; ctx.fillRect(hx - 7 * dir, hy, 14 * dir, 6); const flick = 0.9 + 0.1 * Math.sin(now / 700 + i * 2.3); const g = ctx.createLinearGradient(hx, hy, hx, groundY); g.addColorStop(0, withAlpha('#F4A661', 0.22 * flick)); g.addColorStop(1, withAlpha('#F4A661', 0)); ctx.fillStyle = g; quadPath(ctx, { x: hx - 8, y: hy + 6 }, { x: hx + 8, y: hy + 6 }, { x: hx + 52, y: groundY }, { x: hx - 52, y: groundY }); ctx.fill(); ctx.fillStyle = withAlpha('#FFD9A8', 0.95 * flick); ctx.fillRect(hx - 5, hy + 5, 10, 3); }
  private drawExterior(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
    const groundY = Math.round(h * 0.8), curbY = groundY - 26;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY); sky.addColorStop(0, '#05070F'); sky.addColorStop(0.45, '#0D1324'); sky.addColorStop(0.78, '#1B2138'); sky.addColorStop(1, '#39304a'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, groundY);
    const srng = mulberry32(42); for (let i = 0; i < 130; i++) { const sx = srng() * w, sy = srng() * h * 0.55, tw = 0.35 + 0.65 * ((Math.sin(now / 900 + i * 1.7) + 1) / 2); ctx.fillStyle = withAlpha('#F5F2EC', 0.5 * tw * (1 - sy / (h * 0.62))); ctx.fillRect(sx, sy, srng() > 0.85 ? 2 : 1, srng() > 0.85 ? 2 : 1); }
    const mx = w * 0.16, my = h * 0.17; const halo = ctx.createRadialGradient(mx, my, 4, mx, my, 96); halo.addColorStop(0, 'rgba(245,242,236,0.20)'); halo.addColorStop(1, 'rgba(245,242,236,0)'); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 96, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#EDE9DF'; ctx.beginPath(); ctx.arc(mx, my, 17, 0, Math.PI * 2); ctx.fill();
    const haze = ctx.createLinearGradient(0, curbY - 210, 0, curbY); haze.addColorStop(0, 'rgba(230,106,44,0)'); haze.addColorStop(1, 'rgba(230,106,44,0.16)'); ctx.fillStyle = haze; ctx.fillRect(0, curbY - 210, w, 210);
    this.skyline(ctx, w, 11, curbY - 8, 150, '#0E1424', 0.9, 0.10, now); this.skyline(ctx, w, 23, curbY - 4, 118, '#141B2E', 0.95, 0.16, now); this.skyline(ctx, w, 37, curbY, 86, '#1A2135', 1, 0.24, now);
    const bw = Math.min(w * 0.27, 360), bh = Math.min(h * 0.5, 330); const x0 = w / 2 - bw / 2, x1 = w / 2 + bw / 2, yTop = curbY - bh, yBot = curbY;
    const tg = ctx.createRadialGradient(w / 2, yTop + bh * 0.4, 20, w / 2, yTop + bh * 0.4, bw * 1.5); tg.addColorStop(0, 'rgba(244,166,97,0.11)'); tg.addColorStop(1, 'rgba(244,166,97,0)'); ctx.fillStyle = tg; ctx.fillRect(x0 - bw, yTop - 120, bw * 3, bh + 220);
    this.extrudedBox(ctx, x0, x1, yTop, yBot, BUILD_SHX * 0.8, BUILD_SHY * 0.8, { roof: '#2C3348', side: '#101623', front: '#161D2E' });
    const cols = 5, rows = 8, pad = 12, cw = (bw - pad * 2) / cols, ch = (bh - pad * 2 - 40) / rows; const wrng = mulberry32(9); const night = this.live.workday === 'night';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const wx = x0 + pad + c * cw + 2, wy = yTop + pad + r * ch + 2, ww = cw - 5, wh2 = ch - 5; const on = wrng(); const pulse = (Math.sin(now / 1400 + r * 2.1 + c * 3.3) + 1) / 2; if (on > (night ? 0.8 : 0.34)) { const warm = on > 0.86 ? '#7fd4e8' : on > 0.62 ? '#F4A661' : '#E9B279'; const gg = ctx.createLinearGradient(wx, wy, wx, wy + wh2); gg.addColorStop(0, withAlpha(warm, 0.9)); gg.addColorStop(1, withAlpha(warm, 0.5 + 0.25 * pulse)); ctx.fillStyle = gg; ctx.fillRect(wx, wy, ww, wh2); ctx.fillStyle = 'rgba(10,14,26,0.35)'; ctx.fillRect(wx, wy + wh2 * 0.55, ww, 1.5); if (on > 0.7) { ctx.fillStyle = 'rgba(20,26,43,0.55)'; ctx.fillRect(wx + ww * 0.55, wy + wh2 * 0.35, ww * 0.16, wh2 * 0.65); } } else { ctx.fillStyle = '#1D2437'; ctx.fillRect(wx, wy, ww, wh2); ctx.fillStyle = 'rgba(245,242,236,0.04)'; ctx.fillRect(wx, wy, ww, wh2 * 0.3); } }
    for (let r = 0; r < rows; r++) { const y0 = yTop + pad + r * ch + 4, y1b = y0 + ch - 9; const p0 = shear(x1, y0, 0.1, BUILD_SHX * 0.8, BUILD_SHY * 0.8), p1 = shear(x1, y0, 0.9, BUILD_SHX * 0.8, BUILD_SHY * 0.8), p2 = shear(x1, y1b, 0.9, BUILD_SHX * 0.8, BUILD_SHY * 0.8), p3 = shear(x1, y1b, 0.1, BUILD_SHX * 0.8, BUILD_SHY * 0.8); const lit = (Math.sin(now / 1100 + r * 4.7) + 1) / 2; ctx.fillStyle = withAlpha('#F4A661', 0.10 + 0.22 * lit); quadPath(ctx, p0, p1, p2, p3); ctx.fill(); }
    ctx.fillStyle = '#3A4259'; ctx.fillRect(x0, yTop - 6, bw, 6); const mastX = x0 + bw * 0.5; ctx.fillStyle = '#2b3247'; ctx.fillRect(mastX - 1.5, yTop - 52, 3, 46); const beacon = (Math.sin(now / 420) + 1) / 2; ctx.fillStyle = withAlpha('#E66A2C', 0.25 + 0.6 * beacon); ctx.beginPath(); ctx.arc(mastX, yTop - 54, 8 + 4 * beacon, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = withAlpha('#F4A661', 0.6 + 0.4 * beacon); ctx.beginPath(); ctx.arc(mastX, yTop - 54, 3, 0, Math.PI * 2); ctx.fill();
    const strip = ctx.createLinearGradient(0, yTop, 0, yBot); strip.addColorStop(0, withAlpha('#E66A2C', 0.75)); strip.addColorStop(1, withAlpha('#E66A2C', 0.15)); ctx.fillStyle = strip; ctx.fillRect(x1 - 4, yTop + 8, 3, bh - 60);
    const label = (this.live.ventureName ? this.live.ventureName.toUpperCase().slice(0, 22) : 'AI COMPANY HQ'); const sgW = Math.max(200, label.length * 9 + 40), sgH = 30, sgX = w / 2 - sgW / 2, sgY = yTop + BUILD_SHY * 0.8 - 44; ctx.fillStyle = withAlpha('#E66A2C', 0.14); roundRect(ctx, sgX - 10, sgY - 8, sgW + 20, sgH + 16, 6); ctx.fill(); ctx.fillStyle = '#0A0E1A'; roundRect(ctx, sgX, sgY, sgW, sgH, 3); ctx.fill(); ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 1.5; roundRect(ctx, sgX, sgY, sgW, sgH, 3); ctx.stroke(); ctx.fillStyle = '#F4A661'; ctx.font = "600 13px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.fillText(label, w / 2, sgY + 20);
    const lobH = 62, lobY = yBot - lobH; const lg = ctx.createLinearGradient(0, lobY, 0, yBot); lg.addColorStop(0, 'rgba(244,166,97,0.42)'); lg.addColorStop(1, 'rgba(230,106,44,0.20)'); ctx.fillStyle = lg; ctx.fillRect(x0 + 6, lobY, bw - 12, lobH); ctx.strokeStyle = 'rgba(10,14,26,0.5)'; ctx.lineWidth = 2; for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x0 + 6 + (bw - 12) * (i / 6), lobY); ctx.lineTo(x0 + 6 + (bw - 12) * (i / 6), yBot); ctx.stroke(); }
    const doorW = 62, doorH = 52, dgx = w / 2 - doorW / 2, dgy = yBot - doorH; ctx.fillStyle = '#080B14'; ctx.fillRect(dgx, dgy, doorW, doorH); ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 2; ctx.strokeRect(dgx, dgy, doorW, doorH); ctx.fillStyle = withAlpha('#F4A661', 0.5); ctx.fillRect(dgx + doorW / 2 - 1, dgy + 4, 2, doorH - 8);
    const spill = ctx.createLinearGradient(0, yBot, 0, groundY + 26); spill.addColorStop(0, 'rgba(244,166,97,0.30)'); spill.addColorStop(1, 'rgba(244,166,97,0)'); ctx.fillStyle = spill; quadPath(ctx, { x: dgx - 6, y: yBot }, { x: dgx + doorW + 6, y: yBot }, { x: dgx + doorW + 58, y: groundY + 26 }, { x: dgx - 58, y: groundY + 26 }); ctx.fill();
    ctx.fillStyle = '#1C2233'; ctx.fillRect(0, curbY, w, groundY - curbY); ctx.fillStyle = '#232B40'; ctx.fillRect(0, curbY, w, 3); ctx.strokeStyle = 'rgba(245,242,236,0.045)'; ctx.lineWidth = 1; for (let px = -40; px < w + 40; px += 46) { ctx.beginPath(); ctx.moveTo(px, curbY + 4); ctx.lineTo(px - 18, groundY); ctx.stroke(); }
    ctx.fillStyle = '#0F1421'; ctx.fillRect(0, groundY, w, h - groundY); const wet = ctx.createLinearGradient(0, groundY, 0, h); wet.addColorStop(0, 'rgba(244,166,97,0.10)'); wet.addColorStop(1, 'rgba(244,166,97,0)'); ctx.fillStyle = wet; ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = 'rgba(245,242,236,0.22)'; const laneY = groundY + (h - groundY) * 0.42; for (let sx = (now / 55) % 72 - 72; sx < w; sx += 72) ctx.fillRect(sx, laneY, 34, 3);
    this.streetLamp(ctx, w * 0.5 - bw * 0.72, curbY, 1, now, 0); this.streetLamp(ctx, w * 0.5 + bw * 0.72, curbY, -1, now, 1); this.streetLamp(ctx, w * 0.12, curbY, 1, now, 2); this.streetLamp(ctx, w * 0.88, curbY, -1, now, 3);
    this.cityTree(ctx, w * 0.5 - bw * 0.95, curbY, 1); this.cityTree(ctx, w * 0.5 + bw * 0.95, curbY, 1); this.cityTree(ctx, w * 0.06, curbY, 0.88); this.cityTree(ctx, w * 0.94, curbY, 0.88);
    const cars = [{ x: ((now / 16) % (w + 260)) - 130, dir: 1, y: groundY + (h - groundY) * 0.2, col: '#caa23c' }, { x: w - (((now / 13 + 400) % (w + 300)) - 150), dir: -1, y: groundY + (h - groundY) * 0.6, col: '#7f8caa' }];
    cars.forEach((car) => { const cy = Math.min(car.y, h - 22); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(car.x - 2, cy + 15, 58, 4); ctx.fillStyle = car.col; ctx.fillRect(car.x, cy, 54, 15); ctx.fillStyle = '#0A0E1A'; ctx.fillRect(car.x + 8, cy - 9, 36, 10); ctx.fillStyle = withAlpha('#9fd8ff', 0.35); ctx.fillRect(car.x + 11, cy - 7, 30, 6); ctx.fillStyle = '#0d1120'; ctx.fillRect(car.x + 7, cy + 13, 9, 5); ctx.fillRect(car.x + 38, cy + 13, 9, 5); const hx = car.dir > 0 ? car.x + 54 : car.x; const hg = ctx.createLinearGradient(hx, cy + 6, hx + car.dir * 90, cy + 6); hg.addColorStop(0, 'rgba(255,231,178,0.42)'); hg.addColorStop(1, 'rgba(255,231,178,0)'); ctx.fillStyle = hg; quadPath(ctx, { x: hx, y: cy + 2 }, { x: hx, y: cy + 13 }, { x: hx + car.dir * 92, y: cy + 22 }, { x: hx + car.dir * 92, y: cy - 6 }); ctx.fill(); });
    if (this.spriteReady) { const peds = [{ u: ((now / 90) % (w + 200) - 100) / w, dir: 2, c: 0 }, { u: 1 - ((now / 110 + 320) % (w + 240) - 120) / w, dir: 1, c: 3 }, { u: (w * 0.5 - bw * 0.3) / w, dir: 0, c: 6 }, { u: (w * 0.5 + bw * 0.34) / w, dir: 0, c: 8 }]; peds.forEach((p, i) => { const px = p.u * w, py = curbY - 4 + (i % 2) * 8; const frame = WALK[Math.floor(now / (1000 / WALK_FPS) + i) % WALK.length]; const bx2 = (p.c % SHEET.perRow) * SHEET.blockW, by2 = Math.floor(p.c / SHEET.perRow) * SHEET.blockH; ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(px, py + 1, 8, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.drawImage(this.sprite, bx2 + frame * SHEET.cell, by2 + p.dir * SHEET.cell, SHEET.cell, SHEET.cell, px - 13, py - 26, 26, 26); }); }
    const vg = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.32, w / 2, h * 0.5, Math.max(w, h) * 0.78); vg.addColorStop(0, 'rgba(5,7,15,0)'); vg.addColorStop(1, 'rgba(5,7,15,0.72)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  /* ── building cutaway ───────────────────────────────────────────────── */
  private floorWall(ctx: CanvasRenderingContext2D, x: number, floorY: number, shx: number, shy: number, color: string, alpha?: number) { const p0 = { x, y: floorY }, p1 = { x, y: floorY - WALL_H }, p2 = shear(x, floorY - WALL_H, 1, shx, shy), p3 = shear(x, floorY, 1, shx, shy); ctx.fillStyle = withAlpha(color, alpha == null ? 1 : alpha); quadPath(ctx, p0, p1, p2, p3); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke(); }
  private boxFromCorners(id: string, name: string, pts: Pt[]) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); } return { id, name, x: minX, y: minY, w: maxX - minX, h: maxY - minY }; }
  private drawBuilding(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number) {
    ctx.fillStyle = '#0A0E1A'; ctx.fillRect(0, 0, w, h);
    const shx = FLOOR_SHX, shy = FLOOR_SHY; const n = FLOOR_LAYOUT.length; const floorStep = WALL_H + 16; const contentH = (n - 1) * floorStep + WALL_H + 40;
    // Fit the cutaway to short viewports (laptop screens ~900px tall): the whole
    // building is ~930px, so the bottom floor used to render below the fold. Scale
    // about the horizontal centre; room hit boxes are mapped back to screen space below.
    const HUD_TOP = 64, HUD_BOT = 60; const k = Math.min(1, (h - HUD_TOP - HUD_BOT) / contentH);
    const bw = Math.min(w * 0.86, 1180) / k; const x0 = w / 2 - bw / 2, x1 = w / 2 + bw / 2;
    const roofY = k < 1 ? HUD_TOP : Math.max(HUD_TOP, (h - contentH) / 2); const baseY = roofY + contentH;
    const ox = (w / 2) * (1 - k), oy = roofY * (1 - k); ctx.save(); ctx.translate(ox, oy); ctx.scale(k, k);
    const meeting = this.live.meeting; const night = this.live.workday === 'night';
    this.lastRoomBoxes = [];
    FLOOR_LAYOUT.forEach((floorIds, fi) => {
      const floorY = baseY - (n - 1 - fi) * floorStep; this.floorWall(ctx, x0, floorY, shx, shy, '#12172a'); this.floorWall(ctx, x1, floorY, shx, shy, '#12172a');
      const roomCount = floorIds.length, roomW = bw / roomCount;
      floorIds.forEach((id, ci) => {
        const rx = x0 + ci * roomW, rw = roomW; const isLobby = id === 'LOBBY'; const room = isLobby ? null : ROOM_BY_ID[id]; const hovered = !isLobby && this.state.hoverRoomId === id; const baseColor = isLobby ? '#232a40' : room!.color;
        const fp = [{ x: rx, y: floorY }, { x: rx + rw, y: floorY }, shear(rx + rw, floorY, 1, shx, shy), shear(rx, floorY, 1, shx, shy)];
        const dark = night && id !== 'exec' && !isLobby;
        ctx.fillStyle = withAlpha(baseColor, hovered ? 0.34 : isLobby ? 0.14 : dark ? 0.08 : 0.18); quadPath(ctx, fp[0], fp[1], fp[2], fp[3]); ctx.fill(); ctx.strokeStyle = hovered ? '#E66A2C' : withAlpha(baseColor, 0.5); ctx.lineWidth = hovered ? 2 : 1; ctx.stroke();
        const bwTop = { x: fp[3].x, y: fp[3].y - WALL_H }, bwTop2 = { x: fp[2].x, y: fp[2].y - WALL_H }; ctx.fillStyle = withAlpha(baseColor, isLobby ? 0.18 : dark ? 0.12 : 0.28); quadPath(ctx, fp[3], fp[2], bwTop2, bwTop); ctx.fill(); ctx.strokeStyle = withAlpha(baseColor, 0.55); ctx.lineWidth = 1; ctx.stroke();
        if (ci < roomCount - 1) this.floorWall(ctx, rx + rw, floorY, shx, shy, '#0e1322', 0.7);
        if (!isLobby) {
          this.lastRoomBoxes.push(this.boxFromCorners(id, room!.name, [fp[0], fp[1], fp[2], fp[3], bwTop, bwTop2]));
          const liveList = this.live.agentsByRoom[id] ?? []; const working = liveList.filter((a) => a.status === 'working').length;
          const emptyRoom = meeting === 'all_hands' && id !== 'exec';
          if (id !== 'exec') {
            [0.28, 0.5, 0.72].forEach((ux, di) => { const top = lerpPt(fp[0], fp[1], ux), bot = lerpPt(fp[3], fp[2], ux); const dp = lerpPt(top, bot, 0.42); const dw = 34, dh = 13; ctx.fillStyle = '#3a2c1e'; ctx.fillRect(dp.x - dw / 2, dp.y - dh / 2 + 3, dw, dh); ctx.fillStyle = '#5a4732'; ctx.fillRect(dp.x - dw / 2, dp.y - dh / 2, dw, dh * 0.45); ctx.fillStyle = '#1a1a1a'; ctx.fillRect(dp.x - 1.5, dp.y - dh / 2 - 6, 3, 6); const lit = !emptyRoom && (!night || working > di); ctx.fillStyle = lit ? withAlpha(room!.color, 0.85) : '#1d2434'; ctx.fillRect(dp.x - dw * 0.22, dp.y - dh / 2 - 15, dw * 0.44, dh * 0.75); ctx.fillStyle = '#2a2015'; ctx.beginPath(); ctx.ellipse(dp.x, dp.y + dh + 9, 7, 5, 0, 0, Math.PI * 2); ctx.fill(); if (this.spriteReady && !emptyRoom && (working > di || (!night && liveList.length === 0))) { const bx2 = (di % SHEET.perRow) * SHEET.blockW, by2 = Math.floor(di / SHEET.perRow) * SHEET.blockH; ctx.drawImage(this.sprite, bx2 + SHEET.cell, by2 + 3 * SHEET.cell, SHEET.cell, SHEET.cell, dp.x - 9, dp.y + dh - 4, 18, 18); } });
          }
          const amb = id === 'exec' ? this.ambient.exec : (this.ambient[id] || []);
          const ambCount = id === 'exec' ? (meeting === 'all_hands' ? 5 : meeting === 'executive' ? 3 : 1) : emptyRoom ? 0 : night ? 1 : Math.min(8, Math.max(2, Math.ceil(liveList.length / 2)));
          for (const [ai, a] of amb.slice(0, ambCount).entries()) { a.x += Math.cos(a.ang) * a.speed * dt; a.y += Math.sin(a.ang) * a.speed * dt; if (a.x < 0.12 || a.x > 0.88 || a.y < 0.06 || a.y > 0.26) a.ang += Math.PI; const top = lerpPt(fp[0], fp[1], a.x), bot = lerpPt(fp[3], fp[2], a.x); const p = lerpPt(top, bot, a.y); if (this.spriteReady) { const bx2 = (ai % SHEET.perRow) * SHEET.blockW, by2 = Math.floor(ai / SHEET.perRow) * SHEET.blockH; const frame = Math.sin(now / 300 + ai) > 0 ? 1 : 0; ctx.drawImage(this.sprite, bx2 + frame * SHEET.cell, by2, SHEET.cell, SHEET.cell, p.x - 13, p.y - 26, 26, 26); } }
          // live badges: pending gates + working count
          const gates = this.live.pendingGatesByRoom?.[id] ?? 0;
          if (gates > 0) { const gp = lerpPt(fp[1], fp[2], 0.6); ctx.fillStyle = '#E66A2C'; ctx.beginPath(); ctx.arc(gp.x - 14, gp.y - WALL_H + 14, 9 + Math.sin(now / 300) * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#0A0E1A'; ctx.font = "700 10px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(gates), gp.x - 14, gp.y - WALL_H + 15); ctx.textBaseline = 'alphabetic'; }
          if (working > 0 && id !== 'exec') { const gp = lerpPt(fp[0], fp[3], 0.55); ctx.fillStyle = 'rgba(79,209,138,0.9)'; ctx.beginPath(); ctx.arc(gp.x + 12, gp.y - WALL_H + 14, 4 + Math.sin(now / 400) * 1, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#9fd8a5'; ctx.font = "600 9px 'JetBrains Mono', monospace"; ctx.textAlign = 'left'; ctx.fillText(`${working} working`, gp.x + 20, gp.y - WALL_H + 17); }
        }
        const backMid = lerpPt(fp[3], fp[2], 0.5); ctx.font = "600 13px 'Inter Tight', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const label = isLobby ? 'LOBBY' : id === 'exec' && meeting === 'all_hands' ? 'ALL-HANDS · everyone here' : id === 'exec' && meeting === 'executive' ? 'EXECUTIVE MEETING' : room!.name; const maxTextW = rw - 40; const lines: string[] = []; let cur = ''; for (const word of label.split(' ')) { const trial = cur ? cur + ' ' + word : word; if (ctx.measureText(trial).width > maxTextW && cur) { lines.push(cur); cur = word; } else cur = trial; } if (cur) lines.push(cur);
        const lh = 16, plateH = lines.length * lh + 10; let plateW = 0; for (const l of lines) plateW = Math.max(plateW, ctx.measureText(l).width); plateW += 22; const plateY = backMid.y - WALL_H * 0.62 - plateH / 2;
        ctx.fillStyle = 'rgba(6,9,18,0.72)'; roundRect(ctx, backMid.x - plateW / 2, plateY, plateW, plateH, 2); ctx.fill(); ctx.strokeStyle = withAlpha(isLobby ? '#5a6480' : room!.color, hovered ? 0.9 : 0.4); ctx.lineWidth = 1; roundRect(ctx, backMid.x - plateW / 2, plateY, plateW, plateH, 2); ctx.stroke(); ctx.fillStyle = isLobby ? '#7a86a3' : '#F5F2EC'; lines.forEach((l, li) => ctx.fillText(l, backMid.x, plateY + 5 + lh / 2 + li * lh)); ctx.textBaseline = 'alphabetic';
      });
    });
    const rp = [{ x: x0, y: roofY }, { x: x1, y: roofY }, shear(x1, roofY, 1, shx, shy), shear(x0, roofY, 1, shx, shy)]; ctx.fillStyle = '#3a4256'; quadPath(ctx, rp[0], rp[1], rp[2], rp[3]); ctx.fill(); ctx.strokeStyle = '#2a3350'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    if (k < 1) this.lastRoomBoxes = this.lastRoomBoxes.map((b) => ({ ...b, x: ox + b.x * k, y: oy + b.y * k, w: b.w * k, h: b.h * k }));
    if (night) { ctx.fillStyle = 'rgba(5,7,15,0.28)'; ctx.fillRect(0, 0, w, h); }
  }

  /* ── rooms ──────────────────────────────────────────────────────────── */
  private roomLayout(w: number, h: number, zoom: number, pan: Pt) { const cTop = 34, cBot = 726, topPad = 76, botPad = 30; const fit = Math.min(w / (ROOM_W + 30), (h - topPad - botPad) / (cBot - cTop)); const scale = fit * zoom; const panelShift = this.state.selectedAgent ? -Math.min(150, w * 0.16) : 0; const offX = w / 2 - (ROOM_W / 2) * scale + pan.x + panelShift; const topAnchor = topPad - cTop * scale, botAnchor = h - botPad - cBot * scale; const offY = botAnchor >= topAnchor ? (topAnchor + botAnchor) / 2 + pan.y : Math.max(botAnchor, Math.min(topAnchor + pan.y, topAnchor)); return { scale, offX, offY }; }
  private drawRoomShell(ctx: CanvasRenderingContext2D, room: Room) {
    const wallCol = mix('#141A2B', room.color, 0.14), sideCol = mix(wallCol, '#000000', 0.16), floorCol = mix('#20263a', room.color, 0.1);
    ctx.fillStyle = wallCol; ctx.fillRect(CENTER_X - FRONT_HALF_W - 20, WALL_TOP_Y, (FRONT_HALF_W + 20) * 2, HORIZON_Y - WALL_TOP_Y + 4);
    ctx.fillStyle = mix(wallCol, '#000000', 0.4); ctx.fillRect(CENTER_X - FRONT_HALF_W - 20, WALL_TOP_Y - 200, (FRONT_HALF_W + 20) * 2, 200); quadPath(ctx, { x: CENTER_X - BACK_HALF_W, y: BACK_WALL_TOP_Y }, { x: CENTER_X + BACK_HALF_W, y: BACK_WALL_TOP_Y }, { x: CENTER_X + FRONT_HALF_W + 20, y: WALL_TOP_Y }, { x: CENTER_X - FRONT_HALF_W - 20, y: WALL_TOP_Y }); ctx.fill();
    for (let i = 0; i < 3; i++) { const t = 0.28 + i * 0.24, yy = BACK_WALL_TOP_Y + (WALL_TOP_Y - BACK_WALL_TOP_Y) * t; const halfW = BACK_HALF_W + (FRONT_HALF_W - BACK_HALF_W) * t; ctx.fillStyle = withAlpha('#F4A661', this.live.workday === 'night' ? 0.05 : 0.13); ctx.fillRect(CENTER_X - halfW * 0.45, yy, halfW * 0.9, 7); }
    ctx.fillStyle = sideCol; quadPath(ctx, { x: CENTER_X - BACK_HALF_W, y: BACK_WALL_TOP_Y }, { x: CENTER_X - FRONT_HALF_W, y: WALL_TOP_Y }, { x: CENTER_X - FRONT_HALF_W, y: FRONT_Y }, { x: CENTER_X - BACK_HALF_W, y: HORIZON_Y }); ctx.fill(); quadPath(ctx, { x: CENTER_X + BACK_HALF_W, y: BACK_WALL_TOP_Y }, { x: CENTER_X + FRONT_HALF_W, y: WALL_TOP_Y }, { x: CENTER_X + FRONT_HALF_W, y: FRONT_Y }, { x: CENTER_X + BACK_HALF_W, y: HORIZON_Y }); ctx.fill();
    ctx.fillStyle = wallCol; ctx.fillRect(CENTER_X - BACK_HALF_W, BACK_WALL_TOP_Y, BACK_HALF_W * 2, HORIZON_Y - BACK_WALL_TOP_Y);
    ctx.fillStyle = floorCol; quadPath(ctx, { x: CENTER_X - BACK_HALF_W, y: HORIZON_Y }, { x: CENTER_X + BACK_HALF_W, y: HORIZON_Y }, { x: CENTER_X + FRONT_HALF_W, y: FRONT_Y }, { x: CENTER_X - FRONT_HALF_W, y: FRONT_Y }); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1; for (let i = 1; i < 8; i++) { const u = i / 8; ctx.beginPath(); ctx.moveTo(CENTER_X - BACK_HALF_W + u * BACK_HALF_W * 2, HORIZON_Y); ctx.lineTo(CENTER_X - FRONT_HALF_W + u * FRONT_HALF_W * 2, FRONT_Y); ctx.stroke(); } for (let i = 1; i < 6; i++) { const p = perspAt(1 - i / 6); ctx.beginPath(); ctx.moveTo(CENTER_X - p.halfW, p.y); ctx.lineTo(CENTER_X + p.halfW, p.y); ctx.stroke(); }
    ctx.strokeStyle = withAlpha(room.color, 0.75); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(CENTER_X - BACK_HALF_W, HORIZON_Y); ctx.lineTo(CENTER_X + BACK_HALF_W, HORIZON_Y); ctx.stroke();
    for (let i = 0; i < 4; i++) { const p = perspAt(0.72 - i * 0.2); const g = ctx.createRadialGradient(CENTER_X, p.y, 8, CENTER_X, p.y, 320 * p.scale); g.addColorStop(0, withAlpha('#F4A661', 0.09)); g.addColorStop(1, 'rgba(244,166,97,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(CENTER_X, p.y, 330 * p.scale, 62 * p.scale, 0, 0, Math.PI * 2); ctx.fill(); }
    const bwg = ctx.createLinearGradient(0, BACK_WALL_TOP_Y, 0, HORIZON_Y); bwg.addColorStop(0, withAlpha(room.color, 0.14)); bwg.addColorStop(1, 'rgba(0,0,0,0.18)'); ctx.fillStyle = bwg; ctx.fillRect(CENTER_X - BACK_HALF_W, BACK_WALL_TOP_Y, BACK_HALF_W * 2, HORIZON_Y - BACK_WALL_TOP_Y);
    ctx.strokeStyle = 'rgba(245,242,236,0.06)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(CENTER_X - FRONT_HALF_W, FRONT_Y); ctx.lineTo(CENTER_X - BACK_HALF_W, HORIZON_Y); ctx.lineTo(CENTER_X + BACK_HALF_W, HORIZON_Y); ctx.lineTo(CENTER_X + FRONT_HALF_W, FRONT_Y); ctx.stroke();
  }
  private drawSeatedScaled(ctx: CanvasRenderingContext2D, x: number, y: number, char: number, dir: number, now: number, seed: number, scale: number) { if (!this.spriteReady) return; const bx = (char % SHEET.perRow) * SHEET.blockW, by = Math.floor(char / SHEET.perRow) * SHEET.blockH; const frame = Math.sin(now / 260 + seed) > 0.3 ? 2 : Math.sin(now / 260 + seed) < -0.3 ? 0 : 1; const s = 40 * scale; ctx.drawImage(this.sprite, bx + frame * SHEET.cell, by + dir * SHEET.cell, SHEET.cell, SHEET.cell, x - s / 2, y - s, s, s); }
  private drawRoom(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, dt: number) {
    const id = this.state.activeRoomId!; const room = ROOM_BY_ID[id] || EXEC; const intro = this.introT0 ? Math.min(1, (now - this.introT0) / 480) : 1; const ie = smoothstep(intro);
    const cam = this.roomLayout(w, h, this.state.roomZoom * (1 + 0.42 * (1 - ie)), this.state.roomPan); this.roomCam = cam;
    ctx.fillStyle = '#0A0E1A'; ctx.fillRect(0, 0, w, h); ctx.save(); ctx.translate(cam.offX, cam.offY); ctx.scale(cam.scale, cam.scale); ctx.beginPath(); ctx.rect(CENTER_X - FRONT_HALF_W - 20, WALL_TOP_Y, (FRONT_HALF_W + 20) * 2, FRONT_Y - WALL_TOP_Y + 20); ctx.clip();
    this.drawRoomShell(ctx, room); if (id === 'exec') this.drawExecRoom(ctx, now, dt); else this.drawDeptRoom(ctx, room, now, dt); ctx.restore();
    if (ie < 1) { ctx.fillStyle = `rgba(10,14,26,${(1 - ie).toFixed(3)})`; ctx.fillRect(0, 0, w, h); }
    if (this.live.workday === 'night' && id !== 'exec') { ctx.fillStyle = 'rgba(5,7,15,0.3)'; ctx.fillRect(0, 0, w, h); }
    const vg = ctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.34, w / 2, h * 0.52, Math.max(w, h) * 0.72); vg.addColorStop(0, 'rgba(5,7,15,0)'); vg.addColorStop(1, 'rgba(5,7,15,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }
  private workstations(room: Room) { if (this.wsCache[room.id]) return this.wsCache[room.id]; const cols = [200, 420, 640, 950, 1170], rows = [300, 390, 470]; const list: any[] = []; let i = 0; rows.forEach((wy) => cols.forEach((wx) => { const seed = 500000 + i * 13 + room.id.length; list.push({ wx, wy, char: i % SHEET.nChars, seed, mug: (i % 3) !== 0, agent: { seed, char: i % SHEET.nChars, seated: true, x: wx, y: wy, dir: 3, frame: 1, frameClock: 0, ang: 0, speed: 0, turnClock: 0, name: '', bubbleUntil: 0, bubbleText: '', wsIndex: i } as SceneAgent }); i++; })); this.wsCache[room.id] = list; return list; }
  private deskRects(room: Room) { if (this.rectCache[room.id]) return this.rectCache[room.id]; this.rectCache[room.id] = this.workstations(room).map((ws: any) => ({ x: ws.wx - 100, y: ws.wy - 42, w: 200, h: 60 })); return this.rectCache[room.id]; }
  private drawWorkstation(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, room: Room, ws: any, now: number, occupied: boolean, working: boolean) {
    const c = room.color; ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(px, py - 4 * s, 78 * s, 15 * s, 0, 0, Math.PI * 2); ctx.fill();
    const pw = 152 * s, ph = 52 * s, ptop = py - 104 * s; ctx.fillStyle = mix('#2c3245', c, 0.18); ctx.fillRect(px - pw / 2, ptop, pw, ph); ctx.fillStyle = mix('#3a4258', c, 0.22); ctx.fillRect(px - pw / 2, ptop, pw, 5 * s); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(px - pw / 2, ptop + ph - 3 * s, pw, 3 * s); ctx.fillStyle = withAlpha('#F5F2EC', 0.55); ctx.fillRect(px + 42 * s, ptop + 14 * s, 20 * s, 15 * s); ctx.fillStyle = withAlpha(c, 0.7); ctx.fillRect(px - 62 * s, ptop + 16 * s, 24 * s, 11 * s);
    const mw = 52 * s, mh = 34 * s, my = py - 88 * s; ctx.fillStyle = '#15171f'; ctx.fillRect(px - mw / 2, my, mw, mh); const lit = working || (occupied && (Math.sin(now / 900 + ws.seed) + 1) / 2 > 0.15); ctx.fillStyle = lit ? withAlpha(c, 0.8) : '#1d2434'; ctx.fillRect(px - mw / 2 + 3 * s, my + 3 * s, mw - 6 * s, mh - 6 * s); if (lit) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; for (let l = 0; l < 3; l++) ctx.fillRect(px - mw / 2 + 7 * s, my + (8 + l * 8) * s, (mw - 14 * s) * (0.5 + 0.4 * Math.abs(Math.sin(ws.seed + l + (working ? now / 700 : 0)))), 3 * s); }
    ctx.fillStyle = '#15171f'; ctx.fillRect(px - 3 * s, my + mh, 6 * s, 8 * s); ctx.fillRect(px - 12 * s, my + mh + 6 * s, 24 * s, 3 * s);
    const dw = 140 * s; ctx.fillStyle = '#7a5f3c'; ctx.fillRect(px - dw / 2, py - 48 * s, dw, 12 * s); ctx.fillStyle = '#5a4327'; ctx.fillRect(px - dw / 2, py - 36 * s, dw, 22 * s); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px - dw / 2, py - 14 * s, 7 * s, 14 * s); ctx.fillRect(px + dw / 2 - 7 * s, py - 14 * s, 7 * s, 14 * s);
    ctx.fillStyle = '#c9c4b6'; ctx.fillRect(px - 20 * s, py - 45 * s, 36 * s, 7 * s); ctx.fillStyle = '#9d988c'; ctx.fillRect(px + 21 * s, py - 44 * s, 6 * s, 5 * s); if (ws.mug) { ctx.fillStyle = withAlpha(c, 0.9); ctx.fillRect(px - 40 * s, py - 48 * s, 8 * s, 9 * s); }
    ctx.fillStyle = '#22283a'; ctx.fillRect(px - 15 * s, py - 30 * s, 30 * s, 22 * s); ctx.fillStyle = '#2c3348'; ctx.beginPath(); ctx.ellipse(px, py - 6 * s, 17 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#161a26'; ctx.fillRect(px - 2 * s, py - 6 * s, 4 * s, 7 * s);
    if (occupied) this.drawSeatedScaled(ctx, px, py - 4 * s, ws.char, 3, now, ws.seed, s * 1.05);
    const cam = this.roomCam; this.lastAgentScreens[ws.seed] = occupied ? { x: cam.offX + px * cam.scale, y: cam.offY + (py - 8 * s) * cam.scale } : { x: -9999, y: -9999 };
    if (occupied && working) { ctx.fillStyle = 'rgba(79,209,138,0.95)'; ctx.beginPath(); ctx.arc(px + 12 * s, py - 46 * s, 3.5 * s + Math.sin(now / 350) * s * 0.6, 0, Math.PI * 2); ctx.fill(); }
    if (this.state.selectedAgent === ws.agent) { ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.ellipse(px, py - 2 * s, 22 * s, 8 * s, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (now < ws.agent.bubbleUntil) this.drawBubble(ctx, px, py - 46 * s, ws.agent.bubbleText);
  }
  private drawPropCluster(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, kind: string, room: Room, now: number) {
    if (kind === 'plant') { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(px, py, 20 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a4530'; ctx.fillRect(px - 12 * s, py - 18 * s, 24 * s, 18 * s); ctx.fillStyle = '#3f6b4a'; ctx.beginPath(); ctx.arc(px, py - 34 * s, 18 * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4f8058'; ctx.beginPath(); ctx.arc(px - 11 * s, py - 44 * s, 12 * s, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(px + 12 * s, py - 42 * s, 10 * s, 0, Math.PI * 2); ctx.fill(); }
    else if (kind === 'cooler') { ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.beginPath(); ctx.ellipse(px, py, 18 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c9c4b6'; ctx.fillRect(px - 13 * s, py - 44 * s, 26 * s, 44 * s); ctx.fillStyle = withAlpha('#7fd4e8', 0.75); ctx.fillRect(px - 10 * s, py - 68 * s, 20 * s, 24 * s); ctx.fillStyle = '#6b7a8c'; ctx.fillRect(px - 5 * s, py - 26 * s, 10 * s, 5 * s); }
    else if (kind === 'printer') { ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.beginPath(); ctx.ellipse(px, py, 34 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a4327'; ctx.fillRect(px - 34 * s, py - 26 * s, 68 * s, 26 * s); ctx.fillStyle = '#7a5f3c'; ctx.fillRect(px - 34 * s, py - 32 * s, 68 * s, 6 * s); ctx.fillStyle = '#2b3040'; ctx.fillRect(px - 22 * s, py - 56 * s, 44 * s, 24 * s); ctx.fillStyle = '#e8e3d6'; ctx.fillRect(px - 14 * s, py - 38 * s, 28 * s, 6 * s); ctx.fillStyle = withAlpha(room.color, 0.9); ctx.fillRect(px + 12 * s, py - 52 * s, 6 * s, 4 * s); }
    else if (kind === 'meeting') { ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.beginPath(); ctx.ellipse(px, py, 62 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a4327'; ctx.beginPath(); ctx.ellipse(px, py - 22 * s, 58 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#7a5f3c'; ctx.beginPath(); ctx.ellipse(px, py - 26 * s, 58 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e8e3d6'; ctx.fillRect(px - 16 * s, py - 32 * s, 22 * s, 8 * s); ctx.fillStyle = withAlpha(room.color, 0.9); ctx.fillRect(px + 18 * s, py - 34 * s, 8 * s, 9 * s); if (this.live.meeting !== 'all_hands') [-1, 1].forEach((sgn, i) => { ctx.fillStyle = '#22283a'; ctx.fillRect(px + sgn * 74 * s - 14 * s, py - 40 * s, 28 * s, 20 * s); this.drawSeatedScaled(ctx, px + sgn * 74 * s, py - 8 * s, (i + 4) % SHEET.nChars, sgn < 0 ? 2 : 1, now, i * 5, s); }); }
  }
  private drawDeptRoom(ctx: CanvasRenderingContext2D, room: Room, now: number, dt: number) {
    const scrW = BACK_HALF_W * 1.5, scrH = HORIZON_Y - BACK_WALL_TOP_Y - 20, scx = CENTER_X - scrW / 2, scy = BACK_WALL_TOP_Y + 10; const meeting = this.live.meeting; const emptyRoom = meeting === 'all_hands';
    ctx.fillStyle = '#05070d'; ctx.fillRect(scx, scy, scrW, scrH); ctx.strokeStyle = withAlpha(room.color, 0.8); ctx.lineWidth = 2; ctx.strokeRect(scx, scy, scrW, scrH); ctx.fillStyle = withAlpha(room.color, 0.06 + 0.02 * Math.sin(now / 900)); ctx.fillRect(scx + 2, scy + 2, scrW - 4, scrH - 4);
    ctx.textAlign = 'center'; ctx.fillStyle = withAlpha(room.color, 0.85); ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.fillText(emptyRoom ? '// ALL-HANDS IN THE BOARDROOM' : meeting === 'executive' ? '// HEAD IS IN THE EXEC MEETING' : '// DEPARTMENT', CENTER_X, scy + scrH * 0.36);
    ctx.fillStyle = '#F5F2EC'; ctx.font = "400 26px 'Fraunces', serif"; ctx.fillText(room.name, CENTER_X, scy + scrH * 0.58);
    const live = this.live.agentsByRoom[room.id] ?? []; const working = live.filter((a) => a.status === 'working').length; const status = live.length ? `${working} WORKING · ${live.length - working} IDLE · ${room.depts.join(' ')}` : room.props.join('  ·  ').toUpperCase();
    ctx.fillStyle = withAlpha('#F5F2EC', 0.55); ctx.font = "500 10px 'JetBrains Mono', monospace"; ctx.fillText(status, CENTER_X, scy + scrH * 0.8);
    const items: Array<{ y: number; draw: () => void }> = [];
    const workingLive = live.filter((a) => a.status === 'working');
    for (const ws of this.workstations(room)) { const sp = worldToPersp(ws.wx, ws.wy); const bound = ws.agent.live as AgentReport | null; const occupied = !emptyRoom && (bound ? true : live.length === 0 ? true : false) && !(meeting === 'executive' && ws.agent.isHead); items.push({ y: ws.wy, draw: () => this.drawWorkstation(ctx, sp.x, sp.y, sp.scale, room, ws, now, occupied, Boolean(bound?.status === 'working' || (!bound && live.length === 0 && (ws.seed % 3 === 0)))) }); }
    void workingLive;
    const props = [{ wx: 60, wy: 300, kind: 'plant' }, { wx: 1340, wy: 300, kind: 'plant' }, { wx: 78, wy: 470, kind: 'cooler' }, { wx: 1325, wy: 480, kind: 'printer' }, { wx: 790, wy: 210, kind: 'meeting' }];
    for (const p of props) { const sp = worldToPersp(p.wx, p.wy); items.push({ y: p.wy, draw: () => this.drawPropCluster(ctx, sp.x, sp.y, sp.scale, p.kind, room, now) }); }
    const all = this.roomAgents[room.id] || [];
    const agents = all.filter((a) => !emptyRoom && !(meeting === 'executive' && a.isHead) && !(this.live.workday === 'night' && !a.live?.current && (a.seed % 3 !== 0)));
    for (const a of all) if (!agents.includes(a)) this.lastAgentScreens[a.seed] = { x: -9999, y: -9999 };
    for (const { a, sp } of this.updateAgents(agents, dt, this.deskRects(room))) items.push({ y: a.y, draw: () => this.drawAgentSprite(ctx, a, sp, now) });
    items.sort((p, q) => p.y - q.y); for (const it of items) it.draw();
    if (emptyRoom) { ctx.fillStyle = withAlpha('#F4A661', 0.9); ctx.font = "600 16px 'Inter Tight', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('Everyone is at the all-hands in the Executive Meeting Room ↑', CENTER_X, 640); }
  }
  private drawExecRoom(ctx: CanvasRenderingContext2D, now: number, dt: number) {
    const winW = (BACK_HALF_W * 2 - 40) / 6; for (let i = 0; i < 6; i++) { const wx = CENTER_X - BACK_HALF_W + 20 + i * winW; const g = ctx.createLinearGradient(0, BACK_WALL_TOP_Y, 0, HORIZON_Y); g.addColorStop(0, '#3a5a7a'); g.addColorStop(1, '#141A2B'); ctx.fillStyle = g; ctx.fillRect(wx, BACK_WALL_TOP_Y + 10, winW - 8, HORIZON_Y - BACK_WALL_TOP_Y - 18); ctx.strokeStyle = '#0A0E1A'; ctx.lineWidth = 2; ctx.strokeRect(wx, BACK_WALL_TOP_Y + 10, winW - 8, HORIZON_Y - BACK_WALL_TOP_Y - 18); }
    const meeting = this.live.meeting; const plaque = meeting === 'all_hands' ? 'ALL-HANDS · LIVE' : meeting === 'executive' ? 'EXECUTIVE MEETING · LIVE' : 'ALL DEPARTMENTS';
    ctx.fillStyle = '#0A0E1A'; roundRect(ctx, CENTER_X - 110, BACK_WALL_TOP_Y - 30, 220, 34, 3); ctx.fill(); ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 1.5; roundRect(ctx, CENTER_X - 110, BACK_WALL_TOP_Y - 30, 220, 34, 3); ctx.stroke(); ctx.fillStyle = '#F4A661'; ctx.font = "600 12px 'JetBrains Mono', monospace"; ctx.textAlign = 'center'; ctx.fillText(plaque, CENTER_X, BACK_WALL_TOP_Y - 8);
    ctx.save(); ctx.beginPath(); ctx.rect(CENTER_X - BACK_HALF_W + 20, BACK_WALL_TOP_Y + 10, BACK_HALF_W * 2 - 40, HORIZON_Y - BACK_WALL_TOP_Y - 18); ctx.clip(); const vrng = mulberry32(5); ctx.fillStyle = 'rgba(245,242,236,0.5)'; for (let i = 0; i < 40; i++) ctx.fillRect(CENTER_X - BACK_HALF_W + vrng() * BACK_HALF_W * 2, BACK_WALL_TOP_Y + 12 + vrng() * 60, 1, 1); let vx = CENTER_X - BACK_HALF_W; while (vx < CENTER_X + BACK_HALF_W) { const bw2 = 18 + vrng() * 34, bh2 = 24 + vrng() * 64; ctx.fillStyle = 'rgba(8,11,20,0.55)'; ctx.fillRect(vx, HORIZON_Y - 8 - bh2, bw2, bh2); for (let k = 0; k < 5; k++) if (vrng() > 0.6) { ctx.fillStyle = withAlpha('#F4A661', 0.5); ctx.fillRect(vx + 4 + (k % 2) * 9, HORIZON_Y - 14 - k * 11, 4, 4); } vx += bw2 + 5; } ctx.restore();
    const cx = CENTER_X, cy = (FRONT_Y + HORIZON_Y) / 2 - 20, rx = 330, ry = 104, pgy = cy - 150; const pg = ctx.createLinearGradient(0, pgy, 0, cy + ry * 0.5); pg.addColorStop(0, 'rgba(244,166,97,0.20)'); pg.addColorStop(1, 'rgba(244,166,97,0)'); ctx.fillStyle = pg; quadPath(ctx, { x: cx - 150, y: pgy + 10 }, { x: cx + 150, y: pgy + 10 }, { x: cx + 300, y: cy + ry * 0.4 }, { x: cx - 300, y: cy + ry * 0.4 }); ctx.fill(); ctx.fillStyle = '#2b3247'; ctx.fillRect(cx - 130, pgy, 260, 8); ctx.fillStyle = withAlpha('#F4A661', 0.7); ctx.fillRect(cx - 126, pgy + 8, 252, 3); [-100, 0, 100].forEach((dx) => { ctx.fillStyle = '#2b3247'; ctx.fillRect(cx + dx - 1, pgy - 60, 2, 60); });
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(cx, cy + 12, rx * 0.98, ry * 0.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#241a11'; ctx.beginPath(); ctx.ellipse(cx, cy + 6, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); const tg = ctx.createLinearGradient(0, cy - ry, 0, cy + ry); tg.addColorStop(0, '#57412a'); tg.addColorStop(0.5, '#43301f'); tg.addColorStop(1, '#312417'); ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = withAlpha('#F4A661', 0.28); ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = 'rgba(255,225,190,0.07)'; ctx.beginPath(); ctx.ellipse(cx, cy - 18, rx * 0.72, ry * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#22283a'; roundRect(ctx, cx - 46, cy - 16, 92, 22, 4); ctx.fill(); [-30, -12, 8, 26].forEach((dx) => { ctx.fillStyle = withAlpha('#9fd8ff', 0.5); ctx.fillRect(cx + dx, cy - 26, 8, 14); ctx.fillStyle = withAlpha('#F5F2EC', 0.18); ctx.fillRect(cx + dx, cy - 26, 8, 4); });
    ROOMS.forEach((d, i) => { const ang = (i / ROOMS.length) * Math.PI * 2 - Math.PI / 2; const lx = cx + Math.cos(ang) * (rx - 62), ly = cy + Math.sin(ang) * (ry - 26); const s = 0.8 + (Math.sin(ang) + 1) * 0.16; ctx.fillStyle = '#1b2030'; roundRect(ctx, lx - 15 * s, ly - 9 * s, 30 * s, 12 * s, 2); ctx.fill(); ctx.fillStyle = withAlpha(d.color, 0.75); ctx.fillRect(lx - 12 * s, ly - 7 * s, 24 * s, 8 * s); });
    const order = ROOMS.map((_, i) => i).sort((i, j) => Math.sin((j / ROOMS.length) * Math.PI * 2) - Math.sin((i / ROOMS.length) * Math.PI * 2));
    order.forEach((i) => { const d = ROOMS[i]; const ang = (i / ROOMS.length) * Math.PI * 2 - Math.PI / 2; const depthT = (Math.sin(ang) + 1) / 2; const s = 1.15 - depthT * 0.4; const hx = cx + Math.cos(ang) * (rx + 26), hy = cy + Math.sin(ang) * (ry + 16) * (0.88 + depthT * 0.16); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(hx, hy + 4 * s, 17 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#22283a'; roundRect(ctx, hx - 13 * s, hy - 26 * s, 26 * s, 24 * s, 4 * s); ctx.fill(); ctx.fillStyle = withAlpha(d.color, 0.5); ctx.fillRect(hx - 13 * s, hy - 26 * s, 26 * s, 3 * s); const head = this.execHeads()[i]; const cam = this.roomCam; this.lastAgentScreens[head.seed] = { x: cam.offX + hx * cam.scale, y: cam.offY + (hy - 12 * s) * cam.scale }; if (this.spriteReady) { const bx = (i % SHEET.perRow) * SHEET.blockW, by = Math.floor(i / SHEET.perRow) * SHEET.blockH; const bob = Math.sin(now / 600 + i) * 1.5; const sz = 26 * s; ctx.drawImage(this.sprite, bx + SHEET.cell, by, SHEET.cell, SHEET.cell, hx - sz / 2, hy - sz + bob, sz, sz); } if (this.state.selectedAgent === head) { ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(hx, hy + 2 * s, 20 * s, 7 * s, 0, 0, Math.PI * 2); ctx.stroke(); } if (now < head.bubbleUntil) this.drawBubble(ctx, hx, hy - 30 * s, head.bubbleText); const px2 = cx + Math.cos(ang) * (rx - 16), py2 = cy + Math.sin(ang) * (ry - 8); const inv = 1 / Math.max(0.35, this.roomCam.scale); const fs = 11 * inv; ctx.font = `600 ${fs}px 'JetBrains Mono', monospace`; ctx.textAlign = 'center'; const short = d.short; const tw = ctx.measureText(short).width; ctx.fillStyle = withAlpha(d.color, 0.92); roundRect(ctx, px2 - tw / 2 - 6 * inv, py2 - 9 * inv, tw + 12 * inv, 17 * inv, 2 * inv); ctx.fill(); ctx.fillStyle = '#0A0E1A'; ctx.fillText(short, px2, py2 + 3.5 * inv); });
    if (meeting === 'all_hands') { // the whole company standing at the front of the room
      const items = this.crowd.map((a) => { const sp = worldToPersp(a.x, a.y + Math.sin(now / 500 + a.seed) * 2); const cam = this.roomCam; this.lastAgentScreens[a.seed] = { x: cam.offX + sp.x * cam.scale, y: cam.offY + sp.y * cam.scale }; return { y: a.y, draw: () => { const drawPx = 44 * sp.scale; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 1, drawPx * 0.26, drawPx * 0.09, 0, 0, Math.PI * 2); ctx.fill(); if (this.spriteReady) { const bx = (a.char % SHEET.perRow) * SHEET.blockW, by = Math.floor(a.char / SHEET.perRow) * SHEET.blockH; ctx.drawImage(this.sprite, bx + SHEET.cell, by + 3 * SHEET.cell, SHEET.cell, SHEET.cell, sp.x - drawPx / 2, sp.y - drawPx, drawPx, drawPx); } if (this.state.selectedAgent === a) { ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 2, 16 * sp.scale, 6 * sp.scale, 0, 0, Math.PI * 2); ctx.stroke(); } } }; });
      items.sort((p, q) => p.y - q.y); items.forEach((i) => i.draw());
    }
    void dt;
    this.drawPropCluster(ctx, cx - 470, 660, 1, 'plant', EXEC, now); this.drawPropCluster(ctx, cx + 470, 660, 1, 'plant', EXEC, now);
  }
  private blocked(rects: any[], x: number, y: number) { for (const r of rects) if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true; return false; }
  private updateAgents(agents: SceneAgent[], dt: number, rects: any[]) {
    const out: Array<{ a: SceneAgent; sp: { x: number; y: number; scale: number } }> = [];
    for (const a of agents) { a.turnClock -= dt; if (a.turnClock <= 0) { a.ang += (Math.random() - 0.5) * 1.6; a.turnClock = 1.2 + Math.random() * 2.4; } const spd = a.live?.status === 'working' ? a.speed * 1.4 : a.speed; const vx = Math.cos(a.ang) * spd, vy = Math.sin(a.ang) * spd; let nx = a.x + vx * dt, ny = a.y + vy * dt; if (nx < 40 || nx > ROOM_W - 40) { a.ang = Math.PI - a.ang; nx = a.x; } if (ny < DEPTH_MINY || ny > DEPTH_MAXY) { a.ang = -a.ang; ny = a.y; } if (rects && this.blocked(rects, nx, ny)) { a.ang += Math.PI * (0.6 + Math.random() * 0.8); nx = a.x; ny = a.y; } a.x = nx; a.y = ny; a.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 1 : 2) : (vy < 0 ? 3 : 0); a.frameClock += dt * 1000; a.frame = WALK[Math.floor(a.frameClock / (1000 / WALK_FPS)) % WALK.length]; }
    for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) { const p = agents[i], q = agents[j]; const dx = q.x - p.x, dy = (q.y - p.y) * 1.8, d2 = dx * dx + dy * dy; if (d2 < 3600 && d2 > 0.01) { const d = Math.sqrt(d2), push = (60 - d) / 2; p.x -= (dx / d) * push; q.x += (dx / d) * push; p.y -= (dy / d) * push * 0.4; q.y += (dy / d) * push * 0.4; } }
    for (const a of agents) { a.x = Math.max(40, Math.min(ROOM_W - 40, a.x)); a.y = Math.max(DEPTH_MINY, Math.min(DEPTH_MAXY, a.y)); const sp = worldToPersp(a.x, a.y); this.lastAgentScreens[a.seed] = { x: this.roomCam.offX + sp.x * this.roomCam.scale, y: this.roomCam.offY + sp.y * this.roomCam.scale }; out.push({ a, sp }); }
    return out;
  }
  private drawAgentSprite(ctx: CanvasRenderingContext2D, a: SceneAgent, sp: { x: number; y: number; scale: number }, now: number) {
    const drawPx = 44 * sp.scale; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 1, drawPx * 0.26, drawPx * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    const bx = (a.char % SHEET.perRow) * SHEET.blockW, by = Math.floor(a.char / SHEET.perRow) * SHEET.blockH; if (this.spriteReady) ctx.drawImage(this.sprite, bx + a.frame * SHEET.cell, by + a.dir * SHEET.cell, SHEET.cell, SHEET.cell, sp.x - drawPx / 2, sp.y - drawPx, drawPx, drawPx);
    if (a.live?.status === 'working') { ctx.fillStyle = 'rgba(79,209,138,0.95)'; ctx.beginPath(); ctx.arc(sp.x + drawPx * 0.32, sp.y - drawPx * 0.95, 3.5 * sp.scale, 0, Math.PI * 2); ctx.fill(); }
    if (a.isHead) { ctx.fillStyle = '#F4A661'; ctx.font = `700 ${Math.max(8, 9 * sp.scale)}px 'JetBrains Mono', monospace`; ctx.textAlign = 'center'; ctx.fillText('HEAD', sp.x, sp.y - drawPx - 4); }
    if (this.state.selectedAgent === a) { ctx.strokeStyle = '#E66A2C'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 2, 16 * sp.scale, 6 * sp.scale, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (now < a.bubbleUntil) this.drawBubble(ctx, sp.x, sp.y - drawPx - 6, a.bubbleText);
  }
  private drawBubble(ctx: CanvasRenderingContext2D, cx: number, tipY: number, text: string) { ctx.font = "600 11px 'Inter Tight', sans-serif"; const pad = 5, tail = 6, r = 4; const tw = ctx.measureText(text).width; const bw = tw + pad * 2, bh = 18; const bx = cx - bw / 2, by = tipY - tail - bh; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#141414'; ctx.lineWidth = 1.5; roundRect(ctx, bx, by, bw, bh, r); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - 5, by + bh - 1); ctx.lineTo(cx + 5, by + bh - 1); ctx.lineTo(cx, by + bh + tail); ctx.closePath(); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.fillStyle = '#141414'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, by + bh / 2 + 1); ctx.textBaseline = 'alphabetic'; }
}
