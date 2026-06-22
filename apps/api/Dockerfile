FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Prisma 在 alpine 上需要 openssl/libssl 才能正确选择并运行查询引擎
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api ./
COPY prisma ./prisma
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# 运行时同样需要 openssl 供 Prisma 查询引擎加载
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma-seed.js ./
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma 2>/dev/null || npx prisma db push --schema=./prisma/schema.prisma; npx prisma db seed 2>/dev/null; exec node dist/main.js"]
