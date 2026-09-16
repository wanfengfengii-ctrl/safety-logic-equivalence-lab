import { defineConfig } from '@playwright/test';

// 容器验收时由 docker-compose 注入 BASE_URL=http://web:8080；
// 本地运行时自动启动静态服务器服务 dist。
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npx serve -s dist -l 4173',
        url: 'http://127.0.0.1:4173',
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
      },
});
