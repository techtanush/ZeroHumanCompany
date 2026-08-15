import { sanitizeError } from './common.js';

export function hasKey(): boolean {
  return Boolean(process.env.BUSINESS_TOOLS_URL);
}

export async function runTool(toolName: string, args: unknown): Promise<unknown> {
  const base = process.env.BUSINESS_TOOLS_URL;
  if (!base) throw new Error('BUSINESS_TOOLS_URL is required for real business tools');
  const apiKey = process.env.BUSINESS_TOOLS_API_KEY ?? '';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/tools/${encodeURIComponent(toolName)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`business-tools ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw sanitizeError(error, apiKey);
  }
}
