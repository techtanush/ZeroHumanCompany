import { useEffect, useRef, useState } from 'react';

const ACCOUNT_KEY = 'zeroth.account_profile';

interface LandingProps {
  onStart(profile?: { display_name?: string; email?: string }): void;
}

export function savedAccount(): { display_name?: string; email?: string } | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const display_name = String(parsed.display_name ?? '').trim();
    const email = String(parsed.email ?? '').trim();
    return display_name.length > 1 || email ? { display_name, email } : null;
  } catch {
    return null;
  }
}

const DEPARTMENTS: Array<{ id: string; name: string; face: string; blurb: string }> = [
  { id: 'D01', name: 'Intake', face: ':)', blurb: 'Takes your idea — rough notes, a voice memo, a doc — or originates one on its own.' },
  { id: 'D02', name: 'Office Hours', face: ':|', blurb: 'Grills the idea like a YC partner would: who exactly hurts, what would have to be true.' },
  { id: 'D03', name: 'Market Research', face: ':D', blurb: 'Swarms the internet for real niches, real pricing, real TAM — with sources, not guesses.' },
  { id: 'D04', name: 'Outreach & Validation', face: ':>', blurb: 'Calls real people in your cloned voice to test the idea before a line of code exists.' },
  { id: 'D05', name: 'Synthetic Population', face: ':o', blurb: 'Simulates the market you can’t reach yet against real census demographics.' },
  { id: 'D06', name: 'Pivot & Decision', face: ':/', blurb: 'Turns validation into hard calls — kill this, keep that — and asks you to sign off.' },
  { id: 'D07', name: 'Build', face: ':]', blurb: 'Ships real, running code — pushed to GitHub, tested, and live on a real URL.' },
  { id: 'D08', name: 'Strategy', face: ':^', blurb: 'Plans positioning, pricing and go-to-market once there’s a product to sell.' },
  { id: 'D09', name: 'Leads', face: ':+', blurb: 'Finds and qualifies the people most likely to actually buy this.' },
  { id: 'D10', name: 'Sales', face: ':>', blurb: 'Runs outreach and closes deals — with a human approval on every dollar in.' },
  { id: 'D11', name: 'Finance & HR', face: ':$', blurb: 'Manages the Stripe wallet, and hires real humans through Terac when agents hit a wall.' },
  { id: 'D12', name: 'Support', face: ':S', blurb: 'Handles customers post-launch and feeds real complaints back into the roadmap.' },
  { id: 'D13', name: 'Chief of Staff', face: ':*', blurb: 'Watches every other department and proposes new capability when something’s missing.' },
];

const FLOW: Array<{ n: string; title: string; body: string }> = [
  { n: '01', title: 'You bring the spark', body: 'A rough idea, a voice note, a half-written doc — or nothing at all. The company can originate its own.' },
  { n: '02', title: 'It gets interrogated', body: 'Office Hours pressure-tests the idea before anyone touches code, exactly the way a sharp YC partner would.' },
  { n: '03', title: 'The market gets researched', body: 'Swarms of agents come back with real niches, real numbers, and real sources — never invented figures.' },
  { n: '04', title: 'Real humans weigh in', body: 'Your cloned voice calls actual people. A synthetic population fills the gaps you can’t reach in time.' },
  { n: '05', title: 'The product gets built', body: 'Real code, a real GitHub repo, a real running URL — reviewed and QA’d before it ships.' },
  { n: '06', title: 'It gets sold', body: 'Leads get found, outreach goes out, deals close — every dollar still needs your yes.' },
  { n: '07', title: 'It watches itself', body: 'Support, Finance and the Chief of Staff keep the loop closed, spotting gaps and proposing fixes.' },
];

const INTEGRATIONS: Array<{ name: string; note: string }> = [
  { name: 'Anthropic + OpenAI', note: 'the two brains behind every department' },
  { name: 'Stripe', note: 'the wallet — funded, gated, metered' },
  { name: 'Composio', note: 'real OAuth into Gmail, GitHub, LinkedIn' },
  { name: 'Terac', note: 'hires a real human when agents hit a wall' },
  { name: 'Linq', note: 'texts the founder when a real decision is needed' },
  { name: 'ElevenLabs', note: 'the founder’s own voice, cloned and consented' },
  { name: 'Render + Vercel', note: 'where the built product actually goes live' },
  { name: 'Replay', note: 'QA that catches it before a customer does' },
];

/** Reveals children once they cross into view — the scroll-triggered choreography for the whole page. */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${visible ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** A department card that tilts in 3D toward the cursor — cheap, dependency-free depth. */
function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--tilt-x', `${(-py * 10).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${(px * 12).toFixed(2)}deg`);
  };
  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
  };
  return (
    <div ref={ref} className={`tilt-card ${className}`} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

export function Landing({ onStart }: LandingProps) {
  const saved = savedAccount();
  const [profile, setProfile] = useState({ display_name: saved?.display_name ?? '', email: saved?.email ?? '' });
  const enter = () => {
    const clean = { display_name: profile.display_name.trim(), email: profile.email.trim() };
    if (clean.display_name.length > 1 || clean.email) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(clean));
    onStart(clean);
  };

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="brand-mark">YCBF</div>
          <h1>Your zero-human company, with you still in control.</h1>
          <p>
            Thirteen specialist departments research, build, sell, support, hire and improve the company.
            Agents can work fast, but money, real-person outreach, deployments and human hiring stop for founder approval.
          </p>
          <div className="landing-auth">
            <input className="input" value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} placeholder="Founder name" />
            <input className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="Email" type="email" />
            <button className="btn primary" onClick={enter}>{saved ? 'Continue setup' : 'Create account'}</button>
          </div>
          <button className="btn ghost" onClick={() => onStart(undefined)}>Try without account</button>
          <div className="scroll-cue spec muted">scroll to see the whole company &darr;</div>
        </div>
        <div className="landing-hq" aria-label="Cartoon company headquarters preview">
          {['D01 Intake', 'D02 Office Hours', 'D03 Research', 'D07 Build', 'D10 Sales', 'D11 Finance/HR'].map((d, i) => (
            <div key={d} className={`dept-tile t${i}`}>
              <span className="face">{[':)', ':|', ':D', ':]', ':>', ':o'][i]}</span>
              <b>{d}</b>
            </div>
          ))}
          <div className="hq-core">Boardroom</div>
        </div>
      </section>

      <section className="landing-bands">
        <div><b>Gated spending</b><span>Stripe wallet plus money_out review before a cent leaves.</span></div>
        <div><b>Phone approvals</b><span>Linq texts the founder when a real decision is needed.</span></div>
        <div><b>Real build path</b><span>Workspace folder, GitHub, Replay QA, then Vercel/Render deploy gates.</span></div>
      </section>

      <section className="landing-section">
        <Reveal className="section-head">
          <div className="spec muted">the whole company</div>
          <h2>Thirteen departments. One founder in the loop.</h2>
          <p className="section-lede">Every one of these is a real swarm of agents with a real job — click any of them once you're inside to watch them work, or ask what they're doing right now.</p>
        </Reveal>
        <div className="dept-grid-3d">
          {DEPARTMENTS.map((d, i) => (
            <Reveal key={d.id} delay={(i % 4) * 60}>
              <TiltCard className="dept-card-3d">
                <span className="dept-card-face">{d.face}</span>
                <div className="dept-card-id spec muted">{d.id}</div>
                <b>{d.name}</b>
                <p>{d.blurb}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section landing-flow">
        <Reveal className="section-head">
          <div className="spec muted">how it actually runs</div>
          <h2>From a spark to a company that watches itself.</h2>
        </Reveal>
        <div className="flow-timeline">
          {FLOW.map((f, i) => (
            <Reveal key={f.n} delay={i * 50}>
              <div className="flow-step">
                <div className="flow-n display">{f.n}</div>
                <div>
                  <b>{f.title}</b>
                  <p>{f.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <Reveal className="section-head">
          <div className="spec muted">built on real infrastructure</div>
          <h2>Not a toy — every integration does real work.</h2>
        </Reveal>
        <div className="integrations-grid">
          {INTEGRATIONS.map((it, i) => (
            <Reveal key={it.name} delay={(i % 4) * 50}>
              <div className="integration-chip">
                <b>{it.name}</b>
                <span>{it.note}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <Reveal className="landing-cta-inner">
          <h2>Bring the spark. Stay in control of the rest.</h2>
          <div className="landing-auth" style={{ margin: '0 auto' }}>
            <input className="input" value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} placeholder="Founder name" />
            <input className="input" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="Email" type="email" />
            <button className="btn primary" onClick={enter}>{saved ? 'Continue setup' : 'Create account'}</button>
          </div>
          <button className="btn ghost" onClick={() => onStart(undefined)}>Try without account</button>
        </Reveal>
      </section>
    </div>
  );
}
