import { describe, expect, it } from 'vitest';
import type { AgaruContext, RyukyokuContext } from '../src/skills';
import { jianying, renjie, wusheng } from '../src/skills';
import { dummyState, mentsu } from './helpers';

function agaruCtx(over: Partial<AgaruContext> = {}): AgaruContext {
  return {
    seat: 0,
    state: dummyState(),
    winInfo: { kind: 'tsumo', yaku: [], han: 1, fu: 30 },
    handMelds: [],
    openMelds: [],
    discards: 0,
    discardTiles: [],
    payments: [],
    skillLog: [],
    ...over,
  };
}

function ryukyokuCtx(over: Partial<RyukyokuContext> = {}): RyukyokuContext {
  return { seat: 0, state: dummyState(), tenpai: false, payments: [], ...over };
}

describe('技能·武圣（关羽：万面子加番）', () => {
  it('每个万字面子 +1 番（副露 + 手牌面子都算）', () => {
    const ctx = agaruCtx({
      handMelds: [mentsu('chii', [0, 1, 2]), mentsu('kan', [0, 0, 0, 0])],
      openMelds: [mentsu('pon', [11, 11, 11])], // 1p 刻子，非万面子
    });
    wusheng.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(3); // 基础1番 + 2个万面子
  });

  it('没有万面子时不加番', () => {
    const ctx = agaruCtx({ handMelds: [mentsu('chii', [9, 10, 11])] });
    wusheng.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(1);
  });
});

describe('技能·渐营（沮授：连续三张同类牌）', () => {
  it('用户示例：3m 9m 8m | 1s 1p 3s | 9s 4s 1p → +2 番', () => {
    // 3m=3, 9m=9, 8m=8 | 1s=21, 1p=11, 3s=23 | 9s=29, 4s=24, 1p=11
    const ctx = agaruCtx({ discardTiles: [3, 9, 8, 21, 11, 23, 29, 24, 11] });
    jianying.onAgaru!(ctx);
    // 窗口[3m,9m,8m] 全万 ✓；窗口[3s,9s,4s] 全索 ✓ → +2（基础 1 番 → 3）
    expect(ctx.winInfo.han).toBe(1 + 2);
  });

  it('不足三张同类 → 不加番（1m 1p 1s）', () => {
    const ctx = agaruCtx({ discardTiles: [1, 11, 21] });
    jianying.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(1);
  });

  it('字牌连续三张也算一类（東 白 中）', () => {
    const ctx = agaruCtx({ discardTiles: [31, 35, 37] });
    jianying.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(1 + 1);
  });

  it('四张同类 → 两个滑动窗口（+2）', () => {
    const ctx = agaruCtx({ discardTiles: [1, 2, 3, 4] }); // 1m2m3m4m
    jianying.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(1 + 2);
  });

  it('赤宝牌按所属花色计入（0m 与 5m 同为万）', () => {
    const ctx = agaruCtx({ discardTiles: [0, 5, 9] }); // 赤5m 5m 9m → 全万
    jianying.onAgaru!(ctx);
    expect(ctx.winInfo.han).toBe(1 + 1);
  });
});

describe('技能·忍戒（司马懿：荒牌征收）', () => {
  it('其余三家各付 2000 点给技能拥有者', () => {
    const ctx = ryukyokuCtx({ seat: 1 });
    renjie.onRyukyoku!(ctx);
    expect(ctx.payments).toEqual([
      { from: 0, to: 1, amount: 2000 },
      { from: 2, to: 1, amount: 2000 },
      { from: 3, to: 1, amount: 2000 },
    ]);
  });

  it('不影响已有的基础罚符', () => {
    const ctx = ryukyokuCtx({ seat: 3, payments: [{ from: 0, to: -1, amount: 1000 }] });
    renjie.onRyukyoku!(ctx);
    expect(ctx.payments[0]).toEqual({ from: 0, to: -1, amount: 1000 });
    expect(ctx.payments.filter((p) => p.to === 3).length).toBe(3);
  });
});
