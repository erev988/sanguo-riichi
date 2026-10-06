import { describe, expect, it } from 'vitest';
import { calcTenpai, tileName, type Tile } from '../src/index';

describe('听牌判定（自研回溯拆牌）', () => {
  it('单骑：123m456p456s發發發白 → 听白', () => {
    const hand: Tile[] = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35];
    const t = calcTenpai(hand);
    expect(t).toEqual([35]); // 白
    expect(t.map(tileName)).toEqual(['白']);
  });

  it('双碰：123m456p456s白白東東 → 听白/東', () => {
    const hand: Tile[] = [1, 2, 3, 14, 15, 16, 24, 25, 26, 35, 35, 31, 31];
    const t = calcTenpai(hand).sort((a, b) => a - b);
    expect(t).toEqual([31, 35]); // 東、白
  });

  it('两面：345m345p345s中中 12m → 听 3m', () => {
    const hand: Tile[] = [3, 4, 5, 13, 14, 15, 23, 24, 25, 36, 36, 1, 2];
    const t = calcTenpai(hand);
    expect(t).toContain(3);
  });

  it('国士十三面：19m19p19s东南西北白发中 + 白 → 听全部 13 种幺九', () => {
    const hand: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37];
    const t = calcTenpai(hand);
    expect(t.length).toBe(13);
    expect(t).toContain(35); // 白
    expect(t).toContain(1); // 1m
  });

  it('七对：1122334455667m → 听 7m（复合听牌还含标准形 1m/4m）', () => {
    const hand: Tile[] = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7];
    const t = calcTenpai(hand);
    // 补 7m 七对；补 1m/4m 标准形（雀头11 + 123+234+456+567）也是真听牌
    expect(t).toContain(7);
    expect(t).toEqual(expect.arrayContaining([1, 4, 7]));
  });

  it('纯字牌七对：東東南南西西北北白白發發中 → 听中（无标准形干扰）', () => {
    const hand: Tile[] = [31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37];
    expect(calcTenpai(hand)).toEqual([37]);
  });

  it('赤宝牌按 5 计数：0m+5m 可作雀头 → 听東', () => {
    const hand: Tile[] = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 0, 5];
    const t = calcTenpai(hand);
    expect(t).toContain(31); // 東
    expect(t).toContain(5); // 5m（0m+5m+5m 成刻子，東東做雀头）
  });
});
