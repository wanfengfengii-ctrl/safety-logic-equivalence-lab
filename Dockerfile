# syntax=docker/dockerfile:1

# ---------- 阶段 1：构建纯前端静态产物 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# 优先利用层缓存安装依赖
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts playwright.config.ts index.html ./
COPY e2e ./e2e
COPY src ./src
RUN npm run build

# ---------- 阶段 2：验收镜像（vitest + playwright chromium） ----------
FROM node:22-bookworm-slim AS verify
# Playwright 运行 Chromium 所需的少量系统库
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxi6 \
    libgbm1 libdrm2 libxkbcommon0 libasound2 libdbus-1-3 \
    libwayland-server0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# 下载 Chromium 到镜像内（系统库已在上方显式安装）
RUN npx playwright install chromium
COPY tsconfig.json vite.config.ts playwright.config.ts index.html ./
COPY e2e ./e2e
COPY src ./src
COPY --from=build /app/dist ./dist
COPY docker/verify-entrypoint.sh /usr/local/bin/verify-entrypoint.sh
RUN chmod +x /usr/local/bin/verify-entrypoint.sh
# 一次性验收服务：vitest → build 校验 → playwright（BASE_URL 指向 web 容器）
# 由 docker-compose 以 depends_on 保证 web 已启动
ENTRYPOINT ["/usr/local/bin/verify-entrypoint.sh"]

# ---------- 阶段 3：静态站点 ----------
FROM nginx:1.27-alpine AS web
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
