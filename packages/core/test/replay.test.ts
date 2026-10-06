import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  generalById,
  aiPlan,
  createGame,
  replayGame,
  resolveRules,
  step,
  type Action,
  type ReplayData,
  type SeatConfig,
} from '../src/index';

const SEATS: SeatConfig[] = [0, 1, 2, 3].map((i) => ({
  name: `AI${i}`,
  generalId: 'gen-guanyu',
  isAI: true,
}));

/** 让 4 个 AI 自行对打若干步，返回状态与录制数据（按局归档，与服务器录制逻辑一致） */
function playAndRecord(seed: number, steps: number): { final: ReturnType<typeof createGame>; replay: ReplayData } {
  // 与 replayGame 默认一致：按武将还原技能（否则录制/重放番数会不一致）
  const skillsOf = (seat: number) => generalById(SEATS[seat]?.generalId ?? '')?.skills ?? [];
  let s = createGame(SEATS, { seed, rules: resolveRules() });
  const rounds: ReplayData['rounds'] = [];
  let actions: { seat: number; action: Action }[] = [];
  let cur = { round: s.round, dealer: s.dealer };

  const archive = (): void => {
    if (actions.length > 0) rounds.push({ ...cur, actions: [...actions] });
    actions = [];
  };

  for (let i = 0; i < steps && s.phase === 'playing'; i++) {
    // 先关闭响应窗口（无人荣和时直接 pass）
    if (s.lastDiscard || s.pendingKakan) {
      const r0 = step(s, { type: 'pass' }, { skillsOf });
      if (!r0.error) actions.push({ seat: s.current, action: { type: 'pass' } });
      s = r0.state;
      if (s.phase === 'ended') {
        archive();
        const next = advanceRound(s);
        if (next === s) break;
        s = next;
        cur = { round: s.round, dealer: s.dealer };
        continue;
      }
    }
    for (const a of aiPlan(s, s.current)) {
      const seat = s.current;
      const r = step(s, a, { skillsOf });
      if (!r.error) actions.push({ seat, action: a });
      s = r.state;
      if (s.phase !== 'playing') break;
    }
    if (s.phase === 'ended') {
      archive();
      const next = advanceRound(s);
      if (next === s) break;
      s = next;
      cur = { round: s.round, dealer: s.dealer };
    }
  }
  archive(); // 进行中的局也要归档（回放可复现到当前步）

  return {
    final: s,
    replay: { id: 'test', roomId: 'test', createdAt: 0, seats: SEATS, rules: s.rules, seed, rounds },
  };
}

describe('录像回放（引擎纯函数 + action 驱动）', () => {
  it('重放可完整复现对局状态（分数 / 弃牌 / 手牌）', () => {
    const { final, replay } = playAndRecord(2024, 300);
    const totalActions = replay.rounds.reduce((n, r) => n + r.actions.length, 0);
    expect(totalActions).toBeGreaterThan(50); // 确实录到了动作
    expect(replay.rounds.length).toBeGreaterThanOrEqual(1);

    let steps = 0;
    const replayed = replayGame(replay, () => {
      steps++;
    });

    expect(steps).toBe(totalActions);
    expect(replayed.players.map((p) => p.score)).toEqual(final.players.map((p) => p.score));
    expect(replayed.players.map((p) => p.discards.length)).toEqual(final.players.map((p) => p.discards.length));
    expect(replayed.players.map((p) => p.hand.length)).toEqual(final.players.map((p) => p.hand.length));
    expect(replayed.players.map((p) => p.openMelds.length)).toEqual(final.players.map((p) => p.openMelds.length));
    expect(replayed.turnCount).toBe(final.turnCount);
  });

  it('同一录像重放两次结果一致（确定性）', () => {
    const { replay } = playAndRecord(7, 200);
    const a = replayGame(replay);
    const b = replayGame(replay);
    expect(JSON.stringify(a.players.map((p) => p.score))).toBe(JSON.stringify(b.players.map((p) => p.score)));
    expect(a.wall.length).toBe(b.wall.length);
  });
});
