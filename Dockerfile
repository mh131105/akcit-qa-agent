FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data \
    PI_CODING_AGENT_DIR=/data/pi DISPLAY=:99 CHROMIUM_PATH=/usr/bin/chromium \
    PATH=/app/node_modules/.bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb xauth xdotool ffmpeg poppler-utils python3 git ca-certificates \
    fonts-liberation fonts-noto-color-emoji tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/dist ./dist
COPY package*.json ./
COPY scripts ./scripts
COPY agents ./agents
RUN npm prune --omit=dev && mkdir -p /data && chown node:node /data
ARG VCS_REF=local
ARG VCS_TREE=local
LABEL org.opencontainers.image.source="https://github.com/mh131105/akcit-qa-agent" \
      org.opencontainers.image.revision=$VCS_REF \
      io.akcit.git-tree=$VCS_TREE
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "scripts/entrypoint.sh"]
CMD ["node", "dist/server.js"]

FROM dependencies AS development
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb xauth xdotool ffmpeg poppler-utils python3 git ca-certificates \
    fonts-liberation fonts-noto-color-emoji tini \
    && rm -rf /var/lib/apt/lists/*
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PI_CODING_AGENT_DIR=/data/pi \
    DISPLAY=:99 CHROMIUM_PATH=/usr/bin/chromium PATH=/app/node_modules/.bin:$PATH
COPY scripts ./scripts
COPY agents ./agents
COPY test ./test
RUN mkdir -p /data && chown node:node /data && chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "scripts/entrypoint.sh"]
CMD ["npm", "run", "dev"]
