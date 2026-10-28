import { Router } from 'express';
import { enquirySchema, type FaqDTO, type PageDTO, type PostDTO } from '@goldshop/shared';
import { cached } from '../lib/cache';
import { notFound } from '../lib/errors';
import { paginated, pagination, parse } from '../lib/http';
import { logger } from '../lib/logger';
import { formLimiter } from '../middleware/security';
import { Enquiry, Faq, Page, Post, Product } from '../models';
import { notifyEnquiry } from '../services/notifications';
import { toPostSummary } from './catalog';

export const contentRouter = Router();

contentRouter.get('/pages/:slug', async (req, res) => {
  const page = await Page.findOne({ slug: String(req.params.slug).toLowerCase(), isPublished: true }).lean();
  if (!page) throw notFound('Page not found.');
  res.json({ slug: page.slug, title: page.title, body: page.body, updatedAt: page.updatedAt.toISOString(), seo: page.seo } satisfies PageDTO & { seo?: unknown });
});

contentRouter.get('/posts', async (req, res) => {
  const { page, limit, skip } = pagination(req, 24, 9);
  const filter = { isPublished: true };
  const [items, total] = await Promise.all([
    Post.find(filter).sort({ publishedAt: -1 }).skip(skip).limit(limit).lean(),
    Post.countDocuments(filter),
  ]);
  res.json(paginated(items.map(toPostSummary), total, page, limit));
});

contentRouter.get('/posts/:slug', async (req, res) => {
  const post = await Post.findOne({ slug: String(req.params.slug).toLowerCase(), isPublished: true }).lean();
  if (!post) throw notFound('Article not found.');
  const dto: PostDTO = { ...toPostSummary(post), body: post.body, author: post.author || undefined };
  res.json({ ...dto, seo: post.seo });
});

contentRouter.get('/faqs', async (_req, res) => {
  const faqs = await cached('public:faqs', 60_000, () => Faq.find({ isPublished: true }).sort({ group: 1, sortOrder: 1 }).lean());
  res.json(faqs.map((f): FaqDTO => ({ id: String(f._id), question: f.question, answer: f.answer, group: f.group })));
});

contentRouter.post('/enquiries', formLimiter, async (req, res) => {
  const input = parse(enquirySchema, req.body);
  // Bots fill the hidden field; pretend success so they don't adapt.
  if (input.website) return void res.status(201).json({ ok: true });

  if (input.type === 'newsletter') {
    await Enquiry.updateOne(
      { type: 'newsletter', email: input.email },
      { $setOnInsert: { type: 'newsletter', email: input.email, consent: true, ip: req.ip ?? '' } },
      { upsert: true },
    );
    return void res.status(201).json({ ok: true, message: "You're on the list. We'll only write when there's something worth sharing." });
  }

  const product = input.productId && /^[a-f0-9]{24}$/i.test(input.productId)
    ? await Product.findById(input.productId).select('_id name').lean()
    : null;
  const enquiry = await Enquiry.create({
    type: input.type,
    name: input.name,
    email: input.email,
    phone: input.phone,
    message: product ? `[${product.name}] ${input.message}` : input.message,
    product: product?._id,
    preferredContact: input.preferredContact,
    topic: input.topic,
    monthlyAmount: input.monthlyAmount,
    consent: input.consent,
    ip: req.ip ?? '',
  });
  // Awaited: hosts like Cloud Run pause the CPU once the response is sent, which would stall the email.
  await notifyEnquiry(enquiry).catch((err) => logger.warn({ err }, 'enquiry notification failed'));
  const how = { phone: "We'll call you", whatsapp: "We'll message you on WhatsApp", email: "We'll email you" }[input.preferredContact ?? 'phone'];
  res.status(201).json({
    ok: true,
    message:
      input.type === 'savings_plan'
        ? `Thank you — we've received your request. ${how} to explain the plan.`
        : "Thank you — we've received your message and will get back to you soon.",
  });
});
