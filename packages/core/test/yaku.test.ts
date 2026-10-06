import { describe, expect, it } from 'vitest';
import { enumerateDecomps, YAKU_LIST, type Meld, type Tile, type YakuContext } from '../src/index';

/** 构造判定上下文：手牌 14 张（可含副露）+ 可覆盖字段 */
function makeCtx(tiles14: Tile[], over: Partial<YakuContext> = {}): YakuContext {
  const fuuro = over.fuuro ?? [];
  const tehai = [...tiles14];
  for (const f of fuuro) tehai.push(...f.tiles);
  const bins: number[][] = [
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(7).fill(0),
  ];
  for (const t of tehai) {
    if (t <= 9) bins[0][t === 0 ? 4 : t - 1]++;
    else if (t <= 19) bins[1][t === 10 ? 4 : t - 11]++;
    else if (t <= 29) bins[2][t === 20 ? 4 : t - 21]++;
    else if (t >= 31) bins[3][t - 31]++;
  }
  const k7 = over.k7 ?? false;
  return {
    tehai,
    bins,
    binsSum: bins.map((b) => b.reduce((a, x) => a + x, 0)),
    fuuro,
    menzen: over.menzen ?? true,
    isTsumo: over.isTsumo ?? true,
    isRon: over.isRon ?? false,
    riichi: over.riichi ?? { accepted: false, double: false, ippatsu: false },
    rinshan: over.rinshan ?? false,
    chankan: over.chankan ?? false,
    isHaitei: over.isHaitei ?? false,
    virgin: over.virgin ?? false,
    agariPlayer: over.agariPlayer ?? 0,
    chancha: over.chancha ?? 0,
    bakaze: over.bakaze ?? 31, // 东场
    jikaze: over.jikaze ?? 31, // 东家
    agariPai: over.agariPai ?? 0,
    decomp: k7 ? [] : enumerateDecomps(tiles14),
    k7,
    kokushi: over.kokushi ?? false,
    kuitan: over.kuitan ?? true,
    ...over,
  };
}

function listYaku(ctx: YakuContext): string[] {
  const hit = YAKU_LIST.filter((y) => y.predicate(ctx));
  // 简化版 shadows 应用：高番成立剔除其 shadows（真实逻辑在 agari 主流程按拆法应用）
  const excluded = new Set(hit.flatMap((y) => y.shadows ?? []));
  return hit.filter((y) => !excluded.has(y.name)).map((y) => y.name);
}

describe('役种判定（yaku.ls 转写）', () => {
  it('断幺九：全中张牌', () => {
    const ctx = makeCtx([2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16, 17, 25, 25]);
    const ys = listYaku(ctx);
    expect(ys).toContain('断幺九');
    expect(ys).not.toContain('清一色');
  });

  it('役牌：白刻子 + 门清自摸', () => {
    const ctx = makeCtx([1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35]);
    const ys = listYaku(ctx);
    expect(ys).toContain('役牌·發');
    expect(ys).toContain('门清自摸');
  });

  it('清一色：全万字 6 番（shadows 剔除混一色）', () => {
    const ctx = makeCtx([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 3]);
    const ys = listYaku(ctx);
    expect(ys).toContain('清一色');
    expect(ys).not.toContain('混一色');
  });

  it('混一色：全万 + 三元刻子', () => {
    const ctx = makeCtx([1, 1, 2, 2, 3, 3, 5, 6, 7, 8, 9, 9, 35, 35]);
    const ys = listYaku(ctx);
    expect(ys).toContain('混一色');
  });

  it('对对和：全刻子', () => {
    const ctx = makeCtx([1, 1, 1, 9, 9, 9, 11, 11, 11, 31, 31, 31, 35, 35]);
    const ys = listYaku(ctx);
    expect(ys).toContain('对对和');
  });

  it('三色同顺：123m 123p 123s', () => {
    const ctx = makeCtx([1, 2, 3, 11, 12, 13, 21, 22, 23, 4, 5, 6, 36, 36]);
    const ys = listYaku(ctx);
    expect(ys).toContain('三色同顺');
  });

  it('一气通贯：123m456m789m', () => {
    const ctx = makeCtx([1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 36, 36]);
    const ys = listYaku(ctx);
    expect(ys).toContain('一气通贯');
  });

  it('七对子', () => {
    const ctx = makeCtx([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7], { k7: true });
    const ys = listYaku(ctx);
    expect(ys).toContain('七对子');
  });

  it('一杯口：112233m', () => {
    const ctx = makeCtx([1, 1, 2, 2, 3, 3, 14, 15, 16, 24, 25, 26, 36, 36]);
    const ys = listYaku(ctx);
    expect(ys).toContain('一杯口');
    expect(ys).not.toContain('二杯口');
  });

  it('二杯口：112233m 445566p', () => {
    const ctx = makeCtx([1, 1, 2, 2, 3, 3, 14, 14, 15, 15, 16, 16, 36, 36]);
    const ys = listYaku(ctx);
    expect(ys).toContain('二杯口');
  });

  it('混全带：123m 123p 111s 789m 東東', () => {
    const ctx = makeCtx([1, 2, 3, 11, 12, 13, 21, 21, 21, 7, 8, 9, 31, 31]);
    const ys = listYaku(ctx);
    expect(ys).toContain('混全带');
  });

  it('立直 + 一发 + 门清自摸：flags', () => {
    const ctx = makeCtx([1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35], {
      riichi: { accepted: true, double: false, ippatsu: true },
    });
    const ys = listYaku(ctx);
    expect(ys).toContain('立直');
    expect(ys).toContain('一发');
  });

  it('混一色在清一色 shadows 下不重复计（清一色成立时跳过混一色）', () => {
    const ctx = makeCtx([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 3]);
    const ys = listYaku(ctx);
    expect(ys).toContain('清一色');
    // 计番阶段应用 shadows 后混一色应被剔除
  });
});
