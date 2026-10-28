# Deploying: Cloudflare Pages (storefront) + Google Cloud Run (API)

```
Browser ──► Cloudflare Pages  (https://vijay-jewellers.pages.dev, later your own domain)
              ├─ /assets/*, icons ............. static files, straight from Pages
              ├─ pages (/, /product/…, …) ..... index.html + that page's SEO tags, fetched from the API
              └─ /api/*, /uploads/*, /sitemap.xml, /robots.txt ──► Cloud Run (Express API)
                                                                     ├─ MongoDB Atlas
                                                                     └─ Cloud Storage bucket (photos)
Cloud Scheduler ── every 5 min ──► Cloud Run  POST /api/internal/jobs
```

Everything the browser sees is on **one domain**: the Pages function (`client/functions/[[path]].ts`) forwards
the dynamic paths to Cloud Run. That's why sign-in cookies, the CSRF origin check, the security headers and
WhatsApp/Google previews work as they do on a single server. Don't point the browser at the `run.app`
address directly. The API refuses any request that doesn't carry `PROXY_SECRET`.

Names used below (change them if you like): Google Cloud project `PROJECT_ID`, region `asia-south1`
(Mumbai), Cloud Run service `vijay-jewellers-api`, bucket `vijay-jewellers-uploads` (bucket names are
global, so add a suffix if it's taken), Pages project `vijay-jewellers`.

Commands are for **PowerShell** on Windows (a backtick `` ` `` continues a line; in bash use `\`).
Use `curl.exe`, not `curl`.

## 1. Secrets to prepare

Generate two random values (run the command twice):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Name | Value |
| --- | --- |
| `proxy-secret` | random value #1. It goes to Cloud Run **and** to Pages. |
| `cron-secret` | random value #2. It goes to Cloud Run **and** to the Cloud Scheduler job. |
| `jwt-secret` | 48+ random characters (`randomBytes(48)` in the command above). Changing it later signs everyone out. |
| `mongodb-uri` | The Atlas connection string, ending in the database name: `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/jewellers` |

**MongoDB Atlas → Network Access:** Cloud Run has no fixed outgoing IP, so allow `0.0.0.0/0`.
Because the cluster also holds other projects' databases, create a **separate database user** for the
store, with `readWrite` on `jewellers` only, and use it in `mongodb-uri`.

## 2. Google Cloud: one-time setup

Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install), then:

```powershell
gcloud auth login
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com
```

**Secrets:** Console → Security → **Secret Manager** → *Create secret*. Create the four secrets from step 1
(`proxy-secret`, `cron-secret`, `jwt-secret`, `mongodb-uri`) and paste each value. Use the console for
this. Piping a value from PowerShell adds a line break to the secret.

**Bucket for photos.** Copy the existing photos into it. The database refers to them by these paths.

```powershell
gcloud storage buckets create gs://vijay-jewellers-uploads --location=asia-south1 --uniform-bucket-level-access
gcloud storage cp -r "server/uploads/*" gs://vijay-jewellers-uploads/
```

**Permissions** for the service account that Cloud Run and Cloud Build use:

```powershell
$PROJECT_NUMBER = gcloud projects describe PROJECT_ID --format="value(projectNumber)"
$SA = "serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding PROJECT_ID --member=$SA --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding PROJECT_ID --member=$SA --role=roles/run.builder
gcloud storage buckets add-iam-policy-binding gs://vijay-jewellers-uploads --member=$SA --role=roles/storage.objectUser
```

## 3. Deploy the API to Cloud Run

From the repository root. Cloud Build builds the `Dockerfile`, so you don't need Docker locally.
`PUBLIC_URL` must be the address customers will use: the Pages address now, your domain later (step 6).

```powershell
gcloud run deploy vijay-jewellers-api `
  --source . `
  --region asia-south1 `
  --allow-unauthenticated `
  --memory 1Gi --cpu 1 --cpu-boost `
  --min-instances 0 --max-instances 3 `
  --execution-environment gen2 `
  --add-volume "name=uploads,type=cloud-storage,bucket=vijay-jewellers-uploads,mount-options=uid=1000;gid=1000" `
  --add-volume-mount "volume=uploads,mount-path=/app/server/uploads" `
  --set-env-vars "NODE_ENV=production,TRUST_PROXY=1,PUBLIC_URL=https://vijay-jewellers.pages.dev" `
  --set-secrets "MONGODB_URI=mongodb-uri:latest,JWT_SECRET=jwt-secret:latest,PROXY_SECRET=proxy-secret:latest,CRON_SECRET=cron-secret:latest"
```

`--allow-unauthenticated` is required because Cloudflare must be able to reach the service. `PROXY_SECRET`
keeps everyone else out. The bucket is mounted where the app keeps uploads, with `uid=1000` so the app's
`node` user can write to it.

Note the service URL it prints (`https://vijay-jewellers-api-…a.run.app`), then check:

```powershell
curl.exe https://SERVICE_URL/api/health          # {"ok":true,"db":"connected"}
curl.exe -i https://SERVICE_URL/api/settings     # 403: only the storefront may call it
```

A 503 from the health check means the API can't reach MongoDB. Check Atlas Network Access and `mongodb-uri`.

## 4. Background jobs (Cloud Scheduler)

By default, Cloud Run only gives the app CPU while it is handling a request. The jobs that release stock held
by unpaid orders, and retry unfinished order emails, therefore need a scheduler to trigger them. The ping
every 5 minutes also keeps an instance warm, so fewer customers wait for a cold start.

```powershell
gcloud scheduler jobs create http vijay-jewellers-jobs `
  --location asia-south1 `
  --schedule "*/5 * * * *" `
  --uri "https://SERVICE_URL/api/internal/jobs" `
  --http-method POST `
  --headers "x-cron-secret=CRON_SECRET_VALUE"

gcloud scheduler jobs run vijay-jewellers-jobs --location asia-south1   # try it now
```

## 5. Deploy the storefront to Cloudflare Pages

```powershell
npm run build -w client
cd client
npx wrangler login
npx wrangler pages project create vijay-jewellers --production-branch main
npx wrangler pages secret put API_ORIGIN --project-name vijay-jewellers      # paste https://SERVICE_URL
npx wrangler pages secret put PROXY_SECRET --project-name vijay-jewellers    # paste the proxy-secret value
npx wrangler pages deploy dist --project-name vijay-jewellers --branch main
cd ..
```

Run `wrangler pages deploy` from `client/` so that `client/functions/` is deployed with the site.
`client/public/_routes.json` keeps `/assets/*` and the icons off the function. Variables only apply to
deployments made after they are set, so if you change one, deploy again.

Open `https://vijay-jewellers.pages.dev` and check that the home page shows products, a product page shows
photos, and you can sign in and open `/admin`. Admin accounts were copied to Atlas with the rest of the data.
To add one, run `npm run create-admin -- --email you@store.in` locally with `MONGODB_URI` set to the Atlas URI.

## 6. Your own domain

1. Pages → `vijay-jewellers` → **Custom domains** → add `www.yourdomain.in`. This is easiest when the
   domain's DNS is on Cloudflare.
2. Point the API at it. `PUBLIC_URL` is used for canonical links, the sitemap, email links and the CSRF check:
   ```powershell
   gcloud run services update vijay-jewellers-api --region asia-south1 --update-env-vars PUBLIC_URL=https://www.yourdomain.in
   ```
3. Razorpay webhook URL: `https://www.yourdomain.in/api/payments/razorpay/webhook` (see DEPLOYMENT.md §6).

Photos are kept in Cloudflare's cache after the first view. This may only take effect on your own domain.

## 7. Razorpay, email and other settings

Add them to the running service. Put secret values in Secret Manager first.

```powershell
gcloud run services update vijay-jewellers-api --region asia-south1 `
  --update-env-vars "RAZORPAY_KEY_ID=rzp_test_xxx,SMTP_HOST=smtp.example.com,SMTP_PORT=587,MAIL_FROM=Vijay Jewellers <orders@yourdomain.in>" `
  --update-secrets "RAZORPAY_KEY_SECRET=razorpay-key-secret:latest,RAZORPAY_WEBHOOK_SECRET=razorpay-webhook-secret:latest,SMTP_USER=smtp-user:latest,SMTP_PASS=smtp-pass:latest"
```

The full list of variables is in `server/.env.example` and [DEPLOYMENT.md](DEPLOYMENT.md#2-environment-variables).

## 8. Updating the site

| Changed | Run |
| --- | --- |
| Server code | `gcloud run deploy vijay-jewellers-api --source . --region asia-south1` (keeps all settings above) |
| Storefront / admin | `npm run build -w client`, then from `client/`: `npx wrangler pages deploy dist --project-name vijay-jewellers --branch main` |
| Both | API first, then the storefront |

## 9. Limits and costs to know

- **Cloudflare Pages Functions (free plan): 100,000 requests a day.** Every page view, API call and
  uncached photo counts; `/assets` files don't. Past the limit, the dynamic part of the site stops working
  until the next day. The Workers Paid plan ($5/month) raises it to 10 million a month.
- **Cloud Run:** with `--min-instances 0`, you pay only while requests are being handled, and a small shop
  usually stays in the free tier. Upload requests are limited to 32 MB, so the admin uploads one photo per
  request (10 MB max each).
- **Several instances** (up to `--max-instances`): orders and payments are safe. The 15–60 second read
  cache and rate-limit counters are per instance (see DEPLOYMENT.md §8).
- **Backups:** Atlas backs up the database. Back up the bucket too, e.g. turn on Object Versioning, or
  run `gcloud storage cp -r gs://vijay-jewellers-uploads ./backup` from time to time.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every page or API call: 403 "Requests must come through the storefront" | `PROXY_SECRET` differs between Pages and Cloud Run, or Pages wasn't redeployed after setting it. |
| Saving or signing in: 403 "Request origin not allowed" | The address in the browser isn't `PUBLIC_URL`, e.g. a preview deployment (`abc123.vijay-jewellers.pages.dev`). Add it to `EXTRA_ORIGINS` on Cloud Run, or use the main address. |
| Photos missing | Photos weren't copied to the bucket, or the service account lacks `storage.objectUser`. |
| Health check 503 | Atlas Network Access, or a wrong `mongodb-uri`. |
| Unpaid orders keep holding stock | The Cloud Scheduler job isn't running, or `cron-secret` differs (check its last run in the console). |
