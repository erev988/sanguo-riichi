import { describe, expect, it } from 'vitest';
import { advanceRound, computePayments, createGame, DEFAULT_RULES, type WinInfo } from '../src/index';
import { dummyState } from './helpers';

function ron(han: number, fu: number, kiriageMangan: boolean): number {
  const w: WinInfo = { kind: 'ron', yaku: [], han, fu };
  const p = computePayments(w, 1, 0, 2, { kiriageMangan });
  return p.find((x) => x.to === 1)!.amount;
}

describe('切上满贯（可配置）', () => {
  it('默认关闭：4 番 30 符 = 7700（不满贯）', () => {
    expect(ron(4, 30, false)).toBe(7700);
  });

  it('开启后：4 番 30 符 = 8000（切上满贯）', () => {
    expect(ron(4, 30, true)).toBe(8000);
  });

  it('默认关闭：3 番 60 符 = 7700', () => {
    expect(ron(3, 60, false)).toBe(7700);
  });

  it('开启后：3 番 60 符 = 8000', () => {
    expect(ron(3, 60, true)).toBe(8000);
  });

  it('原本的满贯门槛不受影响：4 番 40 符 / 3 番 70 符', () => {
    expect(ron(4, 40, false)).toBe(8000);
    expect(ron(3, 70, false)).toBe(8000);
  });
});

describe('默认规则参数', () => {
  it('初始点数 30000、返点 40000', () => {
    expect(DEFAULT_RULES.initialScore).toBe(30000);
    expect(DEFAULT_RULES.origin).toBe(40000);
  });

  it('createGame 默认每人 30000 点', () => {
    const seats = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, generalId: 'gen-man', isAI: false }));
    const g = createGame(seats);
    expect(g.players.every((p) => p.score === 30000)).toBe(true);
    expect(g.rules.origin).toBe(40000);
  });

  it('可覆盖规则（如开切上满贯）', () => {
    const seats = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, generalId: 'gen-man', isAI: false }));
    const g = createGame(seats, { rules: { kiriageMangan: true, initialScore: 50000 } });
    expect(g.players[0].score).toBe(50000);
    expect(g.rules.kiriageMangan).toBe(true);
  });
});

describe('延长战（返点 40000）', () => {
  function endedAtSouth4(maxScore: number) {
    const s = dummyState();
    s.phase = 'ended';
    s.reason = 'normal';
    s.round = { wind: 'south', round: 4, honba: 0 };
    s.dealer = 0;
    s.lastResult = { winners: [1], tenpai: [] }; // 子家和牌 → 非连庄
    s.players[0].score = maxScore;
    return s;
  }

  it('南 4 结束无人 ≥ 40000 → 进入延长战（西场）', () => {
    const next = advanceRound(endedAtSouth4(39000));
    expect(next).not.toBe(undefined);
    expect(next.phase).toBe('playing');
    expect(next.round.wind).toBe('west');
    expect(next.round.round).toBe(1);
  });

  it('南 4 结束有人 ≥ 40000 → 终局（不再开新局）', () => {
    const s = endedAtSouth4(41000);
    const next = advanceRound(s);
    expect(next).toBe(s); // 返回原状态表示整场结束
  });

  it('西 4 结束 → 无论分数均终局', () => {
    const s = dummyState();
    s.phase = 'ended';
    s.reason = 'ryukyoku';
    s.round = { wind: 'west', round: 4, honba: 0 };
    s.lastResult = { winners: [], tenpai: [false, false, false, false] };
    expect(advanceRound(s)).toBe(s);
  });

  it('延长战中达成返点 → 提前终局', () => {
    const s = dummyState();
    s.phase = 'ended';
    s.reason = 'normal';
    s.round = { wind: 'west', round: 2, honba: 0 };
    s.lastResult = { winners: [1], tenpai: [] };
    s.players[1].score = 42000;
    expect(advanceRound(s)).toBe(s);
  });
});
