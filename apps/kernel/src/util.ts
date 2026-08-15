import { createHash, createHmac, randomUUID } from 'node:crypto';

/** Canonical JSON: sorted keys, no whitespace. The basis of every hash we take. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function bodyHash(body: unknown): string {
  return sha256(canonicalJson(body));
}

export function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export const uuid = randomUUID;

export function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve an RFC 6901 JSON pointer against a value. Returns undefined if absent. */
export function getPointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) throw new Error(`invalid json pointer: ${pointer}`);
  let cur: any = doc;
  for (const rawPart of pointer.slice(1).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = cur[part];
    } else return undefined;
  }
  return cur;
}

/** Every JSON pointer in a document whose value is a number, for evidence checks. */
export function numericPointers(doc: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (typeof doc === 'number') {
    if (prefix !== '') out.push(prefix);
    return out;
  }
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => out.push(...numericPointers(v, `${prefix}/${i}`)));
    return out;
  }
  if (doc && typeof doc === 'object') {
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      const esc = k.replace(/~/g, '~0').replace(/\//g, '~1');
      out.push(...numericPointers(v, `${prefix}/${esc}`));
    }
  }
  return out;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'venture';
}
