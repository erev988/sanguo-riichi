import { describe, expect, it } from 'vitest';
import {
  createGame,
  deriveSeed,
  generalById,
  legalActions,
  normalizeSeed,
  rngFromSeed,
  step,
  type Action,
  type SeatConfig,
} from '../src/index';

const SEATS: SeatConfig[] = [0, 1, 2, 3].map((i) => ({
  name: `P${i}`,
  generalId: 'gen-guanyu',
  isAI: false,
}));

const SEED_A = '0123456789abcdef0123456789abcdef'; // 128 位 hex
const SEED_B = 'fedcba9876543210fedcba9876543210';

describe('发牌种子与随机性（防破解）', () => {
  it('同种子 → 完全相同牌山（录像可复现）', () => {
    const a = createGame(SEATS, { seed: SEED_A });
    const b = createGame(SEATS, { seed: SEED_A });
    expect(a.players.map((p) => p.hand.join(','))).toEqual(b.players.map((p) => p.hand.join(',')));
    expect(a.wall.length).toBe(b.wall.length);
    expect(a.doraIndicators).toEqual(b.doraIndicators);
  });

  it('不同种子 → 不同牌山（不可预测）', () => {
    const a = createGame(SEATS, { seed: SEED_A });
    const b = createGame(SEATS, { seed: SEED_B });
    expect(a.players[0].hand.join(',')).not.toBe(b.players[0].hand.join(','));
  });

  it('种子空间足够大，无法离线枚举', () => {
    expect(normalizeSeed(SEED_A)).toHaveLength(32);
    expect(normalizeSeed(2024)).toHaveLength(32); // 数字种子（测试用）也展开成 128 位
    expect(deriveSeed(SEED_A)).toHaveLength(64); // 派生种子为 256 位
  });

  it('每局派生新种子：确定性且与旧种子不同', () => {
    const s = createGame(SEATS, { seed: SEED_A });
    const n1 = deriveSeed(s.seed);
    const n2 = deriveSeed(s.seed);
    expect(n1).toBe(n2); // 同输入 → 同输出（可复现）
    expect(n1).not.toBe(s.seed); // 但不是原种子
  });

  it('sfc32 输出均匀落在 [0,1) 且不退化', () => {
    const rng = rngFromSeed(SEED_A);
    const vals = Array.from({ length: 2000 }, () => rng());
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(Math.min(...vals)).toBeLessThan(0.1);
    expect(Math.max(...vals)).toBeGreaterThan(0.9);
  });

  it('牌山只含合法牌 136 张（34 种 ×4，含赤宝）', () => {
    const s = createGame(SEATS, { seed: SEED_A });
    const all = [
      ...s.wall,
      ...s.rinshanWall,
      ...s.doraIndicators,
      ...s.uraIndicators,
      ...s.players.flatMap((p) => p.hand),
    ];
    expect(all.length).toBe(136);
    expect(all.filter((t) => t === 0 || t === 10 || t === 20).length).toBe(3); // 3 张赤宝
  });
});

describe('牌序固定：开局即定，全程不换牌/不重排', () => {
  it('整局牌山始终等于初始牌山的前缀（只截取，从不重排或塞牌）', () => {
    const s0 = createGame(SEATS, { seed: SEED_A });
    const wall0 = [...s0.wall];
    const rinshan0 = [...s0.rinshanWall];
    let s = s0;
    let steps = 0;
    let draws = 0;
    while (s.phase === 'playing' && steps++ < 4000) {
      const acts = legalActions(s);
      const agari = acts.find((a) => a.type === 'tsumo' || a.type === 'ron');
      const drawAct = acts.find((a) => a.type === 'draw');
      const hand = s.players[s.current].hand;
      const act: Action | null =
        agari ??
        drawAct ??
        (s.awaiting === 'discard'
          ? { type: 'discard', tile: hand[hand.length - 1] }
          : (acts.find((a) => a.type === 'pass') ?? null));
      if (!act) break;
      if (act.type === 'discard') draws++;
      const r = step(s, act, { skillsOf: () => [] });
      s = r.state;
      // ★ 核心断言：牌山只能被「从尾部取走」，内容顺序永远不变
      expect(s.wall).toEqual(wall0.slice(0, s.wall.length));
      expect(s.rinshanWall).toEqual(rinshan0.slice(0, s.rinshanWall.length));
    }
    expect(steps).toBeGreaterThan(10); // 确实推进了整局
  });

  it('技能不会改动牌序（带技能整局跑完，牌山仍为初始前缀）', () => {
    const skilled = SEATS.map((x, i) => ({ ...x, generalId: ['gen-guanyu', 'gen-zhangliao', 'gen-sunquan', 'gen-jushou'][i] }));
    const s0 = createGame(skilled, { seed: SEED_B });
    const wall0 = [...s0.wall];
    const allSkills = s0.players.map((p) => generalById(p.generalId)?.skills ?? []);
    let s = s0;
    let steps = 0;
    while (s.phase === 'playing' && steps++ < 4000) {
      const acts = legalActions(s);
      const agari = acts.find((a) => a.type === 'tsumo' || a.type === 'ron');
      const drawAct = acts.find((a) => a.type === 'draw');
      const hand = s.players[s.current].hand;
      const act: Action | null =
        agari ??
        drawAct ??
        (s.awaiting === 'discard'
          ? { type: 'discard', tile: hand[hand.length - 1] }
          : (acts.find((a) => a.type === 'pass') ?? null));
      if (!act) break;
      const r = step(s, act, { skillsOf: (st) => allSkills[st.current] ?? [] });
      s = r.state;
      expect(s.wall).toEqual(wall0.slice(0, s.wall.length));
    }
    expect(steps).toBeGreaterThan(10);
  });
});
