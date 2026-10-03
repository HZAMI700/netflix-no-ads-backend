# ---- builder: compile TypeScript ----
FROM node:20-slim AS builder
# Build tools are only needed if a dependency ships native code.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

# ---- runtime: minimal image + system ffmpeg ----
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 4000
VOLUME ["/data/torrents"]
CMD ["node", "dist/index.js"]
