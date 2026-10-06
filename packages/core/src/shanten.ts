import type { Meld, Tile } from './types';

// ============================================================================
// 向听数计算（AI 决策基础）
// 返回：-1 = 和牌形，0 = 听牌，n = n 向听
// 标准形（递归枚举面子/搭子）+ 七对 + 国士
// ============================================================================

type Counts = [number[], number[], number[], number[]];

function countsOf(tiles: Tile[]): Counts {
  const c: Counts = [
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(7).fill(0),
  ];
  for (const t of tiles) {
    if (t <= 9) c[0][t === 0 ? 4 : t - 1]++;
    else if (t <= 19) c[1][t === 10 ? 4 : t - 11]++;
    else if (t <= 29) c[2][t === 20 ? 4 : t - 21]++;
    else if (t >= 31) c[3][t - 31]++;
  }
  return c;
}

export function shanten(hand: Tile[], melds: Meld[] = []): number {
  const meldCount = melds.length;
  const c = countsOf(hand);
  let best = 8 - 2 * meldCount; // 基础值（什么搭子都没有）
  best = Math.min(best, stdShanten(c, meldCount));
  if (meldCount === 0) {
    best = Math.min(best, chiitoiShanten(c));
    best = Math.min(best, kokushiShanten(c));
  }
  return best;
}

/** 标准形：枚举雀头 + 递归枚举面子/搭子 */
function stdShanten(c: Counts, meldCount: number): number {
  let min = 8 - 2 * meldCount;
  // 无雀头
  min = Math.min(min, dfsBlocks(c, meldCount, 0, 0));
  // 有雀头
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] >= 2) {
        c[s][i] -= 2;
        min = Math.min(min, dfsBlocks(c, meldCount, 0, 1));
        c[s][i] += 2;
      }
    }
  }
  return min;
}

/**
 * 递归：把计数拆成「面子 + 搭子」，返回最小向听。
 * 向听 = 8 - 2×面子 - 搭子 - 雀头（约束：面子+搭子+雀头 ≤ 5）
 */
function dfsBlocks(c: Counts, melds: number, partials: number, hasPair: number): number {
  // 只有「面子 + 搭子 ≤ 4（第 5 组由雀头承担）」的组合才有效
  let best = melds + partials <= 4 ? 8 - 2 * melds - partials - hasPair : Infinity;
  const canAddMeld = melds < 4;
  const canAddPartial = melds + partials < 4;

  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] === 0) continue;
      // 刻子
      if (canAddMeld && c[s][i] >= 3) {
        c[s][i] -= 3;
        best = Math.min(best, dfsBlocks(c, melds + 1, partials, hasPair));
        c[s][i] += 3;
      }
      // 顺子
      if (canAddMeld && s < 3 && i <= 6 && c[s][i + 1] > 0 && c[s][i + 2] > 0) {
        c[s][i]--;
        c[s][i + 1]--;
        c[s][i + 2]--;
        best = Math.min(best, dfsBlocks(c, melds + 1, partials, hasPair));
        c[s][i]++;
        c[s][i + 1]++;
        c[s][i + 2]++;
      }
      if (canAddPartial) {
        // 对子（作搭子）
        if (c[s][i] >= 2) {
          c[s][i] -= 2;
          best = Math.min(best, dfsBlocks(c, melds, partials + 1, hasPair));
          c[s][i] += 2;
        }
        // 两面 / 边张（连续两张）
        if (s < 3 && i <= 7 && c[s][i + 1] > 0) {
          c[s][i]--;
          c[s][i + 1]--;
          best = Math.min(best, dfsBlocks(c, melds, partials + 1, hasPair));
          c[s][i]++;
          c[s][i + 1]++;
        }
        // 嵌张（隔一张）
        if (s < 3 && i <= 6 && c[s][i + 2] > 0) {
          c[s][i]--;
          c[s][i + 2]--;
          best = Math.min(best, dfsBlocks(c, melds, partials + 1, hasPair));
          c[s][i]++;
          c[s][i + 2]++;
        }
      }
      // 弃置（当单张处理）
      c[s][i]--;
      best = Math.min(best, dfsBlocks(c, melds, partials, hasPair));
      c[s][i]++;
      return best; // 最左非零处理完即可返回
    }
  }
  return best;
}

function chiitoiShanten(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] >= 2) pairs++;
      if (c[s][i] > 0) kinds++;
    }
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

function kokushiShanten(c: Counts): number {
  const yaochuu: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37];
  let kinds = 0;
  let hasPair = 0;
  for (const y of yaochuu) {
    const s = Math.floor(y / 10);
    const i = y <= 9 ? y - 1 : y <= 19 ? y - 11 : y <= 29 ? y - 21 : y - 31;
    const n = c[s][i] ?? 0;
    if (n > 0) kinds++;
    if (n >= 2) hasPair = 1;
  }
  return 13 - kinds - hasPair;
}
