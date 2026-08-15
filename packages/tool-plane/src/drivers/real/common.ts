export type Headers = Record<string, string>;

export interface JsonRequest {
  vendor: string;
  url: string;
  apiKey: string;
  headers?: Headers;
  body: unknown;
  method?: string;
  timeoutMs?: number;
}

export function hasEnv(env: string): boolean {
  return Boolean(process.env[env]);
}

export function bearer(key: string): Headers {
  return { authorization: `Bearer ${key}` };
}

export function sanitizeError(error: unknown, apiKey?: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const safe = apiKey ? raw.split(apiKey).join('[redacted]') : raw;
  return new Error(safe);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function encodeForm(value: unknown, prefix?: string): string {
  const pairs: string[] = [];

  function visit(current: unknown, key: string): void {
    if (current === undefined) return;
    if (current === null || typeof current !== 'object') {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(current ?? ''))}`);
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${key}[${index}]`));
      return;
    }

    for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
      visit(childValue, key ? `${key}[${childKey}]` : childKey);
    }
  }

  if (prefix) visit(value, prefix);
  else {
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) visit(childValue, key);
  }

  return pairs.join('&');
}

export async function requestWithRetry(vendor: string, url: string, init: RequestInit, apiKey: string, timeoutMs = 20_000): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        await response.text().catch(() => '');
        await sleep(250);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt === 0) {
        await sleep(250);
        continue;
      }
      throw sanitizeError(error, apiKey);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`${vendor} request failed`);
}

export async function postJson({ vendor, url, apiKey, headers = {}, body, method = 'POST', timeoutMs }: JsonRequest): Promise<unknown> {
  try {
    const response = await requestWithRetry(
      vendor,
      url,
      {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      },
      apiKey,
      timeoutMs,
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`${vendor} ${response.status}: ${text.slice(0, 300)}`);
    return parseMaybeJson(text);
  } catch (error) {
    throw sanitizeError(error, apiKey);
  }
}

export async function postForm(vendor: string, url: string, apiKey: string, headers: Headers, body: unknown): Promise<unknown> {
  try {
    const response = await requestWithRetry(
      vendor,
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: encodeForm(body),
      },
      apiKey,
    );
    const text = await response.text();
    if (!response.ok) throw new Error(`${vendor} ${response.status}: ${text.slice(0, 300)}`);
    return parseMaybeJson(text);
  } catch (error) {
    throw sanitizeError(error, apiKey);
  }
}
