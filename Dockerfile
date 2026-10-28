# syntax=docker/dockerfile:1

# ---- build: install everything, compile the API (and the storefront when client/ is present) ----
# The API-only repository has no client/; the storefront is then deployed separately (Cloudflare Pages)
# and the image serves just the API.
FROM node:22-slim AS build
WORKDIR /app
# The test-only MongoDB download isn't needed to build.
ENV MONGOMS_DISABLE_POSTINSTALL=1
COPY . .
RUN npm ci
RUN npm run build && mkdir -p client/dist server/uploads

# ---- runtime: server dependencies only ----
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/seed-assets server/seed-assets
# empty in the API-only repository; the server then serves only the API
COPY --from=build /app/client/dist client/dist
# The store's photos from the repository. Hosts without a persistent disk (Render's free plan) serve
# these; photos uploaded there later are lost on the next restart or deploy. A Render Disk or Cloud
# Storage bucket mounted at this path replaces them, so copy the photos onto it once.
COPY --from=build --chown=node:node /app/server/uploads server/uploads
USER node
EXPOSE 4000
VOLUME ["/app/server/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
