import { defineConfig, devices } from '@playwright/test';

/**
 * 可见性回归测试配置（复测报告 §9.3 改造 5）
 * 需要 Node 20+：`npm i -D @playwright/test && npx playwright install chromium`
 *   E2E_PORT=8899 npx playwright test -c packages/client
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile-landscape',
      use: { ...devices['Pixel 5 landscape'], viewport: { width: 844, height: 390 } },
    },
  ],
});
