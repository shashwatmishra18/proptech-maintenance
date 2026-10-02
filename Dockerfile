FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Secrets are injected at runtime, never at build time.
ENV NEXT_TELEMETRY_DISABLED=1

# Generate prisma client
RUN npx prisma generate

RUN npm run build
RUN node node_modules/typescript/bin/tsc --project tsconfig.ops.json

# Portable operator image; Railway also needs compiled tools in its app image.
FROM builder AS ops
ENTRYPOINT []
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Set correct permission for prerender cache and uploads
RUN mkdir -p public/uploads storage/uploads && chown nextjs:nodejs public/uploads storage/uploads

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts/production-config.cjs /app/scripts/production-start.cjs /app/scripts/railway-environment.cjs /app/scripts/railway-gateway.cjs /app/scripts/railway-start.cjs /app/scripts/migrate-deploy.cjs /app/scripts/bootstrap-manager.cjs ./scripts/
COPY --from=builder /app/dist-ops ./dist-ops
COPY --from=builder /app/node_modules/zod ./node_modules/zod
# Railway pre-deploy commands run in the application image without its volume.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version
COPY --from=builder /app/node_modules/@prisma/debug ./node_modules/@prisma/debug
COPY --from=builder /app/node_modules/@prisma/fetch-engine ./node_modules/@prisma/fetch-engine
COPY --from=builder /app/node_modules/@prisma/get-platform ./node_modules/@prisma/get-platform
RUN mkdir -p node_modules/.bin && ln -sf ../prisma/build/index.js node_modules/.bin/prisma
RUN chown -R nextjs:nodejs public/uploads storage .next

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "scripts/production-start.cjs"]
