import { describe, expect, it } from 'vitest';
import { countAka, countDora, doraFromIndicator, evaluateAgari, type AgariContext, type Tile } from '../src/index';

/** 造一个最简和牌上下文（平平无奇的役牌發 + 门清自摸，便于观察宝牌影响） */
function ctx(over: Partial<AgariContext>): AgariContext {
  return {
    juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35],
    agariPai: 35,
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
    bakaze: 31,
    jikaze: 31,
    kuitan: true,
    ...over,
  };
}

describe('宝牌换算', () => {
  it('数牌 +1，9→1', () => {
    expect(doraFromIndicator(3)).toBe(4);
    expect(doraFromIndicator(9)).toBe(1);
    expect(doraFromIndicator(19)).toBe(11);
    expect(doraFromIndicator(29)).toBe(21);
  });

  it('风牌 东→南→西→北→东', () => {
    expect(doraFromIndicator(31)).toBe(32);
    expect(doraFromIndicator(34)).toBe(31);
  });

  it('三元牌 白→发→中→白', () => {
    expect(doraFromIndicator(35)).toBe(36);
    expect(doraFromIndicator(37)).toBe(35);
  });

  it('统计宝牌张数（赤 5 按牌面 5 计入）', () => {
    expect(countDora([5, 5, 0], [4])).toBe(3); // 指示 4m → 宝牌 5m（含赤 0m）
    expect(countDora([6, 7], [4])).toBe(0);
    expect(countAka([0, 10, 20, 5])).toBe(3);
  });
});

describe('和牌计入宝牌番数', () => {
  it('宝牌：指示 4m 手牌两张 5m → +2 番', () => {
    const c = ctx({
      juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 5],
      agariPai: 5, // 和 5m，手牌两张 5m
      doraIndicators: [4],
    });
    const r = evaluateAgari(c);
    expect(r).not.toBeNull();
    const dora = r!.yaku.find((y) => y.name === '宝牌');
    expect(dora?.han).toBe(2);
  });

  it('杠宝牌：多张指示牌同时计入', () => {
    const c = ctx({
      juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 5],
      agariPai: 5,
      doraIndicators: [4, 4], // 杠后翻开两张，都是 4m → 宝牌仍是 5m，但手牌 5m 两张只算 2
    });
    const r = evaluateAgari(c);
    expect(r).not.toBeNull();
    // 两张指示牌都指向 5m，牌面匹配仍按手牌张数计（2 张）
    expect(r!.yaku.find((y) => y.name === '宝牌')?.han).toBe(2);
  });

  it('里宝牌：立直和牌时计入，未立直不计', () => {
    const base = {
      juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 5] as Tile[],
      agariPai: 5,
      uraIndicators: [4], // 里指示 4m → 里宝牌 5m（手牌 2 张）
    };
    const riichi = evaluateAgari(ctx({ ...base, riichi: { accepted: true, double: false, ippatsu: false } }));
    expect(riichi!.yaku.find((y) => y.name === '里宝牌')?.han).toBe(2);

    const noRiichi = evaluateAgari(ctx({ ...base, riichi: { accepted: false, double: false, ippatsu: false } }));
    expect(noRiichi!.yaku.find((y) => y.name === '里宝牌')).toBeUndefined();
  });

  it('赤宝牌：每张赤 5 各 +1 番', () => {
    const c = ctx({
      juntehai: [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 0], // 含赤 5m
      agariPai: 5,
    });
    const r = evaluateAgari(c);
    expect(r!.yaku.find((y) => y.name === '赤宝牌')?.han).toBe(1);
  });

  it('宝牌不构成役：无役时即使有宝牌也不能和', () => {
    const c = ctx({
      // 无役形（荣和、无役牌、非断幺/平和）
      juntehai: [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32],
      agariPai: 32,
      isTsumo: false,
      doraIndicators: [3], // 指示 3m → 手牌 4m 是宝牌，但它不能当役
    });
    expect(evaluateAgari(c)).toBeNull();
  });

  it('役满不叠宝牌', () => {
    const c = ctx({
      // 国士无双十三面 + 一张宝牌指示也不影响役满
      juntehai: [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37],
      agariPai: 1,
      isTsumo: false,
      doraIndicators: [9], // 指示 9m → 宝牌 1m（手牌含 1m×2）
    });
    const r = evaluateAgari(c);
    expect(r!.yakuman.length).toBeGreaterThan(0);
    expect(r!.yaku).toEqual([]); // 役满时不列通常役/宝牌
  });
});
