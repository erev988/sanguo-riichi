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
    const ctx = makeAgari({
      juntehai: [3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 5], // 345m678m 234p567p 55m，全中张
      agariPai: 5,
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
