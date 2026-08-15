/**
 * Founder phone → E.164. Mirrors the normaliser used by the onboarding wizard:
 *   • strips everything except digits and '+'
 *   • already '+…' → returned as-is
 *   • 10 digits → assumed US/CA, '+1' prefixed
 *   • 11 digits starting with '1' → '+' prefixed
 *   • anything else non-empty → '+' prefixed; empty → ''
 */
export function toE164(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d ? `+${d}` : '';
}
