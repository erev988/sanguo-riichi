import { describe, expect, it } from 'vitest';
import { step } from '../src/engine';
import { dummyState, noSkills } from './helpers';

describe('立直规则', () => {
  it('打出一张后不听牌 → 拒绝立直', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // 手牌 14 张：乱牌，打出任意一张几乎必然不听（用一手明显非听牌形）
    const r = step(
      s,
      { type: 'discard', tile: s.players[0].hand[0], riichi: true },
      noSkills(),
    );
    expect(r.error).toBeTruthy();
    expect(s.players[0].log.riichi).toBe(false);
  });

  it('门清听牌立直 → 接受，扣 1000，场上 1 根立直棒', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // 123m 456p 456s 發發發 白（13 张）听白；打出摸到的 5m 立直
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 5];
    const before = s.players[0].score;
    const r = step(s, { type: 'discard', tile: 5, riichi: true }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.players[0].log.riichi).toBe(true);
    expect(r.state.players[0].score).toBe(before - 1000);
    expect(r.state.riichiSticks).toBe(1);
    expect(r.state.players[0].hand.length).toBe(13);
  });

  it('副露后不能立直', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].openMelds = [{ type: 'pon', tiles: [1, 1, 1] }];
    const r = step(s, { type: 'discard', tile: s.players[0].hand[0], riichi: true }, noSkills());
    expect(r.error).toBeTruthy();
  });
});
