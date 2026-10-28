import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  PAYMENT_METHODS,
  PINCODE_REGEX,
  INDIAN_STATES,
  cartItemSchema,
  cartQtySchema,
  checkoutSchema,
  couponApplySchema,
  type PaymentMethod,
} from '@goldshop/shared';
import { env } from '../config/env';
import { randomToken } from '../lib/crypto';
import { badRequest } from '../lib/errors';
import { parse } from '../lib/http';
import { checkoutLimiter, lookupLimiter } from '../middleware/security';
import { addItem, evaluateCart, findCart, removeLine, setCoupon, setLineQty, type CartOwner } from '../services/cart';
import { placeOrder } from '../services/orders';
import { getSettings } from '../services/settings';
import { lookupPincode, quoteShipping } from '../services/shipping';

export const CART_COOKIE = 'gs_cart';
const TOKEN_RX = /^[A-Za-z0-9_-]{20,64}$/;

export function cartOwner(req: Request, res: Response, create: boolean): CartOwner {
  if (req.user) return { userId: req.user.id };
  let token: string | undefined = req.cookies?.[CART_COOKIE];
  if (!token || !TOKEN_RX.test(token)) {
    if (!create) return {};
    token = randomToken(24);
    res.cookie(CART_COOKIE, token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
  return { guestToken: token };
}

function quoteOptions(req: Request) {
  const pincode = typeof req.query.pincode === 'string' && PINCODE_REGEX.test(req.query.pincode) ? req.query.pincode : undefined;
  const state =
    typeof req.query.state === 'string' && (INDIAN_STATES as readonly string[]).includes(req.query.state) ? req.query.state : undefined;
  const paymentMethod =
    typeof req.query.paymentMethod === 'string' && (PAYMENT_METHODS as readonly string[]).includes(req.query.paymentMethod)
      ? (req.query.paymentMethod as PaymentMethod)
      : undefined;
  const email = typeof req.query.email === 'string' ? req.query.email.slice(0, 254).toLowerCase() : undefined;
  return { pincode, state, paymentMethod, email };
}

export const cartRouter = Router();

cartRouter.get('/cart', async (req, res) => {
  const owner = cartOwner(req, res, false);
  const cart = await findCart(owner);
  const { view } = await evaluateCart(cart, { ...quoteOptions(req), userId: req.user?.id, email: quoteOptions(req).email ?? req.user?.email, persist: true });
  res.set('Cache-Control', 'no-store');
  res.json(view);
});

cartRouter.post('/cart/items', async (req, res) => {
  const input = parse(cartItemSchema, req.body);
  const owner = cartOwner(req, res, true);
  const { cart, message } = await addItem(owner, input);
  const { view } = await evaluateCart(cart, { userId: req.user?.id });
  res.status(201).json({ cart: view, message });
});

cartRouter.patch('/cart/items/:lineId', async (req, res) => {
  const { qty } = parse(cartQtySchema, req.body);
  const owner = cartOwner(req, res, false);
  const cart = await setLineQty(owner, String(req.params.lineId), qty);
  const { view } = await evaluateCart(cart, { ...quoteOptions(req), userId: req.user?.id });
  res.json({ cart: view });
});

cartRouter.delete('/cart/items/:lineId', async (req, res) => {
  const owner = cartOwner(req, res, false);
  const cart = await removeLine(owner, String(req.params.lineId));
  const { view } = await evaluateCart(cart, { ...quoteOptions(req), userId: req.user?.id });
  res.json({ cart: view });
});

cartRouter.post('/cart/coupon', async (req, res) => {
  const { code } = parse(couponApplySchema, req.body);
  const owner = cartOwner(req, res, true);
  const existing = await findCart(owner);
  if (!existing || existing.items.length === 0) throw badRequest('Add something to your bag before applying a code.');
  const previous = existing.couponCode;
  const cart = await setCoupon(owner, code);
  const { view } = await evaluateCart(cart, { ...quoteOptions(req), userId: req.user?.id, email: req.user?.email });
  if (!view.coupon?.valid) {
    await setCoupon(owner, previous || null);
    throw badRequest(view.coupon?.message ?? "This code isn't valid.", { code: view.coupon?.message ?? 'Invalid code' }, 'coupon_invalid');
  }
  res.json({ cart: view });
});

cartRouter.delete('/cart/coupon', async (req, res) => {
  const owner = cartOwner(req, res, false);
  const cart = await setCoupon(owner, null);
  const { view } = await evaluateCart(cart, { ...quoteOptions(req), userId: req.user?.id });
  res.json({ cart: view });
});

/** Delivery estimate for a PIN code (product page and checkout). */
cartRouter.get('/shipping/check', lookupLimiter, async (req, res) => {
  const pincode = String(req.query.pincode ?? '').trim();
  if (!PINCODE_REGEX.test(pincode)) throw badRequest('Enter a valid 6-digit PIN code.', { pincode: 'Invalid PIN code' });
  const settings = await getSettings();
  const place = await lookupPincode(pincode);
  const owner = cartOwner(req, res, false);
  const cart = await findCart(owner);
  let subtotal = 0;
  if (cart?.items.length) subtotal = (await evaluateCart(cart, { userId: req.user?.id })).view.subtotal;
  const state = typeof req.query.state === 'string' ? req.query.state : place.state;
  const quote = quoteShipping(settings, pincode, subtotal, state);
  res.json({ ...quote, city: place.city, state: place.state });
});

cartRouter.post('/checkout', checkoutLimiter, async (req, res) => {
  const input = parse(checkoutSchema, req.body);
  const owner = cartOwner(req, res, false);
  if (!owner.userId && !owner.guestToken) throw badRequest('Your bag is empty.', undefined, 'cart_empty');
  const result = await placeOrder(input, { owner, user: req.user });
  res.status(201).json(result);
});
