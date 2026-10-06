import { describe, expect, it } from 'vitest';
import { step } from '../src/engine';
import { luanji } from '../src/skills';
import { dummyState, noSkills } from './helpers';

const LUANJI = (seat: number) => (seat === 0 ? [luanji] : []);

describe('袁绍「乱击」：可无役和牌；无役 -1 番，有役 +1 番', () => {
  it('有役和牌 → 番数 +1（立直 + 门清自摸 2 番 → 3 番）', () => {
    const s = dummyState();
    s.turnCount = 10;
    s.awaiting = 'discard';
    s.players[0].log.riichi = true;
    // 123m 456p 567s 南南南 中中：立直 1 + 门清自摸 1 = 2 番（无其他役）
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 25, 26, 27, 32, 32, 32, 33, 33];
    const r = step(s, { type: 'tsumo' }, { skillsOf: LUANJI });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.han).toBe(3); // 2 + 1
    expect(agaru.skills).toEqual([{ skill: '乱击', han: 1, fu: 0 }]);
  });

  it('无役 → 也能和牌（forceWin），番数 -1 被钳制为 0 番', () => {
    const s = dummyState();
    // 无役形：123m 456m 789p 456p + 南（荣和南，门清荣和不算役）
    s.players[0].hand = [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32];
    s.lastDiscard = { player: 1, tile: 32 };
    const r = step(s, { type: 'ron', player: 0, tile: 32, from: 1 }, { skillsOf: LUANJI });
    expect(r.error).toBeFalsy(); // 无役也能和
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.han).toBe(0); // 0 + (-1) → 钳制 0，不会是负数
  });

  it('只有宝牌不算「有役」→ 走无役分支（-1 番）', () => {
    const s = dummyState();
    // 同上无役形，但翻开一张宝牌指示牌让手牌有宝牌（宝牌不是役）
    s.players[0].hand = [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32];
    s.lastDiscard = { player: 1, tile: 32 };
    s.doraIndicators = [31]; // 指示東 → 宝牌南（手牌有 1 张南 → 1 张宝牌）
    s.doraCount = 1;
    const r = step(s, { type: 'ron', player: 0, tile: 32, from: 1 }, { skillsOf: LUANJI });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    // 宝牌 1 张（+1 番）来自宝牌本身；乱击判定为"无役" → -1 番 → 净 0 番
    expect(agaru.han).toBe(0);
  });

  it('没有乱击的人，无役仍然不能和', () => {
    const s = dummyState();
    s.players[0].hand = [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32];
    s.lastDiscard = { player: 1, tile: 32 };
    const r = step(s, { type: 'ron', player: 0, tile: 32, from: 1 }, noSkills());
    expect(r.error).toBeTruthy();
  });
});
