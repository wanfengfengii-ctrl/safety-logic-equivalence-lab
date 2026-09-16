#!/bin/sh
# 一次性验收服务：单元测试 → 类型/构建复算 → 端到端验收。
# 任何一步失败即以非零码退出（docker compose run verify 可复现）。
set -eu

BASE_URL="${BASE_URL:-http://web:8080}"
export BASE_URL

echo "==> [verify 1/3] Vitest 单元测试（校验器 / ROBDD 不变量 / 引擎）"
npm run test:unit

echo "==> [verify 2/3] TypeScript 类型检查与生产构建"
npm run build

echo "==> [verify 3/3] 等待静态站点 ${BASE_URL} 就绪"
node -e '
const http = require("http");
const url = process.argv[1];
const deadline = Date.now() + 60000;
function tick() {
  const req = http.get(url, (res) => {
    res.resume();
    if (res.statusCode === 200) process.exit(0);
    else retry(new Error("HTTP " + res.statusCode));
  });
  req.on("error", retry);
  req.setTimeout(2000, () => req.destroy(new Error("timeout")));
}
function retry(e) {
  if (Date.now() > deadline) { console.error("web 不可达:", e.message); process.exit(1); }
  setTimeout(tick, 2000);
}
tick();
' "${BASE_URL}/"

echo "==> [verify 3/3] Playwright 端到端验收（${BASE_URL}）"
npx playwright test

echo "==> 验收全部通过：单元测试、构建与 E2E 均成功"
