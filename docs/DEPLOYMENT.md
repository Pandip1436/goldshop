# Deploying to production

The production app is **one Node.js process**. It serves the API, the built storefront and admin,
uploaded images, `sitemap.xml` and `robots.txt`, with server-rendered SEO tags. It needs MongoDB and
a persistent folder for uploaded images.

## 1. Requirements

- Node.js 20.19+ (or Docker)
- MongoDB 7 or 8. MongoDB Atlas (any tier, including free) works well. A replica set is **not**
  required: stock reservation uses atomic single-document updates, so a standalone server works too.
- A domain with HTTPS. Put a reverse proxy (Caddy, Nginx, or your host's load balancer) in front.
- Persistent disk for `server/uploads` (product photos). On hosts with ephemeral disks, mount a
  volume. Back this folder up alongside the database.

## 2. Environment variables

Copy `server/.env.example` and fill it in. The essentials:

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | Enables secure cookies, HSTS and production logging. |
| `PUBLIC_URL` | **Required.** The public address, e.g. `https://www.iniyajewellers.in`. Used for canonical URLs, the sitemap, email links and the CSRF origin check. |
| `JWT_SECRET` | **Required.** At least 32 random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing it signs everyone out. |
| `MONGODB_URI` | e.g. `mongodb+srv://user:pass@cluster.mongodb.net/gold_shop` |
| `TRUST_PROXY` | Number of proxies in front of the app (default `1` in production) so client IPs and rate limits are correct. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | See [Razorpay](#razorpay). Online payment stays hidden until the key pair is set. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Any SMTP provider (Amazon SES, Zoho, Google Workspace, Brevo…). Use an address on your own domain with SPF/DKIM set up. |
| `ORDER_NOTIFY_EMAIL` | Where new-order and enquiry alerts go (defaults to the store email in settings). |
| `PINCODE_LOOKUP=true` | Optional city/state autofill from India Post's public API. |
| `ORDER_RESERVATION_MINUTES` | How long an unpaid online order holds stock (default 30). |

Secrets live only in the environment, never in the database or the admin.

## 3. Option A — Node directly

```bash
npm ci
npm run build
NODE_ENV=production node server/dist/index.js        # or use pm2 / systemd
```

First-time setup (same environment variables):

```bash
node server/dist/seed.js                               # settings, policy templates, FAQs, guides
node server/dist/create-admin.js --email you@yourstore.in   # prompts for a password
```

Example `systemd` unit:

```ini
[Service]
WorkingDirectory=/srv/gold-shop
EnvironmentFile=/srv/gold-shop/server/.env
ExecStart=/usr/bin/node server/dist/index.js
Restart=always
User=goldshop
```

## 4. Option B — Docker

> The `Dockerfile` and `docker-compose.yml` were written for this project but **have not been
> built in the development environment** (Docker wasn't running there). Build and smoke-test them
> once before relying on them.

```bash
cp server/.env.example .env          # fill in PUBLIC_URL, JWT_SECRET, Razorpay, SMTP
docker compose up -d --build
docker compose exec app node server/dist/seed.js
docker compose exec app node server/dist/create-admin.js --email you@yourstore.in
```

The compose file includes MongoDB with a persistent volume. To use Atlas instead, delete the
`mongo` service and set `MONGODB_URI` in `.env`.

### Option C — Cloudflare Pages + Google Cloud Run

The storefront is served from Cloudflare Pages, and a Pages function forwards the API, uploads, sitemap and
SEO tags to the API on Cloud Run, so everything stays on one domain. Photos go in a Cloud Storage bucket,
and Cloud Scheduler runs the background jobs. Step by step:
[DEPLOY-CLOUDFLARE-CLOUDRUN.md](DEPLOY-CLOUDFLARE-CLOUDRUN.md).

## 5. Reverse proxy (HTTPS)

Caddy (automatic certificates):

```
www.iniyajewellers.in {
  reverse_proxy 127.0.0.1:4000
  request_body {
    max_size 60MB
  }
}
```

Nginx: proxy to `127.0.0.1:4000`, set `client_max_body_size 60m;` (for multi-image uploads) and
pass `X-Forwarded-For` / `X-Forwarded-Proto`.

## 6. Razorpay

1. Create a Razorpay account and complete KYC.
2. **Test first.** In *Test mode*, go to Account & Settings → API Keys, generate keys
   (`rzp_test_…`), and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. Webhooks: Account & Settings → Webhooks → *Add new webhook*:
   - URL: `https://YOUR_DOMAIN/api/payments/razorpay/webhook`
   - Secret: a long random string, also set as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`
4. Restart the app. Admin → Settings → Checkout & payments should show Razorpay and the webhook
   as configured (with "test keys").
5. Place a test order using Razorpay's test cards or UPI test IDs. Confirm the order moves to
   *Confirmed*. Then try closing the payment window and paying from the order page with
   *Complete payment*, and issue a refund from the admin.
6. Switch to **live keys** (`rzp_live_…`) and create the live-mode webhook the same way.

How payments are protected:

- The amount is fixed server-side when the Razorpay order is created.
- After Checkout, the browser's signed response is verified (HMAC-SHA256), *and* the payment is
  fetched from Razorpay and checked for status, order and amount before the order is marked paid.
- Webhooks are verified against the raw request body and de-duplicated by `x-razorpay-event-id`.
  Duplicate or concurrent deliveries are harmless.
- If a payment arrives after the stock reservation lapsed, the order is reinstated when stock
  allows. Otherwise it's flagged *Payment under review* for a manual refund.
- Card, UPI and bank details never touch your server.

## 7. Email

Set the SMTP variables and restart. Admin → Settings shows "Order emails: Configured". Customers
receive order confirmations, shipping/delivery/cancellation updates and password-reset links. The
store gets new-order and enquiry alerts.

## 8. Operations

- **Health check:** `GET /api/health` (returns 503 if the database is unreachable).
- **Background jobs** run inside the app every 5 minutes: expire unpaid reservations (after
  checking Razorpay) and retry any unfinished post-order steps. They are idempotent, so running
  several instances is safe.
- **Scaling to several instances:** fine for orders and payments (all state is in MongoDB). Two
  things are per-instance: the 15–60 second read cache (so a change may take up to a minute to show
  on other instances) and rate-limit counters. Uploads must live on shared storage (a shared volume),
  or switch the upload service to object storage.
- **Backups:** daily MongoDB backups (Atlas does this) plus the `uploads` folder.
- **Logs:** JSON to stdout (pino). Cookies, passwords and signatures are redacted.
- **Indexes** are created automatically on start-up.

## 9. Search engines

- `https://YOUR_DOMAIN/sitemap.xml` lists the home page, categories, collections, products,
  journal and policy pages. Submit it in Google Search Console.
- Product pages carry Product structured data (price in INR, availability). Prices follow the
  gold rate, so keep rates current.
- Private pages (cart, checkout, account, orders, admin) are `noindex` and blocked in `robots.txt`.
