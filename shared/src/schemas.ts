import { z } from 'zod';
import { ENQUIRY_TOPICS, ENQUIRY_TYPES, PAYMENT_METHODS } from './constants';
import { INDIAN_STATES, MOBILE_REGEX, PINCODE_REGEX, GSTIN_REGEX, normalizeIndianMobile } from './india';

export const mobileSchema = z
  .string({ message: 'Enter a mobile number' })
  .trim()
  .transform(normalizeIndianMobile)
  .refine((v) => MOBILE_REGEX.test(v), { message: 'Enter a valid 10-digit Indian mobile number' });

export const pincodeSchema = z
  .string({ message: 'Enter a PIN code' })
  .trim()
  .regex(PINCODE_REGEX, { message: 'Enter a valid 6-digit PIN code' });

export const emailSchema = z
  .string({ message: 'Enter an email address' })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const nameSchema = z
  .string({ message: 'Enter a name' })
  .trim()
  .min(2, { message: 'Name must be at least 2 characters' })
  .max(80, { message: 'Name is too long' });

export const passwordSchema = z
  .string({ message: 'Enter a password' })
  .min(8, { message: 'Use at least 8 characters' })
  .max(128, { message: 'Password is too long' });

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, { message: 'Enter a valid 15-character GSTIN' });

export const addressSchema = z.object({
  fullName: nameSchema,
  phone: mobileSchema,
  line1: z.string().trim().min(3, { message: 'Enter house / flat and street' }).max(120),
  line2: z.string().trim().max(120).optional().default(''),
  landmark: z.string().trim().max(80).optional().default(''),
  city: z.string().trim().min(2, { message: 'Enter a city' }).max(60),
  state: z.enum(INDIAN_STATES, { message: 'Choose a state' }),
  pincode: pincodeSchema,
});
export type AddressInput = z.input<typeof addressSchema>;
export type Address = z.output<typeof addressSchema>;

export const savedAddressSchema = addressSchema.extend({
  label: z.string().trim().max(30).optional().default('Home'),
  isDefault: z.boolean().optional().default(false),
});

export const customerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: mobileSchema,
});

export const checkoutSchema = z.object({
  customer: customerSchema,
  address: addressSchema,
  paymentMethod: z.enum(PAYMENT_METHODS, { message: 'Choose a payment method' }),
  notes: z.string().trim().max(500).optional().default(''),
  gstin: z.union([gstinSchema, z.literal('')]).optional().default(''),
  saveAddress: z.boolean().optional().default(false),
  marketingConsent: z.boolean().optional().default(false),
  /** The total the customer saw. If the server's total differs, the order is not placed. */
  expectedTotal: z.number().int().nonnegative().optional(),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: z.union([mobileSchema, z.literal('')]).optional().default(''),
  password: passwordSchema,
  marketingConsent: z.boolean().optional().default(false),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Enter your password' }).max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Enter your current password' }),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: nameSchema,
  phone: z.union([mobileSchema, z.literal('')]).optional().default(''),
  marketingConsent: z.boolean().optional(),
});

export const enquirySchema = z
  .object({
    type: z.enum(ENQUIRY_TYPES),
    name: z.string().trim().max(80).optional().default(''),
    email: z.union([emailSchema, z.literal('')]).optional().default(''),
    phone: z.union([mobileSchema, z.literal('')]).optional().default(''),
    message: z.string().trim().max(2000).optional().default(''),
    productId: z.string().trim().max(40).optional(),
    preferredContact: z.enum(['phone', 'whatsapp', 'email']).optional(),
    topic: z.enum(ENQUIRY_TOPICS).optional(),
    monthlyAmount: z.number().int().nonnegative().max(100_000_000).optional(),
    consent: z.boolean().optional().default(false),
    /** Honeypot: real visitors never see or fill this field. */
    website: z.string().max(0).optional().default(''),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'newsletter') {
      if (!v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter your email address' });
      if (!v.consent) ctx.addIssue({ code: 'custom', path: ['consent'], message: 'Please confirm you want to receive emails' });
      return;
    }
    if (v.name.length < 2) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter your name' });
    if (v.type === 'savings_plan' || v.type === 'contact') {
      // We reply by calling or messaging back: we need a number, and permission to use it.
      if (!v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter your mobile number so we can get back to you' });
      if (!v.consent) ctx.addIssue({ code: 'custom', path: ['consent'], message: 'Please agree to be contacted about this enquiry' });
      if (v.type === 'contact' && !v.topic) ctx.addIssue({ code: 'custom', path: ['topic'], message: 'Choose what your message is about' });
    } else if (!v.phone && !v.email) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a phone number or email so we can reply' });
    }
    if (v.preferredContact === 'email' && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter your email, or choose another way to reach you' });
    if (v.preferredContact === 'whatsapp' && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter your WhatsApp number' });
    if (v.type !== 'savings_plan' && v.message.length < 5)
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'Tell us a little more' });
  });
export type EnquiryInput = z.input<typeof enquirySchema>;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(100).optional().default(''),
  body: z.string().trim().min(10, { message: 'Write at least a sentence' }).max(2000),
});
export type ReviewInput = z.input<typeof reviewSchema>;

export const trackOrderSchema = z.object({
  orderNumber: z.string().trim().toUpperCase().min(6).max(40),
  contact: z.string().trim().min(5, { message: 'Enter the email or mobile used at checkout' }).max(254),
});

export const cartItemSchema = z.object({
  productId: z.string().regex(/^[a-f0-9]{24}$/i, { message: 'Invalid product' }),
  variantId: z.string().regex(/^[a-f0-9]{24}$/i, { message: 'Invalid variant' }),
  qty: z.number().int().min(1).max(10),
});

export const cartQtySchema = z.object({ qty: z.number().int().min(0).max(10) });

export const couponApplySchema = z.object({ code: z.string().trim().toUpperCase().min(3).max(30) });
