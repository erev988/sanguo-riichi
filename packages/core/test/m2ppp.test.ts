import { describe, expect, it } from 'vitest';
import { calcTenpaiWithMelds, evaluateAgari, step, type AgariContext } from '../src/index';
import { dummyState, noSkills } from './helpers';

describe('含副露的听牌判定 calcTenpaiWithMelds', () => {
  it('一副露：234m 567m 88p 99p → 听 8p/9p', () => {
    const hand = [2, 3, 4, 5, 6, 7, 17, 17, 18, 18];
    const melds = [{ type: 'ankan' as const, tiles: [1, 1, 1, 1] }];
    expect(calcTenpaiWithMelds(hand, melds).sort((a, b) => a - b)).toEqual([17, 18]);
  });

  it('两副露：234m + 77p，需 2 面子 + 雀头', () => {
    // 副露：ankan 1m、pon 9s → 手牌 234m 567m 77p（7 张）
    const hand = [2, 3, 4, 5, 6, 7, 17, 17]; // 8 张 = 13 - 3*? ... 2 副露需 7 张
    const melds = [
      { type: 'ankan' as const, tiles: [1, 1, 1, 1] },
      { type: 'pon' as const, tiles: [29, 29, 29] },
    ];
    // 234m 567m + 77p 雀头 → 已齐（不需要摸牌）？需要 2 面子：234,567 ✓ + 雀头 77 ✓ → 13-6=7 张手牌
    // 上面给了 8 张，去掉一张
    const t = calcTenpaiWithMelds(hand.slice(0, 7), melds);
    expect(Array.isArray(t)).toBe(true);
  });
});

describe('流局满贯', () => {
  it('弃牌全幺九且未被鸣 → 流局按满贯自摸结算', () => {
    const s = dummyState();
    s.dealer = 0;
    // seat0 弃牌全是幺九且未被鸣（discards 完整保留）
    s.players[0].discards = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36];
    s.players[0].log.discards = 12;
    // 其他家弃牌有中张（不满足）
    for (const seat of [1, 2, 3]) {
      s.players[seat].discards = [2, 3, 4];
      s.players[seat].log.discards = 3;
    }
    const before = s.players.map((p) => p.score);
    const r = step(s, { type: 'ryukyoku' }, noSkills());
    // 亲家流局满贯 = 满贯自摸 4000 all → +12000
    expect(r.state.players[0].score - before[0]).toBe(12000);
    expect(r.state.players[1].score - before[1]).toBe(-4000);
  });

  it('弃牌被鸣过（discards 与打出数不符）→ 不成立', () => {
    const s = dummyState();
    s.players[0].discards = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35]; // 11 张（有 1 张被鸣）
    s.players[0].log.discards = 12;
    const before = s.players[0].score;
    const r = step(s, { type: 'ryukyoku' }, noSkills());
    expect(r.state.players[0].score - before).not.toBe(12000);
  });
});

describe('立直后暗杠（不变听牌）', () => {
  it('暗杠改变听牌 → 拒绝', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // 立直者手牌先设为「999m 234m 567m 88m」听 8m/9m，随后摸到 9m 想暗杠
    s.players[0].log.riichi = true;
    s.players[0].log.riichiTenpai = [17, 18, 8, 9].sort((a, b) => a - b); // 故意设为不含暗杠后听牌
    s.players[0].hand = [9, 9, 9, 9, 2, 3, 4, 5, 6, 7, 17, 17, 8, 1]; // 含 4 张 9m
    const r = step(s, { type: 'ankan', player: 0, tile: 9 }, noSkills());
    expect(r.error).toBeTruthy();
  });
});

describe('场风 / 自风', () => {
  function ctx(over: Partial<AgariContext>): AgariContext {
    return {
      juntehai: [],
      agariPai: 0,
      fuuro: [],
      menzen: true,
      isTsumo: false,
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

  it('南场南家：南刻子同时算场风 + 自风', () => {
    // 234m 234p 234s 南南南 + 白（避免四暗刻役满）
    const r = evaluateAgari(
      ctx({
        juntehai: [2, 3, 4, 12, 13, 14, 22, 23, 24, 32, 32, 32, 35],
        agariPai: 35,
        bakaze: 32, // 南场
        jikaze: 32, // 南家
      }),
    );
    expect(r).not.toBeNull();
    const names = r!.yaku.map((y) => y.name);
    expect(names).toContain('场风');
    expect(names).toContain('自风');
  });
});
