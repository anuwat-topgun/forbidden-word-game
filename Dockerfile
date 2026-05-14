# ── Stage 1: install deps ──────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ──────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# copy only what's needed
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY werewolf.html ./
COPY manifest.json ./
COPY sw.js ./
COPY icon.png ./

EXPOSE 3000

CMD ["node", "server.js"]
