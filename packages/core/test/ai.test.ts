import { describe, expect, it } from 'vitest';
import { aiPlan } from '../src/ai';
import { shanten } from '../src/index';
import { dummyState } from './helpers';

describe('AI 策略（向听最小化）', () => {
  it('摸牌阶段 → 摸牌', () => {
    const s = dummyState();
    s.awaiting = 'draw';
    expect(aiPlan(s, 0)).toEqual([{ type: 'draw' }]);
  });

  it('摸到和牌张 → 自摸', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // 123m456p456s發發發 白，摸到白
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35];
    expect(aiPlan(s, 0)).toEqual([{ type: 'tsumo' }]);
  });

  it('打牌选向听最小的牌（保留听牌形）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // 111m 222m 333m 78p 78s + 9s：打 7s 或 9s 都能保持听牌
    const hand = [1, 1, 1, 2, 2, 2, 3, 3, 3, 17, 18, 27, 28, 29];
    s.players[0].hand = [...hand];
    const plan = aiPlan(s, 0);
    expect(plan[0].type).toBe('discard');
    const tile = (plan[0] as { tile: number }).tile;
    const rest = [...hand];
    rest.splice(rest.indexOf(tile), 1);
    expect(shanten(rest)).toBe(0); // 打出后保持听牌
  });

  it('门清听牌 → 立直', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 1, 1, 2, 2, 2, 3, 3, 3, 17, 18, 27, 28, 29];
    const plan = aiPlan(s, 0);
    expect((plan[0] as { riichi?: boolean }).riichi).toBe(true);
  });

  it('有副露时不立直', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].openMelds = [{ type: 'pon', tiles: [1, 1, 1] }];
    s.players[0].hand = [2, 2, 2, 3, 3, 3, 17, 18, 27, 28, 29]; // 11 张 + 1 = 12
    const plan = aiPlan(s, 0);
    expect((plan[0] as { riichi?: boolean }).riichi).toBeFalsy();
  });
});
