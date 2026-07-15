# ── Stage 1: install deps ──
FROM node:20-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build ──
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars — overridden at runtime via docker-compose/k8s
ENV NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_WS_URL=http://localhost:3001
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3: production runner ──
FROM node:20-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# Next.js standalone output includes only what's needed to run
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# public/ may not exist yet — create empty dir so Next.js doesn't complain
RUN mkdir -p public

USER app

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
