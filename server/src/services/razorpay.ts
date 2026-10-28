import { env } from '../config/env';
import { hmacSha256Hex, safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export interface GatewayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
  amount_refunded?: number;
  error_description?: string | null;
}

export interface GatewayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

export interface PaymentGateway {
  createOrder(input: { amount: number; receipt: string; notes?: Record<string, string> }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  capturePayment(paymentId: string, amount: number): Promise<GatewayPayment>;
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  refund(paymentId: string, amount: number, notes?: Record<string, string>): Promise<GatewayRefund>;
}

const API = 'https://api.razorpay.com/v1';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!env.razorpay.enabled) throw new AppError(503, 'payments_unavailable', 'Online payment is not configured.');
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string; code?: string } };
  if (!res.ok) {
    logger.error({ status: res.status, path, error: json?.error }, 'Razorpay API error');
    throw new AppError(502, 'gateway_error', json?.error?.description || 'The payment gateway returned an error.');
  }
  return json;
}

export const razorpayGateway: PaymentGateway = {
  createOrder: ({ amount, receipt, notes }) =>
    call<GatewayOrder>('POST', '/orders', { amount, currency: 'INR', receipt, notes, payment_capture: 1 }),
  fetchPayment: (id) => call<GatewayPayment>('GET', `/payments/${encodeURIComponent(id)}`),
  capturePayment: (id, amount) =>
    call<GatewayPayment>('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount, currency: 'INR' }),
  fetchOrderPayments: async (orderId) =>
    (await call<{ items: GatewayPayment[] }>('GET', `/orders/${encodeURIComponent(orderId)}/payments`)).items ?? [],
  refund: (id, amount, notes) =>
    call<GatewayRefund>('POST', `/payments/${encodeURIComponent(id)}/refund`, { amount, notes, speed: 'normal' }),
};

let active: PaymentGateway = razorpayGateway;

export function gateway(): PaymentGateway {
  return active;
}

/** Test hook: substitute a fake gateway. */
export function setPaymentGateway(g: PaymentGateway | null): void {
  active = g ?? razorpayGateway;
}

/** Signature Razorpay Checkout returns to the browser: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!env.razorpay.keySecret || !signature) return false;
  const expected = hmacSha256Hex(env.razorpay.keySecret, `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook secret). Must use the exact raw bytes. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!env.razorpay.webhookSecret || !signature) return false;
  const expected = hmacSha256Hex(env.razorpay.webhookSecret, rawBody);
  return safeEqual(expected, signature);
}
