export function hasKey() {
  return Boolean(process.env.SIMPOP_URL);
}

export async function run(args: unknown) {
  const base = process.env.SIMPOP_URL;
  if (!base) throw new Error('SIMPOP_URL is required for real simpop tools');
  const response = await fetch(`${base.replace(/\/$/, '')}/panel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`simpop request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}
