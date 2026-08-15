import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { Db } from '@zeroth/db';
import { KernelError } from './event-store.js';
import { uuid } from './util.js';

/**
 * Identity Vault. Credentials are stored AES-256-GCM encrypted at rest and are
 * only ever handed out as short-lived scoped handles. A raw secret must never
 * appear in an event, an artifact, a log line, or a prompt.
 */
export class Vault {
  private key: Buffer;
  private handles = new Map<string, { credential_id: string; expires_at: number; scopes: string[] }>();

  constructor(
    private db: Db,
    masterKey: string = process.env.KERNEL_VAULT_KEY ?? 'dev-only-vault-key',
  ) {
    this.key = scryptSync(masterKey, 'zeroth-vault-v1', 32);
  }

  async put(input: {
    venture_id?: string;
    vendor: string;
    label?: string;
    secret: string;
    scopes?: string[];
  }): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(input.secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const id = uuid();
    const label = input.label ?? 'default';

    await this.db.query(
      `INSERT INTO credentials (id, venture_id, vendor, label, ciphertext, iv, auth_tag, scopes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (venture_id, vendor, label) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag`,
      [id, input.venture_id ?? null, input.vendor, label,
       ct.toString('base64'), iv.toString('base64'), tag.toString('base64'),
       JSON.stringify(input.scopes ?? [])],
    );
    return id;
  }

  /** Mint a short-lived handle. Agents get handles, never secrets. */
  async mintHandle(
    vendor: string,
    opts: { venture_id?: string; label?: string; scopes?: string[]; ttl_s?: number } = {},
  ): Promise<string> {
    const r = await this.db.query<{ id: string; scopes: string }>(
      `SELECT id, scopes FROM credentials
        WHERE vendor = $1 AND label = $2 AND (venture_id = $3 OR venture_id IS NULL)
        ORDER BY venture_id NULLS LAST LIMIT 1`,
      [vendor, opts.label ?? 'default', opts.venture_id ?? null],
    );
    if (r.rows.length === 0) {
      throw new KernelError('credential_missing', `no credential for vendor "${vendor}"`, false, 404);
    }
    const handle = `vh_${randomBytes(16).toString('hex')}`;
    this.handles.set(handle, {
      credential_id: r.rows[0].id,
      expires_at: Date.now() + (opts.ttl_s ?? 900) * 1000,
      scopes: opts.scopes ?? [],
    });
    return handle;
  }

  /** Only the tool plane redeems handles, at the moment of the outbound call. */
  async redeem(handle: string): Promise<string> {
    const h = this.handles.get(handle);
    if (!h) throw new KernelError('invalid_handle', 'unknown credential handle', false, 403);
    if (Date.now() > h.expires_at) {
      this.handles.delete(handle);
      throw new KernelError('handle_expired', 'credential handle expired', true, 403);
    }
    const r = await this.db.query<any>('SELECT * FROM credentials WHERE id = $1', [h.credential_id]);
    if (r.rows.length === 0) throw new KernelError('credential_missing', 'credential deleted', false, 404);
    const row = r.rows[0];
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Redact any stored secret value found in arbitrary text before it is logged. */
  static redact(text: string, secrets: string[]): string {
    let out = text;
    for (const s of secrets) {
      if (s && s.length >= 8) out = out.split(s).join('[redacted]');
    }
    return out.replace(/\b(sk|pk|whsec|rnd|key)_[A-Za-z0-9_-]{8,}/g, '[redacted]');
  }
}
