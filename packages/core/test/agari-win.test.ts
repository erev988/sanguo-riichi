import { describe, expect, it } from 'vitest';
import { evaluateAgari, type AgariContext, type Meld, type Tile } from '../src/index';

function makeAgari(over: Partial<AgariContext>): AgariContext {
  return {
    juntehai: [],
    agariPai: 0,
    fuuro: [],
    menzen: true,
    isTsumo: true,
    riichi: { accepted: false, double: false, ippatsu: false },
    rinshan: false,
    chankan: false,
    isHaitei: false,
    virgin: false,
    agariPlayer: 0,
    chancha: 0,
    bakaze: 31, // 东场
    jikaze: 31, // 东家
    kuitan: true,
    ...over,
  };
}

describe('和牌判定 evaluateAgari（agari.ls 转写）', () => {
  it('平和自摸：123m456m123p456p55m，听 3m 自摸 → 平和+门清自摸 2 番，20 符', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 4, 5, 6, 11, 12, 13, 14, 15, 16, 5, 5], // 123m 456m 123p 456p 55m（缺 3m）
      agariPai: 3,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['平和', '门清自摸']));
    expect(r!.hanTotal).toBe(2);
    expect(r!.fu).toBe(20);
  });

  it('清一色荣和：1112345678999m + 3m → 清一色 6 番', () => {
    const ctx = makeAgari({
      juntehai: [1, 1, 1, 2, 4, 5, 6, 7, 8, 9, 9, 9, 3], // 听 3m
      agariPai: 3,
      isTsumo: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('清一色');
    expect(r!.hanTotal).toBe(6);
  });

  it('七对：11223344556677m → 七对子 2 番 25 符', () => {
    const ctx = makeAgari({
      juntehai: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7],
      agariPai: 7,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('七对子');
    expect(r!.fu).toBe(25);
  });

  it('国士：13 种幺九 + 白 → 役满国士无双', () => {
    const ctx = makeAgari({
      juntehai: [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37],
      agariPai: 1, // 荣和 1m
      isTsumo: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yakuman.map((y) => y.name)).toContain('国士无双');
    expect(r!.yakumanTotal).toBe(1);
  });

  it('无役不可和：123m456m789p456p南南，荣和南 → null', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32], // 南家非役牌雀头，无断幺无全带
      agariPai: 32,
      isTsumo: false, // 荣和才无役（自摸有门清自摸）
    });
    expect(evaluateAgari(ctx)).toBeNull();
  });

  it('食断：副露 234s 的断幺九（menzen=false）→ 1 番', () => {
    const chii234s: Meld = { type: 'chii', tiles: [22, 23, 24] };
    // 副露占 1 面子 → 手牌 10 张 + 和牌张 = 11 张，凑 3 面子 + 雀头
    const ctx = makeAgari({
      juntehai: [3, 4, 5, 6, 7, 8, 12, 13, 14, 5], // 345m 678m 234p + 5m
      agariPai: 5, // → 345m 678m 234p + 55m 雀头，全中张
      fuuro: [chii234s],
      menzen: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('断幺九');
    expect(r!.hanTotal).toBe(1);
  });

  it('役牌發刻子：123m456p456s發發發白 + 白自摸 → 役牌發 1 番', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35],
      agariPai: 35,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['役牌·發']));
  });
});

describe('副露手的和牌判定（P0-2 回归防线）', () => {
  const ponHaku: Meld = { type: 'pon', tiles: [35, 35, 35] }; // 碰 白（役牌，保证有役）

  it('碰白 + 123m456m789m + 77p 荣和 7p → 成立且计「役牌·白」', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 3, 4, 5, 6, 7, 8, 9, 17], // 123m456m789m + 7p
      agariPai: 17, // → 77p 雀头
      fuuro: [ponHaku],
      menzen: false,
      isTsumo: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('役牌·白');
  });

  it('碰白 + 全万子（456m789m111m + 99m）→ 计混一色', () => {
    const ctx = makeAgari({
      juntehai: [4, 5, 6, 7, 8, 9, 1, 1, 1, 9],
      agariPai: 9,
      fuuro: [ponHaku],
      menzen: false,
      isTsumo: true,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('混一色'); // 字牌副露 + 全万子 = 混一色
  });

  it('两副露（碰白 + 吃 234s）手牌 123m456p 单骑 8m → 成立', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 3, 14, 15, 16, 8], // 123m 456p + 8m
      agariPai: 8, // → 88m 雀头
      fuuro: [ponHaku, { type: 'chii', tiles: [22, 23, 24] }],
      menzen: false,
      isTsumo: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('役牌·白');
  });

  it('四副露全刻子（含碰白）单骑 → 成立且计对对和', () => {
    const ctx = makeAgari({
      juntehai: [1], // 四副露：手牌仅 13-3×4 = 1 张
      agariPai: 1, // → 11m 雀头
      fuuro: [
        ponHaku,
        { type: 'pon', tiles: [11, 11, 11] },
        { type: 'pon', tiles: [21, 21, 21] },
        { type: 'pon', tiles: [25, 25, 25] },
      ],
      menzen: false,
      isTsumo: false,
    });
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    const names = r!.yaku.map((y) => y.name);
    expect(names).toContain('对对和');
  });

  it('副露后不能构成和牌形时返回 null（12 张手牌 + 1 副露）', () => {
    const ctx = makeAgari({
      juntehai: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 17],
      agariPai: 17,
      fuuro: [ponHaku],
      menzen: false,
      isTsumo: false,
    });
    expect(evaluateAgari(ctx)).toBeNull();
  });
});
