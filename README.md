# Gold Shop — business website & online store

A complete website and online shop for an Indian gold jewellery business: an editorial storefront,
live gold-rate pricing, cart and checkout with Razorpay or cash on delivery, GST invoices, order
tracking, and a role-protected admin dashboard.

The store name, contact details and policies are set in **Admin → Settings**. The code ships with a
placeholder brand and an optional demo catalogue.

> **This repository holds the API only** (`server/`, `shared/`). The storefront and admin (`client/`)
> and the browser tests (`e2e/`) are kept and deployed separately: the API runs on Google Cloud Run
> and the storefront on Cloudflare Pages. See
> [docs/DEPLOY-CLOUDFLARE-CLOUDRUN.md](docs/DEPLOY-CLOUDFLARE-CLOUDRUN.md). Commands below that mention
> the storefront (`npm run dev`'s web half, `test:e2e`) need `client/` alongside.

## What's included

**Storefront**
- Home page: hero banners (arch-framed portrait or full-width lifestyle layout), promises strip,
  shop-by-category, collections, product rails, a "priced in the open" band with today's rates,
  story, gold savings plan, testimonials (only if you publish genuine ones), journal, and a final
  call to action.
- Shop: categories and sub-categories, collections, search with live suggestions, filters (purity,
  price, availability), sorting, pagination.
- Product page: zoomable gallery and full-screen lightbox, size/weight variants, live price
  breakdown (gold value + making − discount + stones + GST), stock status, delivery date by PIN code,
  wishlist, related and recently viewed pieces, WhatsApp enquiry, reviews from verified buyers,
  and a sticky mobile "Add to bag".
- Bag and checkout: guest or signed-in checkout, saved addresses, Indian mobile/PIN validation,
  PIN → shipping zone (with optional city/state lookup), coupons, transparent totals, Razorpay
  (UPI, cards, net banking) and optional cash on delivery.
- After purchase: order page with progress and courier tracking, retry payment, customer
  cancellation where allowed, printable invoice (a GST tax invoice once your GSTIN is set), and
  order tracking by order number + email/mobile.
- Accounts: register, sign in, password reset, order history, addresses, profile, wishlist that
  follows you from signed-out to signed-in.
- Business pages: Our story, Contact (enquiry form), FAQ, Journal, policy pages, Gold savings plan
  lead form, Today's gold rate with a calculator.

**Admin** (`/admin`): dashboard (sales, items needing attention, low stock, integration status),
orders (status workflow, shipment tracking, COD collection, Razorpay refunds, CSV export),
products (variants, images, live price preview), inventory (logged adjustments), categories and
collections, gold rates (re-prices the catalogue instantly), customers, coupons, reviews, enquiries,
homepage banners, pages and policies, journal, FAQs, testimonials, reports, settings (store,
checkout, shipping zones, tax, homepage), and staff roles.

**Under the hood**
- Every price, discount, shipping charge and stock check is computed on the server; the browser
  only sends product ids and quantities.
- Money is stored as integer paise and weights as integer milligrams.
- Stock is reserved atomically, so the last piece can never be sold twice. Unpaid online orders
  release their stock after 30 minutes, after first asking Razorpay whether a payment arrived.
- Razorpay payments are confirmed only after signature verification *and* a server-side check
  with Razorpay. Webhooks are signature-verified and de-duplicated by event id; confirmation side
  effects (coupon use, sold counts, invoice number, emails) run exactly once.
- httpOnly session cookies, bcrypt passwords, role-based permissions enforced on every admin API,
  an Origin check (CSRF), rate limits, Helmet security headers with a Content-Security-Policy,
  zod validation, centralised errors and structured logging.
- SEO: server-rendered titles, descriptions, canonical URLs, Open Graph tags and JSON-LD
  (Product, BreadcrumbList, Article, JewelryStore, WebSite search). Also a dynamic `sitemap.xml`,
  `robots.txt`, `noindex` on private pages, and real 404 status codes.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how pricing, orders and payments work,
and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to go live.

## Tech stack

| Part | Technology |
| --- | --- |
| Storefront & admin | React 19, TypeScript, Vite 7, Tailwind CSS 4, Framer Motion, TanStack Query, React Router 7, React Hook Form + zod, Radix Dialog |
| API | Node.js 20+, Express 5, Mongoose 8 (MongoDB 7/8), zod, pino, sharp, nodemailer |
| Shared | `@goldshop/shared`: validation schemas, Indian formats, constants, API types |
| Tests | Vitest + Supertest + mongodb-memory-server (API), Playwright (browser, desktop + mobile) |

```
shared/   validation schemas, money/INR and Indian phone/PIN helpers, API types
server/   Express API, MongoDB models, pricing/cart/order/payment services, seed scripts, tests
client/   storefront and admin (admin is lazy-loaded at /admin)
e2e/      Playwright browser tests
docs/     architecture and deployment guides
```

## Run it locally

Prerequisites: **Node.js 20.19+** and **MongoDB** (local install, Docker, or a free MongoDB Atlas cluster).

```bash
npm install
cp server/.env.example server/.env      # then set JWT_SECRET (see the file), ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed:demo                        # settings, policies, FAQs, guides + a demo catalogue
npm run dev                              # API on :4000, storefront on http://localhost:5173
```

Sign in at `http://localhost:5173/login` with the `ADMIN_EMAIL`/`ADMIN_PASSWORD` from your `.env`
(or create an admin with `npm run create-admin -- --email you@store.in`), then open `/admin`.

`npm run seed` (without `:demo`) sets up the store with no products. `npm run seed:clear-demo`
removes all demo products, collections, categories, banners and demo images before you launch.
Seeding never overwrites settings or content you have already edited.

To test on your phone, open `http://<your-computer's-LAN-IP>:5173` on the same Wi-Fi network.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (auto-restarts) and storefront (hot reload) together |
| `npm run build` | Production build of the storefront and the API |
| `npm start` | Runs the production build (API + storefront on one port) |
| `npm run typecheck` | TypeScript across shared, server and client |
| `npm run lint` | ESLint across the monorepo |
| `npm test` | API unit and integration tests (in-memory MongoDB) |
| `npm run test:e2e` | Browser tests against a fresh `gold_shop_e2e` database (needs MongoDB on localhost; run `npx playwright install chromium` once) |
| `npm run check` | typecheck + lint + tests + build |
| `npm run seed` / `seed:demo` / `seed:clear-demo` | See above |
| `npm run create-admin -- --email …` | Create or promote an admin account |

## Running the store day to day

1. **Every morning: update gold rates** in Admin → Gold rates. Every weight-based price updates
   immediately. The site only says "Today's gold rate" when the rate really was updated today.
2. **Process orders** in Admin → Orders: mark as being prepared, add the courier and tracking
   number, then mark shipped and delivered. Customers are emailed at each step (once SMTP is set up).
3. **Keep stock right** in Admin → Inventory. Every change is logged, and orders adjust stock
   automatically.
4. **Answer enquiries** (contact form, savings plan, product questions) in Admin → Enquiries.

## Before you launch — checklist

- [ ] **Store details** (Admin → Settings → Store): legal name, address with state, phone,
      WhatsApp, email, GSTIN, map link, social links. The order-number prefix is under Checkout.
- [ ] **Replace demo content**: run `npm run seed:clear-demo`, then add your own products and
      photos. Demo images are CC0 museum and stock photos, not your products. Any image you
      added for local preview from another company's website must be replaced or licensed
      before going public.
- [ ] **Policies** (Admin → Pages & policies): replace every `[bracketed]` placeholder and have them
      reviewed by your advisor.
- [ ] **Gold rates** set for every purity you sell.
- [ ] **Shipping zones and COD** (Admin → Settings → Shipping / Checkout).
- [ ] **Promises strip**: keep only claims you can stand behind (e.g. add "BIS hallmarked" only if
      every piece is). Leave "Figures" empty unless they're verified.
- [ ] **Razorpay**: live keys and webhook (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#razorpay)).
      Place a real low-value test order and refund it.
- [ ] **Email**: SMTP credentials, then check you receive order emails.
- [ ] **Backups** of MongoDB and the uploads folder.

## What is and isn't configured in this repository

| Integration | Status |
| --- | --- |
| Razorpay online payments | Implemented and covered by integration tests with a signed fake gateway. **Not tested against Razorpay's real sandbox** (no keys were available). Hidden at checkout until `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are set. |
| Cash on delivery | Implemented and tested end to end; enable it in Settings. |
| Order / password emails | Implemented via SMTP; logged and skipped until `SMTP_HOST` and `MAIL_FROM` are set. |
| SMS / WhatsApp notifications | Not implemented. Customers can reach you via WhatsApp links; automated messages need a WhatsApp Business API provider. |
| Abandoned-cart reminders | Not implemented (needs a consented messaging setup). Marketing consent is captured at checkout and sign-up for later use. |
| Courier integration | Manual: enter courier and tracking number per order. No automatic serviceability or label APIs. |
| PIN → city/state autofill | Optional (`PINCODE_LOOKUP=true`) via India Post's public API. |
| Live gold-rate feed | Not connected. Rates are entered by staff, with a full history. |
| GST | 3% by default (configurable). Invoices split CGST/SGST vs IGST by place of supply. Have your accountant confirm invoice format and numbering. |
