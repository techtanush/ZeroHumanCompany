import { useState } from 'react';

/**
 * "Choose the workspace this AI company can build inside."
 * Browsers never reveal a real path from a folder picker, so the picker only
 * confirms the folder name; the absolute path is typed/pasted (drag a folder
 * from Finder into a terminal to copy it). Both end up as workspace_root.
 */
export function WorkspacePicker({ value, onChange }: { value: string; onChange: (path: string, source: 'typed' | 'picker') => void }) {
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [supportsPicker] = useState(() => typeof (window as any).showDirectoryPicker === 'function');
  const pick = async () => {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      setPickedName(handle.name);
      // If the typed path doesn't end with the picked folder name, hint the founder to complete it.
      if (!value.trim()) onChange(`~/${handle.name}`, 'picker');
      else if (!value.replace(/\/+$/, '').endsWith(handle.name)) onChange(`${value.replace(/\/+$/, '')}/${handle.name}`, 'picker');
      else onChange(value, 'picker');
    } catch { /* cancelled */ }
  };
  const abs = /^(\/|~\/|[A-Za-z]:\\)/.test(value.trim());
  return (
    <div className={`folder ${value ? 'on' : ''}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        {supportsPicker && <button className="btn" onClick={pick}>📁 Choose folder…</button>}
        <span className="small muted">{supportsPicker ? 'or ' : ''}paste the absolute path (Finder: drag the folder into Terminal to copy it)</span>
      </div>
      <input className="input mono" placeholder="/Users/you/Projects/my-venture" value={value} onChange={(e) => onChange(e.target.value, 'typed')} spellCheck={false} />
      {pickedName && <div className="tiny muted">Picked folder: <b>{pickedName}</b> — browsers hide the full path, so confirm it above.</div>}
      {value && !abs && <div className="tiny" style={{ color: 'var(--warn)' }}>Use an absolute path (starts with / or ~/) so Build can find it on your machine.</div>}
      <div className="small muted">The agency uses this folder — and only this folder — for generated code, build artifacts and repo work (git, tests, builds). Nothing outside it is read or written; shell commands are allow-listed; deploys still need your approval.</div>
    </div>
  );
}
