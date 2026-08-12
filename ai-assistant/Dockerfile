FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Railway injects PORT; default 8000 for local/docker-compose.
ENV PORT=8000
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 8000
CMD ["node", "dist/index.js"]
