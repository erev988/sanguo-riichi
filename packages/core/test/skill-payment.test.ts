import { describe, expect, it } from 'vitest';
import { step, type Skill } from '../src/index';
import { baolian, ganglie, tuxi, wanglie, wangzun, zhiheng } from '../src/skills';
import { dummyState, noSkills } from './helpers';

describe('张辽「突袭」：有人副露时付 500', () => {
  it('seat2 碰牌 → 付 seat1（张辽）500 点', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 5, 35, 35];
    const skillsOf = (seat: number): Skill[] => (seat === 1 ? [tuxi] : []);
    const r1 = step(s, { type: 'discard', tile: 35 }, { skillsOf });
    r1.state.players[2].hand = [35, 35, 1, 2, 3, 4, 12, 13, 14, 22, 23, 24, 15];
    const before = r1.state.players.map((p) => p.score);
    const r2 = step(r1.state, { type: 'pon', player: 2, tile: 35 }, { skillsOf });
    expect(r2.error).toBeFalsy();
    expect(r2.effects.some((e) => e.type === 'skill-pay')).toBe(true);
    expect(r2.state.players[2].score - before[2]).toBe(-500); // 副露者付
    expect(r2.state.players[1].score - before[1]).toBe(+500); // 张辽收
  });
});

describe('袁术「妄尊」：先制立直封锁 + 和牌收费', () => {
  const WANGZUN = (seat: number): Skill[] => (seat === 0 ? [wangzun] : []);

  it('先制立直 → 他人立直被拒', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // seat0 打北立直（听白）
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r1 = step(s, { type: 'discard', tile: 34, riichi: true }, { skillsOf: WANGZUN });
    expect(r1.error).toBeFalsy();
    expect(r1.state.riichiLockBy).toBe(0);
    expect(r1.state.players[0].log.firstRiichi).toBe(true);

    // seat1 想立直 → 被封锁
    const st = r1.state;
    st.players[1].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    st.awaiting = 'discard';
    st.current = 1;
    const r2 = step(st, { type: 'discard', tile: 34, riichi: true }, { skillsOf: WANGZUN });
    expect(r2.error).toContain('妄尊');
  });

  it('别家和牌 → 和牌者付袁术 1000（番数结算照常）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r1 = step(s, { type: 'discard', tile: 34, riichi: true }, { skillsOf: WANGZUN });
    expect(r1.error).toBeFalsy();
    // seat1 自摸和牌
    const st = r1.state;
    st.current = 1;
    st.awaiting = 'discard';
    st.players[1].hand = [2, 3, 4, 12, 13, 14, 22, 23, 24, 15, 15, 5, 6, 7];
    const r2 = step(st, { type: 'tsumo' }, { skillsOf: WANGZUN });
    expect(r2.error).toBeFalsy();
    const agaru = r2.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    // 和牌者（seat1）额外付袁术（seat0）1000
    expect(agaru.payments.some((p) => p.from === 1 && p.to === 0 && p.amount === 1000)).toBe(true);
  });

  it('袁术自己和牌 → 不触发（番数结算照常）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r1 = step(s, { type: 'discard', tile: 34, riichi: true }, { skillsOf: WANGZUN });
    const st = r1.state;
    st.current = 0;
    st.awaiting = 'discard';
    st.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35]; // 自摸白
    const r2 = step(st, { type: 'tsumo' }, { skillsOf: WANGZUN });
    const agaru = r2.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    // 不应有「和牌者付袁术 1000」的技能支付（自己和不触发）
    expect(agaru.payments.some((p) => p.to === 0 && p.amount === 1000 && p.from >= 0)).toBe(false);
  });
});

describe('董卓「暴敛」', () => {
  const BAOLIAN = (seat: number): Skill[] => (seat === 0 ? [baolian] : []);

  it('弃牌 ≤8 张时和牌 +3 番', () => {
    const s = dummyState();
    s.turnCount = 10;
    s.awaiting = 'discard';
    s.players[0].log.discards = 5;
    s.players[0].hand = [2, 3, 4, 12, 13, 14, 22, 23, 24, 15, 15, 5, 6, 7]; // 断幺形
    const r = step(s, { type: 'tsumo' }, { skillsOf: BAOLIAN });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    expect(agaru?.type === 'agaru' && agaru.han).toBeGreaterThanOrEqual(3); // 技能 +3
  });

  it('弃牌 >12 张时和牌 -2 番（不低于 0）', () => {
    const s = dummyState();
    s.turnCount = 20;
    s.awaiting = 'discard';
    s.players[0].log.discards = 14;
    s.players[0].hand = [2, 3, 4, 12, 13, 14, 22, 23, 24, 15, 15, 5, 6, 7];
    const withSkill = step(s, { type: 'tsumo' }, { skillsOf: BAOLIAN });
    const plain = step(s, { type: 'tsumo' }, noSkills());
    const h1 = withSkill.effects.find((e) => e.type === 'agaru');
    const h2 = plain.effects.find((e) => e.type === 'agaru');
    if (h1?.type !== 'agaru' || h2?.type !== 'agaru') throw new Error('未和牌');
    // 暴敛 >12 张：基础番 -2（且不低于 0）
    expect(h1.han).toBe(Math.max(0, h2.han - 2));
  });

  const TENPAI = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35];
  const NOTEN = [1, 4, 7, 11, 15, 19, 22, 25, 28, 31, 33, 35, 37];

  function ryukyokuSetup(dongzhuo: number[], others: number[][]) {
    const s = dummyState();
    s.players[0].hand = [...dongzhuo]; // 董卓
    for (let i = 0; i < 3; i++) s.players[i + 1].hand = [...others[i]];
    return s;
  }

  it('董卓听牌：所有人（不管听没听）各付 2000，且其他听牌者收不到罚符', () => {
    // 董卓听；seat2 也听（但收不到罚符）；seat1/3 不听
    const s = ryukyokuSetup(TENPAI, [NOTEN, TENPAI, NOTEN]);
    const before = s.players.map((p) => p.score);
    s.wall = []; // 荒牌流局的合法前提：牌山已耗尽
    const r = step(s, { type: 'ryukyoku' }, { skillsOf: BAOLIAN });
    // 董卓 +2000×3 = +6000（基础罚符被屏蔽，无人分得罚符）
    expect(r.state.players[0].score - before[0]).toBe(6000);
    expect(r.state.players[1].score - before[1]).toBe(-2000);
    expect(r.state.players[2].score - before[2]).toBe(-2000); // 也听牌但仍付，且无罚符收入
    expect(r.state.players[3].score - before[3]).toBe(-2000);
  });

  it('董卓听牌：即使全听牌，三家仍各付 2000', () => {
    const s = ryukyokuSetup(TENPAI, [TENPAI, TENPAI, TENPAI]);
    const before = s.players.map((p) => p.score);
    s.wall = []; // 荒牌流局的合法前提：牌山已耗尽
    const r = step(s, { type: 'ryukyoku' }, { skillsOf: BAOLIAN });
    expect(r.state.players[0].score - before[0]).toBe(6000);
    expect(r.state.players[1].score - before[1]).toBe(-2000);
    expect(r.state.players[2].score - before[2]).toBe(-2000);
    expect(r.state.players[3].score - before[3]).toBe(-2000);
  });

  it('董卓未听牌：其他人正常收罚符，董卓额外付 2000', () => {
    // 董卓（亲）不听；seat1 听；seat2/3 不听
    const s = ryukyokuSetup(NOTEN, [TENPAI, NOTEN, NOTEN]);
    const before = s.players.map((p) => p.score);
    s.wall = []; // 荒牌流局的合法前提：牌山已耗尽
    const r = step(s, { type: 'ryukyoku' }, { skillsOf: BAOLIAN });
    // 基础罚符：亲不听 2000 + 两个子不听各 1000 = 4000 → seat1 收 4000
    // 暴敛额外：董卓付 2000 → seat1 再收 2000
    expect(r.state.players[1].score - before[1]).toBe(4000 + 2000);
    expect(r.state.players[0].score - before[0]).toBe(-2000 - 2000); // 罚符 + 暴敛
  });
});

describe('孙权「制衡」：索子一气通贯 +3 番', () => {
  const ZHIHENG = (seat: number): Skill[] => (seat === 0 ? [zhiheng] : []);

  it('123s456s789s 和牌 → 额外 +3 番', () => {
    const s = dummyState();
    s.turnCount = 10;
    s.awaiting = 'discard';
    // 123s 456s 789s + 234m + 白白（听/自摸白）
    s.players[0].hand = [21, 22, 23, 24, 25, 26, 27, 28, 29, 2, 3, 4, 35, 35];
    const r = step(s, { type: 'tsumo' }, { skillsOf: ZHIHENG });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    // 一气通贯 2 + 门清自摸 1 + 制衡 3 = 6
    expect(agaru.han).toBe(6);

    // 对照：无技能时 3 番
    const s2 = dummyState();
    s2.turnCount = 10;
    s2.awaiting = 'discard';
    s2.players[0].hand = [21, 22, 23, 24, 25, 26, 27, 28, 29, 2, 3, 4, 35, 35];
    const r2 = step(s2, { type: 'tsumo' }, noSkills());
    const a2 = r2.effects.find((e) => e.type === 'agaru');
    expect(a2?.type === 'agaru' && a2.han).toBe(3);
  });
});

describe('陈到「往烈」：被鸣走则减少支付', () => {
  const WANGLIE = (seat: number): Skill[] => (seat === 0 ? [wanglie] : []);

  it('被鸣走 1 张 → 放铳 1000 减到 0（最低 0）', () => {
    const s = dummyState();
    s.players[0].log.calledCount = 1; // 本局被鸣走 1 张
    // seat0 放铳给 seat1：断幺 30符1番 子家荣和 = 1000
    s.players[1].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35]; // 役牌發 1 番 30 符（子家荣和 1000）
    s.lastDiscard = { player: 0, tile: 35 };
    const before = s.players.map((p) => p.score);
    const r = step(s, { type: 'ron', player: 1, tile: 35, from: 0 }, { skillsOf: WANGLIE });
    expect(r.error).toBeFalsy();
    // 原支付 1300（40符1番）- 往烈 1000 = 300
    expect(before[0] - r.state.players[0].score).toBe(300);
  });

  it('被鸣走 3 张 → 支付减 3000，仍不低于 0', () => {
    const s = dummyState();
    s.players[0].log.calledCount = 3;
    s.players[1].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35]; // 役牌發 1 番 30 符（子家荣和 1000）
    s.lastDiscard = { player: 0, tile: 35 };
    const before = s.players.map((p) => p.score);
    const r = step(s, { type: 'ron', player: 1, tile: 35, from: 0 }, { skillsOf: WANGLIE });
    expect(before[0] - r.state.players[0].score).toBe(0); // 1300 - 3000 → 0（下限）
  });

  it('未被鸣走时，支付照常', () => {
    const s = dummyState();
    s.players[0].log.calledCount = 0;
    s.players[1].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35]; // 役牌發 1 番 30 符（子家荣和 1000）
    s.lastDiscard = { player: 0, tile: 35 };
    const before = s.players.map((p) => p.score);
    const r = step(s, { type: 'ron', player: 1, tile: 35, from: 0 }, { skillsOf: WANGLIE });
    expect(before[0] - r.state.players[0].score).toBe(1300); // 正常支付（40符1番）
  });

  it('流局罚符同样减免（被鸣走 1 张 → 亲不听 2000 减到 1000）', () => {
    const s = dummyState();
    const NOTEN = [1, 4, 7, 11, 15, 19, 22, 25, 28, 31, 33, 35, 37];
    const TENPAI = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35];
    s.players[0].hand = [...NOTEN]; // 亲不听
    s.players[1].hand = [...TENPAI];
    s.players[2].hand = [...NOTEN];
    s.players[3].hand = [...NOTEN];
    s.players[0].log.calledCount = 1;
    const before = s.players.map((p) => p.score);
    s.wall = []; // 荒牌流局的合法前提：牌山已耗尽
    const r = step(s, { type: 'ryukyoku' }, { skillsOf: WANGLIE });
    // 亲不听罚符 2000，减 1000 → 实付 1000
    expect(before[0] - r.state.players[0].score).toBe(1000);
  });

  it('被鸣走的牌计入 calledCount（引擎接线验证）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 5, 35, 35];
    const r1 = step(s, { type: 'discard', tile: 35 }, noSkills());
    r1.state.players[2].hand = [35, 35, 1, 2, 3, 4, 12, 13, 14, 22, 23, 24, 15];
    const r2 = step(r1.state, { type: 'pon', player: 2, tile: 35 }, noSkills());
    expect(r2.state.players[0].log.calledCount).toBe(1); // seat0 被鸣走 1 张
  });

});

describe('夏侯惇「刚烈」：弃牌不可被鸣', () => {
  const GANGLIE = (seat: number): Skill[] => (seat === 0 ? [ganglie] : []);

  it('seat0 打出牌后，他人无法碰/吃', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 5, 35, 35];
    const r1 = step(s, { type: 'discard', tile: 35 }, { skillsOf: GANGLIE });
    r1.state.players[2].hand = [35, 35, 1, 2, 3, 4, 12, 13, 14, 22, 23, 24, 15];
    const r2 = step(r1.state, { type: 'pon', player: 2, tile: 35 }, { skillsOf: GANGLIE });
    expect(r2.error).toContain('刚烈');
  });
});
