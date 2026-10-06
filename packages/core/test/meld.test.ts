import { describe, expect, it } from 'vitest';
import { step } from '../src/engine';
import { dummyState, noSkills } from './helpers';

/** 造一个「seat0 刚打出一张牌」的局面 */
function afterDiscard0(tile: number) {
  const s = dummyState();
  s.awaiting = 'discard';
  s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, tile];
  return step(s, { type: 'discard', tile }, noSkills());
}

describe('副露：吃', () => {
  it('下家吃 5m（手牌 3m4m）→ 副露成立、手牌 11 张、回合跳到吃牌者', () => {
    const r1 = afterDiscard0(5);
    expect(r1.error).toBeFalsy();
    r1.state.players[1].hand = [3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, 36]; // 13 张含 3m4m

    const r2 = step(r1.state, { type: 'chii', player: 1, tile: 5, tiles: [3, 4] }, noSkills());
    expect(r2.error).toBeFalsy();
    expect(r2.state.players[1].openMelds.length).toBe(1);
    expect(r2.state.players[1].openMelds[0].tiles).toEqual([3, 4, 5]);
    expect(r2.state.players[1].openMelds[0].from).toBe(0);
    expect(r2.state.players[1].hand.length).toBe(11);
    expect(r2.state.current).toBe(1);
    expect(r2.state.awaiting).toBe('discard'); // 吃后直接打牌
    expect(r2.state.players[0].discards.includes(5)).toBe(false); // 被鸣的牌从弃牌区移除
    expect(r2.effects.some((e) => e.type === 'called')).toBe(true);
  });

  it('吃后打牌 → 回合推进到吃牌者的下家', () => {
    const r1 = afterDiscard0(5);
    r1.state.players[1].hand = [3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, 36];
    const r2 = step(r1.state, { type: 'chii', player: 1, tile: 5, tiles: [3, 4] }, noSkills());
    const r3 = step(r2.state, { type: 'discard', tile: 14 }, noSkills());
    expect(r3.error).toBeFalsy();
    expect(r3.state.current).toBe(2);
    expect(r3.state.awaiting).toBe('draw');
  });

  it('非下家不能吃', () => {
    const r1 = afterDiscard0(5);
    r1.state.players[2].hand = [3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, 36];
    const r2 = step(r1.state, { type: 'chii', player: 2, tile: 5, tiles: [3, 4] }, noSkills());
    expect(r2.error).toBeTruthy();
  });

  it('手牌不足 / 牌型不连续 → 拒绝', () => {
    const r1 = afterDiscard0(5);
    r1.state.players[1].hand = [3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, 36];
    expect(step(r1.state, { type: 'chii', player: 1, tile: 5, tiles: [3, 7] }, noSkills()).error).toBeTruthy();
    expect(step(r1.state, { type: 'chii', player: 1, tile: 5, tiles: [3, 13] }, noSkills()).error).toBeTruthy();
  });
});

describe('副露：碰', () => {
  it('任意家碰：seat2 碰 seat0 的 白 → 副露成立、回合跳到 seat2', () => {
    const r1 = afterDiscard0(35);
    r1.state.players[2].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35]; // 含 2 张白
    const r2 = step(r1.state, { type: 'pon', player: 2, tile: 35 }, noSkills());
    expect(r2.error).toBeFalsy();
    expect(r2.state.players[2].openMelds[0].tiles).toEqual([35, 35, 35]);
    expect(r2.state.players[2].hand.length).toBe(11);
    expect(r2.state.current).toBe(2);
    expect(r2.state.awaiting).toBe('discard');
  });

  it('手牌只有 1 张 → 不能碰', () => {
    const r1 = afterDiscard0(35);
    r1.state.players[2].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 36, 37];
    expect(step(r1.state, { type: 'pon', player: 2, tile: 35 }, noSkills()).error).toBeTruthy();
  });
});

describe('副露：规则限制', () => {
  it('立直后不能副露', () => {
    const r1 = afterDiscard0(5);
    r1.state.players[1].log.riichi = true;
    r1.state.players[1].hand = [3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 35, 36];
    expect(step(r1.state, { type: 'chii', player: 1, tile: 5, tiles: [3, 4] }, noSkills()).error).toBeTruthy();
  });

  it('不能副露自己打出的牌', () => {
    const r1 = afterDiscard0(5);
    r1.state.players[0].hand = [5, 5, 3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35];
    expect(step(r1.state, { type: 'pon', player: 0, tile: 5 }, noSkills()).error).toBeTruthy();
  });
});

describe('暗杠', () => {
  it('手里 4 张相同牌 → 暗杠成立并岭上摸牌', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [5, 5, 5, 5, 2, 3, 4, 14, 15, 16, 31, 31, 35, 36]; // 4 张 5m
    const wallBefore = s.wall.length;
    const r = step(s, { type: 'ankan', player: 0, tile: 5 }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.players[0].openMelds[0].type).toBe('ankan');
    expect(r.state.players[0].openMelds[0].tiles).toEqual([5, 5, 5, 5]);
    expect(r.state.players[0].hand.length).toBe(11); // 14 - 4 + 1（岭上）
    expect(r.state.wall.length).toBe(wallBefore - 1);
    expect(r.state.awaiting).toBe('discard');
  });

  it('不足 4 张 → 拒绝', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [5, 5, 5, 2, 3, 4, 14, 15, 16, 31, 31, 35, 36, 37];
    expect(step(s, { type: 'ankan', player: 0, tile: 5 }, noSkills()).error).toBeTruthy();
  });
});
