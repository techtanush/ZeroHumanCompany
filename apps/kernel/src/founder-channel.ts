import type { GateRecord } from '@zeroth/contracts';

interface FounderNoticeResult {
  delivered: boolean;
  message_id?: string;
  degraded?: string;
}

function gateText(gate: GateRecord): string {
  const options = gate.options.map((option) => `${option.id}: ${option.label} (${option.consequence})`).join('\n');
  const amount = gate.amount_usd == null ? '' : `\nAmount: $${gate.amount_usd.toFixed(2)}`;
  return [
    `Decision needed: ${gate.gate_type}`,
    String(gate.preview.summary ?? gate.preview.title ?? gate.action.tool),
    amount,
    options ? `Reply with one option:\n${options}` : '',
    `Gate: ${gate.id}`,
  ].filter(Boolean).join('\n\n');
}

export async function notifyFounderByLinq(gate: GateRecord): Promise<FounderNoticeResult> {
  return sendFounderText({
    text: gateText(gate),
    metadata: { gate_id: gate.id, venture_id: gate.venture_id },
  });
}

export async function sendFounderText(input: {
  text: string;
  to?: string;
  metadata?: Record<string, unknown>;
}): Promise<FounderNoticeResult> {
  const apiKey = process.env.LINQ_API_KEY;
  const founderPhone = input.to ?? process.env.FOUNDER_PHONE;
  if (!apiKey || !founderPhone) {
    return { delivered: false, degraded: 'missing LINQ_API_KEY or FOUNDER_PHONE' };
  }

  const baseUrl = process.env.LINQ_BASE_URL ?? 'https://api.linqapp.com/api/partner/v3';
  const body = {
    from: process.env.LINQ_FROM_NUMBER || undefined,
    to: [founderPhone],
    message: {
      parts: [{ text: input.text }],
      metadata: input.metadata ?? {},
    },
  };

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    return { delivered: false, degraded: `linq ${response.status}: ${text.slice(0, 160)}` };
  }
  try {
    const json = JSON.parse(text) as { message_id?: string; id?: string };
    return { delivered: true, message_id: json.message_id ?? json.id };
  } catch {
    return { delivered: true };
  }
}
