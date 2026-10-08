# naka-ai (apps/landing) on Node + PostgreSQL — docs/adr/0004. Built by the root docker-compose.yml.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8788 MEDIA_DIR=/data/media

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY server ./server
COPY migrations/pg ./migrations/pg
COPY public ./public

RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8788)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# migrations/pg run at start (DB_MIGRATE=0 to skip); SIGTERM waits for background work
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/node.ts"]
