import { useState } from 'react';

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
          <div className="brand-mark">Zeroth</div>
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
    </div>
  );
}
