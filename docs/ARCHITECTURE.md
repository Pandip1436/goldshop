# How it works

## Units

- **Money:** integer **paise** everywhere (₹1 = 100). Formatted as INR with lakh/crore grouping only
  at display time.
- **Weight:** integer **milligrams**. 4.25 g is stored as `4250`.

## Pricing (`server/src/services/pricing.ts`)

**Weight-priced pieces** (most gold jewellery):

```
metal value     = net weight (g) × rate per gram for the piece's purity
making          = % of metal value  |  ₹ per gram × weight  |  flat ₹
making discount = making × product's making-discount %
stones          = stone / diamond charges for the variant
taxable         = metal value + making − making discount + stones
GST             = taxable × GST rate (3% by default)
price           = taxable + GST
```

Each component is rounded to the rupee, so the breakdown on the product page always adds up to
the price shown.

**Fixed-price pieces** store a GST-inclusive price; the tax component is derived from it.

A piece whose purity has no rate set is "price on request" and can't be added to the bag.

**Gold rates** are entered by staff (Admin → Gold rates). Saving re-prices every weight-based
product in bounded batches and stores a history entry. Changes over 25% need confirmation, which
catches per-10-gram figures entered as per-gram. Each product keeps a denormalised `minPrice` /
`inStock`, so listing filters and price sorting stay indexed.

**Order totals:** subtotal − coupon + shipping + COD fee. Invoices back-calculate taxable value and
GST from the GST-inclusive total, split into CGST+SGST (same state as the store) or IGST
(different state).

## Cart (`services/cart.ts`)

Carts live on the server: keyed by user, or by a random token in an httpOnly cookie for guests
(guest carts expire after 30 days). On sign-in the guest cart merges into the account cart.

Every read re-prices every line from the database. It caps quantities to stock, marks unavailable
lines, tells the shopper when the gold rate changed a price ("Price increased from ₹…"), evaluates
the coupon, and quotes shipping for the PIN code. The browser never sends a price.

## Placing an order (`services/orders.ts`)

1. Re-evaluate the cart with fresh settings. Refuse if anything changed (`cart_changed`), if the
   coupon became invalid, if the destination isn't serviceable, or if the payment method isn't
   allowed (COD zone and limit).
2. The checkout form sends the total the shopper saw (`expectedTotal`). If the server's total
   differs (e.g. the gold rate changed meanwhile), the order is refused with `total_changed` and the
   new figures, so a price is never silently changed.
3. **Reserve stock** with one atomic conditional update per line:
   `stock >= qty ⇒ stock -= qty`. If any line fails, earlier lines are put back. This works on
   standalone MongoDB (no transactions needed) and makes overselling impossible.
4. Create the order with a snapshot of item prices and breakdowns, gold rates, seller details
   (for the invoice), GST split and an access token (stored hashed) for guest viewing.
5. **COD:** confirm immediately. **Online:** create a Razorpay order for the exact total; the order
   waits in *Awaiting payment* with a reservation expiry (30 min). If Razorpay can't be reached,
   the order is cancelled and stock returned.

## Payment confirmation

Three paths can confirm a payment: the browser's verify call, the webhook, and the expiry
sweeper's reconciliation. All of them call `recordCapturedPayment`:

- `Payment` documents are keyed by Razorpay payment id (unique index).
- If the amount doesn't match the order total, the order moves to *Payment under review*.
- `payment.status: pending → paid` is a single conditional update, so only one caller proceeds.
- That caller moves the order to *Confirmed* (or reinstates a lapsed one) and runs the
  **confirmation effects**: coupon redemption, sold counts, customer stats, invoice number
  (sequential per Indian financial year, e.g. `PN/2026-27/00001`), cart clean-up, and emails.
  Each effect is guarded by its own flag. A sweeper retries any order whose effects didn't finish.

Webhook events are stored by `x-razorpay-event-id` (unique). A repeat delivery is acknowledged
and ignored; a previously failed event is re-claimed and retried.

## Order lifecycle

```
pending_payment ─┬─► confirmed ─► processing ─► shipped ─► out_for_delivery ─► delivered ─► returned
                 │        │            │            └──────────────────────────► returned
                 │        └────────────┴──► cancelled (stock returned)
                 ├─► cancelled (unpaid, expired or cancelled by the customer)
payment_review ──┴─► confirmed | cancelled
```

Allowed manual moves are listed in `ORDER_TRANSITIONS` (`shared/src/constants.ts`) and enforced by
the server. Stock release is idempotent (`stockReleased` flag). Delivering a COD order records the
cash as paid.

## Security

- **Sessions:** JWT in an httpOnly, SameSite=Lax cookie (Secure in production). Each request
  re-checks the user's role, active flag and `tokenVersion`, so a password change or role change
  takes effect immediately everywhere.
- **Authorisation:** every `/api/admin` route requires a staff or admin session, plus a specific
  permission from `PERMISSIONS` (`server/src/middleware/auth.ts`). Staff can't change settings,
  coupons, refunds, reports or staff. The admin UI hides what a role can't use, but the server is
  what enforces it.
- **CSRF:** state-changing requests from an unknown `Origin` are rejected, on top of SameSite cookies.
- **Validation:** zod schemas (shared with the client) on every input. Errors come back as
  per-field messages.
- **Rate limits:** general API, sign-in, checkout, forms and lookups.
- **Headers:** Helmet with a Content-Security-Policy that allows only this site and Razorpay
  Checkout.
- **Uploads:** decoded and re-encoded by sharp (no SVG, no trust in file names or MIME types),
  metadata (including GPS) stripped, stored under random names.
- **Admin-authored Markdown** is sanitised (DOMPurify) before rendering.
- **CSV exports** neutralise spreadsheet formulas.
- Passwords use bcrypt (cost 12). Reset tokens are random, stored hashed, single use and expire
  after 30 minutes. Responses never reveal whether an email has an account.

## SEO

The storefront is a client-rendered React app, and the server adds the important parts for crawlers:
for each URL it renders the title, description, canonical, Open Graph tags and JSON-LD (Product
with INR offer and availability, BreadcrumbList, Article, JewelryStore, WebSite search). It returns
404 for unknown products and pages, and marks private pages `noindex`. Once the app loads, it
replaces those tags with its own. `sitemap.xml` is generated from the database and cached for an
hour.

## Honest content rules built in

- *Bestsellers* appear only when products have real sales.
- *Testimonials* and *figures* sections stay hidden until staff publish genuine ones.
- Reviews can only be written by customers whose order of that piece was delivered, and they're
  moderated before publishing.
- "Only N left" shows only when stock genuinely is that low.
- "Today's gold rate" is shown only when the rate was updated today. Otherwise the site shows
  when it was last updated.
- "Was" prices exist only for fixed-price items, and only if staff enter one.
