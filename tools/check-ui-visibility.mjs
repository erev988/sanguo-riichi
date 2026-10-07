#!/usr/bin/env node
/**
 * 界面可见性静态断言（Node 18 兼容，无需浏览器）
 *
 * 复测报告 §9.3 改造 5 的「零依赖兜底版」：真实布局断言见 packages/client/e2e/visibility.spec.ts
 * （那个需要 Node 20 + Chromium；本脚本可在任何环境与 CI 里跑）
 *
 * 断言的是「让所有内容可见」的几条结构性原则：
 *   1. 信息区选择器不得使用 overflow: hidden（任何一处都是 bug 种子）
 *   2. 手牌层不得用大面积深色遮罩盖住牌河
 *   3. 牌桌不得用硬编码的 padding-bottom「祈祷式让位」
 *   4. 牌河必须是固定网格（不再自由换行后溢出）
 *   5. 关键改造规则必须存在（最后一张高亮 / 行动家高亮 / 侧家牌背 / 战报条 / 倒计时）
 *
 * 用法：node tools/check-ui-visibility.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(root, 'packages/client/src/style.css');
const appPath = path.join(root, 'packages/client/src/App.vue');
const cssRaw = fs.readFileSync(cssPath, 'utf8');
/** 剥离注释后再断言（注释里提到 padding-bottom:106px 不应算违规） */
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const app = fs.readFileSync(appPath, 'utf8');

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

/** 抽取某选择器的最后一条规则体（本文件后定义覆盖前定义） */
function lastRuleBody(selector) {
  const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let body = null;
  let m;
  while ((m = re.exec(css))) body = m[1];
  return body;
}

/** 某属性在所有含该选择器的规则里是否出现过 */
function hasAnyDecl(selectorFragment, prop) {
  const escaped = selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[^\\n]*${escaped}[^\\n]*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(css))) {
    for (const decl of m[1].split(';')) {
      const [p, v] = decl.split(':').map((x) => (x ?? '').trim());
      if (p === prop && /hidden/.test(v ?? '')) return v;
    }
  }
  return null;
}

console.log('=== 界面可见性静态断言 ===\n');

// ---- 1. 信息区不得 overflow: hidden ----
const infoSelectors = ['.river-top', '.river-bottom', '.river-left', '.river-right', '.seat', '.core', '.hand-tiles', '.hand-layer'];
const clipped = [];
for (const sel of infoSelectors) {
  const body = lastRuleBody(sel);
  if (body && /overflow(-y)?\s*:\s*hidden/.test(body)) clipped.push(sel);
  // 组合选择器（如 .river-top,\n.river-bottom）也要查
  if (hasAnyDecl(sel, 'overflow') === 'hidden' && !body?.includes('overflow: visible')) clipped.push(`${sel}(组合)`);
}
check('信息区无 overflow:hidden', clipped.length === 0, clipped.join(', '));

// ---- 2. 手牌层不得有大面积深色遮罩 ----
const selfBefore = lastRuleBody('.seat.self::before');
const hasHeavyMask =
  !!selfBefore && !/display\s*:\s*none/.test(selfBefore) && /rgba\(0,\s*0,\s*0,\s*0\.[4-9]/.test(selfBefore);
check('手牌层无深色大面积遮罩（≥0.4 的黑）', !hasHeavyMask, selfBefore ? selfBefore.trim().slice(0, 60) : '（无该规则）');

// ---- 3. 牌桌无硬编码 padding-bottom 让位 ----
const tablePads = [...css.matchAll(/padding-bottom\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
const bigPad = tablePads.filter((n) => n > 24);
check('牌桌无硬编码大 padding-bottom 让位', bigPad.length === 0, bigPad.join(', '));
// 自家区必须回到文档流（不得是绝对定位浮层）
check(
  '自家区不再绝对定位（回到文档流）',
  !anyRuleBody('.seat.self', (b) => /position\s*:\s*absolute/.test(b), { exclude: /::/ }),
);

// ---- 4. 牌河为固定网格：只要「存在」一条生效的 grid 规则即可（后续规则可能只覆盖 direction） ----
/**
 * 是否存在「某条规则体」满足条件。
 * 支持跨行选择器（`.a,\n.b, { ... }`），并用 exclude 过滤伪元素等。
 */
function anyRuleBody(selectorFragment, test, opts = {}) {
  const escaped = selectorFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 选择器可能跨行，故用 [^{}]* 而非 [^\n]*
  const re = new RegExp(`([^{}]*?${escaped}[^{}]*?)\\{([^{}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(css))) {
    const selector = m[1];
    if (opts.exclude && opts.exclude.test(selector)) continue; // 如排除 ::before/::after
    if (test(m[2])) return true;
  }
  return false;
}
check('牌河使用 grid 布局', anyRuleBody('.river-bottom', (b) => /display\s*:\s*grid/.test(b)));
check(
  '牌河固定 6 列',
  anyRuleBody('.river-bottom', (b) => /repeat\(\s*var\(--river-cols\)|repeat\(\s*6/.test(b)),
);
// 同时确认没有残留的 flex 换行 + 裁剪写法
check(
  '牌河无残留 flex 换行写法',
  !anyRuleBody('.river-bottom', (b) => /display\s*:\s*flex/.test(b) && /flex-wrap/.test(b)),
);

// ---- 5. 关键改造规则存在 ----
const must = [
  ['.tile.last', '刚打出的牌高亮'],
  ['.core-cell.active', '当前行动家高亮'],
  ['.backs-v', '侧家竖排牌背'],
  ['.log-bar', '战报条'],
  ['.core-timer', '中央倒计时'],
  ['.tenpai-tip', '听牌提示'],
  ['.dealer-mark', '庄家徽标'],
  ['.riichi-sticks', '立直棒实体化'],
  ['.btn-tiles', '按钮牌面预览'],
];
for (const [sel, name] of must) {
  check(`规则存在：${name}（${sel}）`, css.includes(sel));
}

// ---- 6. 模板侧：关键元素仍被渲染（防止删掉后样式变死代码）----
const tplMust = [
  ['class="river-top', '对家河'],
  ['class="river-bottom', '自家河'],
  ['class="backs-v"', '侧家牌背'],
  ['class="log-bar"', '战报条'],
  ['class="hand-tiles"', '手牌区'],
  ['tileRiverSize', '牌河尺寸变量'],
  ['tileBackSize', '牌背尺寸变量'],
];
for (const [needle, name] of tplMust) {
  check(`模板存在：${name}`, app.includes(needle));
}

console.log('');
if (fails === 0) {
  console.log('🎉 界面可见性原则全部通过（真实布局断言见 packages/client/e2e/visibility.spec.ts）');
} else {
  console.log(`❌ ${fails} 项未通过`);
}
process.exit(fails === 0 ? 0 : 1);
