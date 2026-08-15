import { useEffect, useRef, useState } from 'react';

/** Record (MediaRecorder) or upload a short voice sample. Returns base64 + mime + duration; audio never leaves the browser until the founder clicks clone. */
export function VoiceRecorder({ onSample, disabled }: { onSample: (s: { audio_base64: string; mime_type: string; duration_s: number; bytes: number } | null) => void; disabled?: boolean }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const finish = async (blob: Blob, duration_s: number) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    setPreview(URL.createObjectURL(blob));
    onSample({ audio_base64: b64, mime_type: blob.type || 'audio/webm', duration_s, bytes: buf.length });
  };
  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      const started = Date.now();
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void finish(new Blob(chunks.current, { type: r.mimeType }), (Date.now() - started) / 1000); if (timer.current) clearInterval(timer.current); setRec(null); };
      r.start(250); setRec(r); setSecs(0);
      let elapsed = 0;
      timer.current = window.setInterval(() => { elapsed += 1; setSecs(elapsed); if (elapsed >= 60 && r.state === 'recording') r.stop(); }, 1000);
    } catch (e: any) { setErr(`Microphone unavailable: ${e.message}`); }
  };
  const upload = async (f: File | undefined) => { if (!f) return; setErr(null); await finish(f, 0); };
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {!rec ? <button className="btn primary" onClick={start} disabled={disabled}>● Record 30–60s</button> : <button className="btn danger" onClick={() => rec.stop()}><span className="rec" /> Stop ({secs}s)</button>}
        <label className="btn" style={{ display: 'inline-block' }}>Upload file<input type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => upload(e.target.files?.[0])} disabled={disabled} /></label>
        {preview && <button className="btn ghost sm" onClick={() => { setPreview(null); onSample(null); }}>Discard</button>}
      </div>
      <div className="small muted">Read a paragraph naturally in a quiet room. 30 seconds is enough for an instant clone; only the resulting voice_id is stored.</div>
      {preview && <audio controls src={preview} style={{ width: '100%' }} />}
      {err && <div className="small" style={{ color: 'var(--err)' }}>{err}</div>}
    </div>
  );
}
