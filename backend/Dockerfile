# ── Stage 1: install all deps & build ──
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production deps only ──
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

# ── Stage 3: final slim image ──
FROM node:20-alpine

WORKDIR /app

# Non-root user for security
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/prisma ./prisma
COPY package.json ./

USER app

EXPOSE 3001

CMD ["node", "dist/src/main.js"]
