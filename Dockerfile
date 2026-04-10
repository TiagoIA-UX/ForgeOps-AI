FROM node:20-alpine AS base

# Instala dependências apenas quando necessário
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
# Placeholders para o prerender — valores reais vêm do runtime
ARG NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
