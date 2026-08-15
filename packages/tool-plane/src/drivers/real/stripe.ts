import { hasEnv, postForm } from './common.js';

const env = 'STRIPE_SECRET_KEY';

export function hasKey(): boolean {
  return hasEnv(env);
}

export async function run(args: unknown): Promise<unknown> {
  const key = process.env[env]!;
  const input = args as { name: string; amount_cents: number; currency?: string; price?: string };

  // Stripe requires form encoding with bracketed arrays, not JSON.
  const form = {
    'line_items': [
      input.price
        ? { price: input.price, quantity: 1 }
        : { price_data: { currency: input.currency ?? 'usd', product_data: { name: input.name }, unit_amount: input.amount_cents }, quantity: 1 },
    ],
  };

  return postForm('stripe', 'https://api.stripe.com/v1/payment_links', key, { authorization: `Bearer ${key}` }, form);
}
