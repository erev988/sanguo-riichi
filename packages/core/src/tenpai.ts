import type { Meld, Tile } from './types';

/**
 * 听牌判定（自研回溯拆牌）。
 *
 * 说明：riichi-core 2.0 master 的 decomp 只实现了 kokushi/chiitoi，
 * 标准 4 面子+1 雀头分支是未完成代码（CCCM 定义了但从未被调用）。
 * 因此这里用经典回溯算法自研标准拆牌，正确性可控、性能足够
 * （34 种候选 × 每候选 O(手牌) 递归，实际 <1ms）。
 *
 * 输入 13 张手牌（不含副露），返回能和的牌列表（红宝牌 0/10/20 等价 5/15/25）。
 */

/** 四种花色计数：万1-9 / 饼11-19 / 索21-29 / 字31-37（赤宝牌按 5 计） */
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

/** 14 张能否拆成 n 面子 + 1 雀头（n 由副露数决定） */
function isStandardWinN(c: Counts, needMentsu: number): boolean {
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] >= 2) {
        c[s][i] -= 2;
        const ok = tryMentsu(c, needMentsu);
        c[s][i] += 2;
        if (ok) return true;
      }
    }
  }
  return false;
}

/** 14 张能否拆成 4 面子 + 1 雀头 */
function isStandardWin(c: Counts): boolean {
  return isStandardWinN(c, 4);
}

function tryMentsu(c: Counts, n: number): boolean {
  if (n === 0) {
    for (let s = 0; s < 4; s++) {
      const len = s === 3 ? 7 : 9;
      for (let i = 0; i < len; i++) if (c[s][i] !== 0) return false;
    }
    return true;
  }
  // 找最左非零牌：它要么是刻子的一部分，要么是顺子的一部分（数牌）
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 9; i++) {
      if (c[s][i] > 0) {
        if (c[s][i] >= 3) {
          c[s][i] -= 3;
          if (tryMentsu(c, n - 1)) return true;
          c[s][i] += 3;
        }
        if (i <= 6 && c[s][i + 1] > 0 && c[s][i + 2] > 0) {
          c[s][i]--;
          c[s][i + 1]--;
          c[s][i + 2]--;
          if (tryMentsu(c, n - 1)) return true;
          c[s][i]++;
          c[s][i + 1]++;
          c[s][i + 2]++;
        }
        return false; // 最左非零牌无法构成面子 → 该分支失败
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    if (c[3][i] > 0) {
      if (c[3][i] >= 3) {
        c[3][i] -= 3;
        if (tryMentsu(c, n - 1)) return true;
        c[3][i] += 3;
      }
      return false; // 字牌只能刻子
    }
  }
  return false;
}

/** 七对：补 t 后恰 7 种牌各 2 张 */
function isChiitoi(c13: Counts, t: Tile): boolean {
  const c = countsOf(appendTile(tilesOf(c13), t));
  let pairs = 0;
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] !== 0 && c[s][i] !== 2) return false;
      if (c[s][i] === 2) pairs++;
    }
  }
  return pairs === 7;
}

/** 国士：补 t 后 13 种幺九齐全且恰好 1 对（= 14 张） */
function isKokushi(c13: Counts, t: Tile): boolean {
  const yaochuu: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37];
  if (!yaochuu.includes(t)) return false;
  const c14 = countsOf(appendTile(tilesOf(c13), t));
  let kinds = 0;
  let pairs = 0;
  for (const y of yaochuu) {
    const n = countOfTile(c14, y);
    if (n === 0) continue;
    if (n === 2) pairs++;
    else if (n !== 1) return false;
    kinds++;
  }
  return kinds === 13 && pairs === 1;
}

// ---- 小工具 ----
function countOfTile(c: Counts, t: Tile): number {
  if (t <= 9) return c[0][t === 0 ? 4 : t - 1];
  if (t <= 19) return c[1][t === 10 ? 4 : t - 11];
  if (t <= 29) return c[2][t === 20 ? 4 : t - 21];
  return c[3][t - 31];
}

function appendTile(tiles: Tile[], t: Tile): Tile[] {
  return [...tiles, t];
}

function tilesOf(c: Counts): Tile[] {
  const out: Tile[] = [];
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      for (let k = 0; k < c[s][i]; k++) {
        out.push(s === 0 ? i + 1 : s === 1 ? 11 + i : s === 2 ? 21 + i : 31 + i);
      }
    }
  }
  return out;
}

export function calcTenpai(hand: Tile[]): Tile[] {
  const candidates: Tile[] = [];
  for (let k = 1; k <= 9; k++) candidates.push(k); // 万
  for (let k = 11; k <= 19; k++) candidates.push(k); // 饼
  for (let k = 21; k <= 29; k++) candidates.push(k); // 索
  for (let k = 31; k <= 37; k++) candidates.push(k); // 字

  const c13 = countsOf(hand);
  const result: Tile[] = [];
  for (const t of candidates) {
    if (isChiitoi(c13, t) || isKokushi(c13, t)) {
      result.push(t);
      continue;
    }
    const c14 = countsOf(appendTile(hand, t));
    if (isStandardWin(c14)) result.push(t);
  }
  return result;
}

/**
 * 含副露的听牌判定：副露面子已固定，手牌需凑 (4 - 副露数) 面子 + 1 雀头。
 * 输入手牌为「13 - 3×副露数」张（七对/国士仅门清时可能）。
 */
export function calcTenpaiWithMelds(hand: Tile[], melds: Meld[]): Tile[] {
  const need = 4 - melds.length;
  if (need < 0) return [];
  const candidates: Tile[] = [];
  for (let k = 1; k <= 9; k++) candidates.push(k);
  for (let k = 11; k <= 19; k++) candidates.push(k);
  for (let k = 21; k <= 29; k++) candidates.push(k);
  for (let k = 31; k <= 37; k++) candidates.push(k);

  const c13 = countsOf(hand);
  const result: Tile[] = [];
  for (const t of candidates) {
    if (melds.length === 0 && (isChiitoi(c13, t) || isKokushi(c13, t))) {
      result.push(t);
      continue;
    }
    const c14 = countsOf(appendTile(hand, t));
    if (need === 0 ? false : isStandardWinN(c14, need)) result.push(t);
  }
  return result;
}
