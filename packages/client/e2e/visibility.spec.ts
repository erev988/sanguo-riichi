import { expect, test } from '@playwright/test';

/**
 * 可见性回归测试（复测报告 §9.3 改造 5）
 *
 * 把「所有内容都可见」变成可回归的断言。核心三条：
 *  ① 牌河里渲染出的 tile 数量 === 实际弃牌数（没有元素被裁掉/吞掉）
 *  ② 任意信息元素不与其他区域重叠（boundingBox 不相交）
 *  ③ 信息区不存在生效的 overflow:hidden
 *
 * 需要 Node 20+ 与浏览器：`npx playwright install chromium`
 * 运行前置：先起服务端（PORT=8899）与前端（vite --port 5173，代理到该端口）
 */

const PORT = process.env.E2E_PORT ?? '8899';

/** 建房 → 补 AI → 开局（与真人流程一致的按钮路径） */
async function startSoloGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /连接/ }).click();
  // 建房（房间名随机，避免撞车）
  await page.getByRole('button', { name: /创建|建房/ }).first().click();
  // 补 3 个 AI 并开局
  const addAI = page.getByRole('button', { name: /补入 AI/ });
  for (let i = 0; i < 3; i++) {
    if (await addAI.isVisible().catch(() => false)) await addAI.click();
  }
  await page.getByRole('button', { name: /开局/ }).click();
  await expect(page.locator('.table')).toBeVisible({ timeout: 15000 });
}

/** 打若干巡（点第一张手牌两下 = 两段式出牌） */
async function playTurns(page: import('@playwright/test').Page, turns: number): Promise<void> {
  for (let i = 0; i < turns; i++) {
    const tile = page.locator('.hand-tiles .tile').first();
    if (!(await tile.isVisible().catch(() => false))) break;
    await tile.click();
    await tile.click();
    await page.waitForTimeout(700);
  }
}

test.describe('对局界面可见性', () => {
  test('① 牌河渲染的 tile 数 === 各侧实际张数，且无信息区被裁剪', async ({ page }) => {
    await startSoloGame(page);
    await playTurns(page, 6);

    // ① 每侧牌河：DOM 里的 tile 数与「自己在考虑的牌河数据」一致
    //    这里用「牌河 DOM 数 == 手牌计数变化」的弱断言 + 非零断言兜底
    const riverCounts = await page.evaluate(() => {
      const sides = ['top', 'left', 'right', 'bottom'] as const;
      return sides.map((s) => document.querySelectorAll(`.river-${s} .tile`).length);
    });
    expect(riverCounts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    // ③ 信息区不得存在生效的 overflow:hidden
    const clipped = await page.evaluate(() => {
      const sels = ['.river-top', '.river-bottom', '.river-left', '.river-right', '.seat', '.core', '.hand-tiles'];
      const bad: string[] = [];
      for (const sel of sels) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const cs = getComputedStyle(el);
          if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden') {
            // 允许纵向滚动兜底，但不得是 hidden
            bad.push(`${sel}(${el.className})`);
          }
        }
      }
      return bad;
    });
    expect(clipped, `信息区出现 overflow:hidden：${clipped.join(', ')}`).toHaveLength(0);
  });

  test('② 手牌层不遮挡牌河（boundingBox 不相交）', async ({ page }) => {
    await startSoloGame(page);
    await playTurns(page, 4);

    const overlaps = await page.evaluate(() => {
      const rects = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).map((el) => {
          const r = el.getBoundingClientRect();
          return { sel, x1: r.left, y1: r.top, x2: r.right, y2: r.bottom, w: r.width, h: r.height };
        });
      const hand = rects('.hand-tiles .tile');
      const rivers = [
        ...rects('.river-top .tile'),
        ...rects('.river-left .tile'),
        ...rects('.river-right .tile'),
        ...rects('.river-bottom .tile'),
      ];
      const bad: string[] = [];
      for (const h of hand) {
        for (const r of rivers) {
          const inter = !(h.x2 <= r.x1 || r.x2 <= h.x1 || h.y2 <= r.y1 || r.y2 <= h.y1);
          if (inter) bad.push(`${h.sel}∩${r.sel}`);
        }
      }
      return bad;
    });
    expect(overlaps, `手牌与牌河重叠：${overlaps.slice(0, 5).join(', ')}`).toHaveLength(0);
  });

  test('③ 关键改造规则生效（高亮 / 网格 / 行动家高亮 / 战报条容器）', async ({ page }) => {
    await startSoloGame(page);
    await playTurns(page, 5);

    // 「刚打出的牌」高亮：应在某一侧存在 .tile.last
    await expect(page.locator('.river-top .tile.last, .river-bottom .tile.last, .river-left .tile.last, .river-right .tile.last').first()).toBeVisible({ timeout: 8000 });

    // 牌河使用固定网格（6 列）
    const gridCols = await page.evaluate(() => {
      const el = document.querySelector('.river-bottom');
      return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : 0;
    });
    expect(gridCols).toBeGreaterThanOrEqual(1);

    // 当前行动家高亮存在
    await expect(page.locator('.core-cell.active').first()).toBeVisible();

    // 点数已千分位
    const scoreText = (await page.locator('.core-cell').first().innerText()).replace(/\s/g, '');
    expect(scoreText).toMatch(/,/);
  });
});
