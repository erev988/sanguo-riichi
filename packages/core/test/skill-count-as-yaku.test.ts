import { describe, expect, it } from 'vitest';
import { step } from '../src/engine';
import { ALL_GENERALS, type Skill } from '../src/index';
import { dummyState } from './helpers';

/** 测试技能：给 +1 番，且番数可充当和牌资格 */
const giveHan: Skill = {
  id: 'test-count-as-yaku',
  name: '番数当役',
  desc: '测试用：+1 番且番数可充当和牌资格',
  countsAsYaku: true,
  onAgaru: (ctx) => {
    ctx.winInfo.han += 1;
  },
};

/** 测试技能：声明资格但实际不给番 */
const giveNothing: Skill = {
  id: 'test-count-as-yaku-zero',
  name: '番数当役（不给番）',
  desc: '测试用：不给番数',
  countsAsYaku: true,
};

/** 无役形：123m 456m 789p 456p + 南（荣和南） */
function noYakuSetup() {
  const s = dummyState();
  s.players[0].hand = [1, 2, 3, 4, 5, 6, 17, 18, 19, 14, 15, 16, 32];
  s.lastDiscard = { player: 1, tile: 32 };
  return s;
}

const RON = { type: 'ron', player: 0, tile: 32, from: 1 } as const;

describe('技能番数充当和牌资格（countsAsYaku，默认不启用）', () => {
  it('无役 + 技能给出番数 → 可以和（番数 1）', () => {
    const r = step(noYakuSetup(), RON, { skillsOf: (seat: number) => (seat === 0 ? [giveHan] : []) });
    expect(r.error).toBeFalsy();
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.han).toBe(1);
  });

  it('无役 + 技能没给出番数 → 不能和', () => {
    const r = step(noYakuSetup(), RON, { skillsOf: (seat: number) => (seat === 0 ? [giveNothing] : []) });
    expect(r.error).toBeTruthy();
  });

  it('无役 + 宝牌番数 + countsAsYaku → 可以和（宝牌可充当资格）', () => {
    const s = noYakuSetup();
    s.doraIndicators = [31]; // 指示東 → 宝牌南（手牌 2 张南）
    s.doraCount = 1;
    const r = step(s, RON, { skillsOf: (seat: number) => (seat === 0 ? [giveNothing] : []) });
    expect(r.error).toBeFalsy();
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.han).toBe(2); // 2 张宝牌
  });

  it('没有该能力的普通玩家：无役仍然不能和（保持现状）', () => {
    const r = step(noYakuSetup(), RON, { skillsOf: () => [] });
    expect(r.error).toBeTruthy();
  });

  it('现有武将技能均未启用 countsAsYaku（需要时再在数据里标注）', () => {
    for (const g of ALL_GENERALS) {
      for (const sk of g.skills) {
        expect(sk.countsAsYaku ?? false).toBe(false);
      }
    }
  });
});
