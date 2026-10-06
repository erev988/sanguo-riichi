import { describe, expect, it } from 'vitest';
import { calcTenpai, mulberry32, shanten, type Tile } from '../src/index';

describe('向听数计算', () => {
  it('和牌形（14 张）→ -1', () => {
    expect(shanten([1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 31, 31])).toBe(-1);
  });

  it('听牌（13 张）→ 0', () => {
    // 123m 456p 789s 發發發 白（听白）
    expect(shanten([1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35])).toBe(0);
  });

  it('一向听（13 张）→ 1', () => {
    // 111m 222m 333m 78p 9s：3 面子 + 1 搭子 + 1 单张
    expect(shanten([1, 1, 1, 2, 2, 2, 3, 3, 3, 17, 18, 29])).toBe(1);
  });

  it('七对听牌 → 0', () => {
    expect(shanten([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7])).toBe(0);
  });

  it('国士听牌 → 0', () => {
    expect(shanten([1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37])).toBe(0);
  });

  it('副露面子计入：两副露 + 听牌 → 0', () => {
    const melds = [
      { type: 'pon' as const, tiles: [1, 1, 1] },
      { type: 'chii' as const, tiles: [14, 15, 16] },
    ];
    // 副露 2 组，手牌 7 张：456m 789s 白（单张听）
    const hand: Tile[] = [4, 5, 6, 24, 25, 26, 35];
    expect(shanten(hand, melds)).toBe(0);
  });

  it('乱牌向听数较大', () => {
    const s = shanten([1, 4, 7, 11, 15, 19, 22, 25, 28, 31, 33, 35, 37]);
    expect(s).toBeGreaterThanOrEqual(3);
  });

  it('回归：3 面子 + 2 个非对子搭子 = 1 向听（不能算听牌）', () => {
    // 345m 89m 12p 567p 456s（两个两面搭子，无对子做雀头）
    const s = shanten([3, 4, 5, 8, 9, 11, 12, 15, 16, 17, 24, 25, 26]);
    expect(s).toBe(1);
  });

  it('回归：3 面子 + 2 对子 = 听牌（一对做雀头）', () => {
    // 111m 222m 333m 55p 88s
    expect(shanten([1, 1, 1, 2, 2, 2, 3, 3, 3, 15, 15, 28, 28])).toBe(0);
  });

  it('一致性：随机手牌 shanten===0 ⟺ calcTenpai 非空', () => {
    const rng = mulberry32(20241006);
    let checked = 0;
    for (let iter = 0; iter < 300; iter++) {
      // 造 13 张「合法」手牌（每种至多 4 张）
      const pool: Tile[] = [];
      for (let k = 1; k <= 9; k++) pool.push(k, k, k, k);
      for (let k = 11; k <= 19; k++) pool.push(k, k, k, k);
      for (let k = 21; k <= 29; k++) pool.push(k, k, k, k);
      for (let k = 31; k <= 37; k++) pool.push(k, k, k, k);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const hand = pool.slice(0, 13).sort((a, b) => a - b);
      const sh = shanten(hand);
      const tp = calcTenpai(hand).length > 0;
      expect(sh === 0).toBe(tp);
      checked++;
    }
    expect(checked).toBe(300);
  });
});
