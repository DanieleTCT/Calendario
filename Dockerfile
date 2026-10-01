# ---- Stage 1: build frontend ----
FROM node:20-alpine AS web-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm install --workspace=@calendario/web 2>/dev/null || npm install
COPY apps/web ./apps/web
WORKDIR /build/apps/web
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---- Stage 2: build API (esbuild bundle, niente tsc) ----
FROM node:20-alpine AS api-build
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/domain/package.json ./packages/domain/
COPY packages/storage/package.json ./packages/storage/
COPY packages/agent/package.json ./packages/agent/
COPY scripts ./scripts
RUN npm install
COPY tsconfig.json ./
COPY apps/api/src ./apps/api/src
COPY packages ./packages
WORKDIR /build
# SKIP_VERCEL=1: su NAS/Docker il bundle serverless è inutile (risparmia build)
RUN SKIP_VERCEL=1 node scripts/build-api.mjs

# ---- Stage 3: runtime (single-container NAS) ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=api-build /build/package.json /app/package.json
COPY --from=api-build /build/package-lock.json /app/package-lock.json
COPY --from=api-build /build/apps/api/package.json ./package.json
COPY --from=api-build /build/apps/api/dist ./dist
COPY --from=api-build /build/node_modules /app/node_modules
# Symlink workspace necessari a runtime (uuid, express... risolti da /app/node_modules)
# Frontend statico servito da Express (cerca ../web-dist)
COPY --from=web-build /build/apps/web/dist ../web-dist
# Volume dati: data.json + backup + conversazioni
VOLUME ["/app/data"]
ENV PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.js"]


