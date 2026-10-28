import { Schema, model } from 'mongoose';
import { ENQUIRY_TOPICS, ENQUIRY_TYPES, PURITY_KEYS } from '@goldshop/shared';
import { imageSchema, seoSchema } from './common';

/* ---------- Reviews: only customers with a delivered order for the product may write one ---------- */
const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    authorName: { type: String, required: true, maxlength: 80 },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: '', maxlength: 100 },
    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
);
reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, status: 1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });
export const Review = model('Review', reviewSchema);

/* ---------- Homepage banners ---------- */
const bannerSchema = new Schema(
  {
    eyebrow: { type: String, default: '', maxlength: 60 },
    title: { type: String, required: true, maxlength: 120 },
    subtitle: { type: String, default: '', maxlength: 300 },
    ctaLabel: { type: String, default: '', maxlength: 40 },
    ctaHref: { type: String, default: '', maxlength: 300 },
    secondaryLabel: { type: String, default: '', maxlength: 40 },
    secondaryHref: { type: String, default: '', maxlength: 300 },
    image: { type: imageSchema },
    mobileImage: { type: imageSchema },
    /** Short script words over the photo, one line each (full-width layout). */
    script: { type: String, default: '', maxlength: 90 },
    /** Up to three short trust points under the button, one per line. */
    points: { type: String, default: '', maxlength: 200 },
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    align: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    /** 'split' frames a portrait image in an arch; 'full' runs a landscape image edge to edge behind the text. */
    layout: { type: String, enum: ['split', 'full'], default: 'split' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    demo: { type: Boolean, default: false },
    startsAt: { type: Date },
    endsAt: { type: Date },
  },
  { timestamps: true },
);
bannerSchema.index({ isActive: 1, sortOrder: 1 });
export const Banner = model('Banner', bannerSchema);

/* ---------- Testimonials: entered by staff from genuine customer feedback ---------- */
const testimonialSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    location: { type: String, default: '', maxlength: 80 },
    quote: { type: String, required: true, maxlength: 600 },
    rating: { type: Number, min: 1, max: 5 },
    source: { type: String, default: '', maxlength: 60 },
    isPublished: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
testimonialSchema.index({ isPublished: 1, sortOrder: 1 });
export const Testimonial = model('Testimonial', testimonialSchema);

/* ---------- Enquiries & leads (contact form, savings plan, newsletter) ---------- */
const enquirySchema = new Schema(
  {
    type: { type: String, enum: ENQUIRY_TYPES, required: true },
    name: { type: String, default: '', maxlength: 80 },
    email: { type: String, default: '', lowercase: true, maxlength: 254 },
    phone: { type: String, default: '', maxlength: 15 },
    message: { type: String, default: '', maxlength: 2000 },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    preferredContact: { type: String, enum: ['phone', 'whatsapp', 'email'] },
    topic: { type: String, enum: ENQUIRY_TOPICS },
    monthlyAmount: { type: Number },
    consent: { type: Boolean, default: false },
    status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
    notes: { type: String, default: '', maxlength: 2000 },
    ip: { type: String, default: '', select: false },
  },
  { timestamps: true },
);
enquirySchema.index({ status: 1, createdAt: -1 });
enquirySchema.index({ type: 1, createdAt: -1 });
enquirySchema.index({ type: 1, email: 1 });
export const Enquiry = model('Enquiry', enquirySchema);

/* ---------- CMS pages (policies, about) ---------- */
const pageSchema = new Schema(
  {
    slug: { type: String, required: true, lowercase: true, maxlength: 80 },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 60000 },
    isPublished: { type: Boolean, default: true },
    seo: { type: seoSchema, default: {} },
  },
  { timestamps: true },
);
pageSchema.index({ slug: 1 }, { unique: true });
export const Page = model('Page', pageSchema);

/* ---------- Journal posts ---------- */
const postSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 160 },
    slug: { type: String, required: true, lowercase: true, maxlength: 180 },
    excerpt: { type: String, default: '', maxlength: 400 },
    body: { type: String, default: '', maxlength: 60000 },
    cover: { type: imageSchema },
    author: { type: String, default: '', maxlength: 80 },
    tags: { type: [String], default: [] },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    demo: { type: Boolean, default: false },
    seo: { type: seoSchema, default: {} },
  },
  { timestamps: true },
);
postSchema.index({ slug: 1 }, { unique: true });
postSchema.index({ isPublished: 1, publishedAt: -1 });
export const Post = model('Post', postSchema);

/* ---------- FAQs ---------- */
const faqSchema = new Schema(
  {
    question: { type: String, required: true, maxlength: 300 },
    answer: { type: String, required: true, maxlength: 4000 },
    group: { type: String, default: 'General', maxlength: 60 },
    sortOrder: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true },
);
faqSchema.index({ isPublished: 1, group: 1, sortOrder: 1 });
export const Faq = model('Faq', faqSchema);

/* ---------- Gold-rate change history (audit trail) ---------- */
const goldRateLogSchema = new Schema(
  {
    rates: Object.fromEntries(PURITY_KEYS.map((k) => [k, Number])),
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: String,
    productsRepriced: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
goldRateLogSchema.index({ createdAt: -1 });
export const GoldRateLog = model('GoldRateLog', goldRateLogSchema);

/* ---------- Atomic counters (invoice numbers) ---------- */
const counterSchema = new Schema({ _id: { type: String, required: true }, seq: { type: Number, default: 0 } });
export const Counter = model('Counter', counterSchema);

export async function nextSequence(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
  return doc!.seq;
}
