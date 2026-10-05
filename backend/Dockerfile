FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

USER node
EXPOSE 4000
# Runs pending migrations (and the idempotent seed if SEED_ON_START=true) before listening.
CMD ["node", "src/server.js"]
