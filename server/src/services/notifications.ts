import type { Types } from 'mongoose';
import { ENQUIRY_TOPIC_LABELS, ENQUIRY_TYPE_LABELS, ORDER_STATUS_LABELS, formatINR, type EnquiryTopic, type EnquiryType, type OrderStatus } from '@goldshop/shared';
import { env } from '../config/env';
import type { IOrder } from '../models';
import { escapeHtml, layout, sendMail } from './mailer';
import { getSettings } from './settings';

type OrderLike = (IOrder & { _id: Types.ObjectId }) | null;

function itemsTable(order: IOrder): string {
  const rows = order.items
    .map(
      (i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee4d3">${escapeHtml(i.name)}${i.variantLabel ? ` · ${escapeHtml(i.variantLabel)}` : ''} × ${i.qty}</td>
<td style="padding:8px 0;border-bottom:1px solid #eee4d3;text-align:right">${formatINR(i.lineTotal)}</td></tr>`,
    )
    .join('');
  const line = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:4px 0;${bold ? 'font-weight:bold' : ''}">${label}</td><td style="padding:4px 0;text-align:right;${bold ? 'font-weight:bold' : ''}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">${rows}
${line('Subtotal', formatINR(order.pricing.subtotal))}
${order.pricing.discount ? line(`Discount${order.coupon?.code ? ` (${escapeHtml(order.coupon.code)})` : ''}`, `−${formatINR(order.pricing.discount)}`) : ''}
${line('Shipping', order.pricing.shipping ? formatINR(order.pricing.shipping) : 'Free')}
${order.pricing.codFee ? line('Cash on delivery fee', formatINR(order.pricing.codFee)) : ''}
${line('Total (incl. GST)', formatINR(order.pricing.total), true)}</table>`;
}

function orderLink(orderNumber: string): string {
  return `${env.publicUrl}/track-order?order=${encodeURIComponent(orderNumber)}`;
}

export async function notifyOrderConfirmed(order: OrderLike): Promise<void> {
  if (!order) return;
  const settings = await getSettings();
  const store = settings.store.name;
  const payLine =
    order.payment.method === 'cod'
      ? `Please keep ${formatINR(order.pricing.total)} ready to pay on delivery.`
      : 'Your payment has been received.';
  const html = layout(
    store,
    'Thank you for your order',
    `<p>Dear ${escapeHtml(order.customer.name)},</p>
<p>We've received your order <strong>${escapeHtml(order.orderNumber)}</strong>. ${payLine} We'll let you know as soon as it ships.</p>
${itemsTable(order)}
<p><strong>Delivering to</strong><br>${escapeHtml(order.shippingAddress.fullName)}<br>${escapeHtml(order.shippingAddress.line1)}${order.shippingAddress.line2 ? `, ${escapeHtml(order.shippingAddress.line2)}` : ''}<br>${escapeHtml(order.shippingAddress.city)}, ${escapeHtml(order.shippingAddress.state)} ${escapeHtml(order.shippingAddress.pincode)}</p>
<p><a href="${orderLink(order.orderNumber)}" style="color:#7a5a1e">Track your order</a></p>
${settings.store.phone ? `<p style="color:#6b6157">Questions? Call us on ${escapeHtml(settings.store.phone)}.</p>` : ''}`,
  );
  await sendMail({
    to: order.customer.email,
    subject: `${store}: order ${order.orderNumber} confirmed`,
    html,
    text: `Thank you for your order ${order.orderNumber}. Total ${formatINR(order.pricing.total)}. Track it at ${orderLink(order.orderNumber)}`,
    replyTo: settings.store.email || undefined,
  });

  const notify = env.smtp.notify || settings.store.email;
  if (notify) {
    await sendMail({
      to: notify,
      subject: `New order ${order.orderNumber} · ${formatINR(order.pricing.total)} · ${order.payment.method.toUpperCase()}`,
      html: layout(store, `New order ${order.orderNumber}`, `<p>${escapeHtml(order.customer.name)} · ${escapeHtml(order.customer.phone)} · ${escapeHtml(order.customer.email)}</p>${itemsTable(order)}<p><a href="${env.publicUrl}/admin/orders/${encodeURIComponent(order.orderNumber)}">Open in admin</a></p>`),
      text: `New order ${order.orderNumber} for ${formatINR(order.pricing.total)}.`,
    });
  }
}

const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  shipped: 'Good news: your order is on its way.',
  out_for_delivery: 'Your order is out for delivery today.',
  delivered: 'Your order has been delivered. We hope you love it.',
  cancelled: 'Your order has been cancelled. If you paid online, any refund will be processed to your original payment method.',
  returned: 'We have received your return.',
};

export async function notifyOrderStatus(order: IOrder, status: OrderStatus): Promise<void> {
  const message = STATUS_MESSAGES[status];
  if (!message) return;
  const settings = await getSettings();
  const tracking =
    status === 'shipped' && order.shipment?.trackingNumber
      ? `<p><strong>${escapeHtml(order.shipment.carrier ?? 'Courier')}</strong> tracking number: ${escapeHtml(order.shipment.trackingNumber)}${order.shipment.trackingUrl ? `<br><a href="${escapeHtml(order.shipment.trackingUrl)}" style="color:#7a5a1e">Track with the courier</a>` : ''}</p>`
      : '';
  await sendMail({
    to: order.customer.email,
    subject: `${settings.store.name}: order ${order.orderNumber} ${ORDER_STATUS_LABELS[status].toLowerCase()}`,
    html: layout(
      settings.store.name,
      ORDER_STATUS_LABELS[status],
      `<p>Dear ${escapeHtml(order.customer.name)},</p><p>${message}</p>${tracking}<p><a href="${orderLink(order.orderNumber)}" style="color:#7a5a1e">View order ${escapeHtml(order.orderNumber)}</a></p>`,
    ),
    text: `${message} Order ${order.orderNumber}: ${orderLink(order.orderNumber)}`,
    replyTo: settings.store.email || undefined,
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<boolean> {
  const settings = await getSettings();
  const link = `${env.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to,
    subject: `${settings.store.name}: reset your password`,
    html: layout(
      settings.store.name,
      'Reset your password',
      `<p>Hello ${escapeHtml(name)},</p><p>Use the link below to choose a new password. It expires in 30 minutes.</p><p><a href="${link}" style="display:inline-block;background:#231c15;color:#fff;padding:12px 20px;text-decoration:none">Choose a new password</a></p><p style="color:#6b6157">If you didn't ask for this, you can ignore this email.</p>`,
    ),
    text: `Reset your password: ${link} (expires in 30 minutes)`,
  });
}

const CONTACT_LABELS = { phone: 'Phone call', whatsapp: 'WhatsApp', email: 'Email' } as const;

export async function notifyEnquiry(e: {
  type: EnquiryType;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  preferredContact?: keyof typeof CONTACT_LABELS | null;
  monthlyAmount?: number | null;
  topic?: EnquiryTopic | null;
}): Promise<void> {
  const settings = await getSettings();
  const to = env.smtp.notify || settings.store.email;
  if (!to || e.type === 'newsletter') return;
  // What the team needs to act on a call-back: how to reach them and, for the savings plan, how much.
  const details = [
    e.topic ? `About: ${ENQUIRY_TOPIC_LABELS[e.topic]}` : '',
    e.preferredContact ? `Prefers: ${CONTACT_LABELS[e.preferredContact]}` : '',
    e.monthlyAmount ? `Monthly amount: ${formatINR(e.monthlyAmount)}` : '',
  ].filter(Boolean);
  await sendMail({
    to,
    subject: `${ENQUIRY_TYPE_LABELS[e.type]} from ${e.name}`,
    html: layout(
      settings.store.name,
      ENQUIRY_TYPE_LABELS[e.type],
      `<p><strong>${escapeHtml(e.name)}</strong><br>${escapeHtml(e.phone ?? '')} ${escapeHtml(e.email ?? '')}</p>${details.length ? `<p>${details.map(escapeHtml).join('<br>')}</p>` : ''}<p>${escapeHtml(e.message ?? '').replace(/\n/g, '<br>')}</p><p><a href="${env.publicUrl}/admin/enquiries">Open enquiries</a></p>`,
    ),
    text: `${ENQUIRY_TYPE_LABELS[e.type]} from ${e.name} (${e.phone ?? ''} ${e.email ?? ''})${details.length ? ` — ${details.join(', ')}` : ''}: ${e.message ?? ''}`,
    replyTo: e.email || undefined,
  });
}
