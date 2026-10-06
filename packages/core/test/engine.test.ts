import { describe, expect, it } from 'vitest';
import { createGame, step } from '../src/engine';
import { baolian, jianying, renjie, wusheng } from '../src/skills';
import { dummyState, noSkills } from './helpers';

function skillsOf(seat: number) {
  return seat === 0
    ? [jianying]
    : seat === 1
      ? [wusheng]
      : seat === 2
        ? [renjie]
        : [];
}

describe('引擎：摸打流转', () => {
  it('配牌每人 13 张，可摸牌山 70 张 + 王牌 14（岭上4/宝牌5/里宝5）', () => {
    const s = createGame(
      [0, 1, 2, 3].map((i) => ({ name: `P${i}`, generalId: 'gen-guanyu', isAI: false })),
      { seed: 42 },
    );
    expect(s.players.every((p) => p.hand.length === 13)).toBe(true);
    expect(s.wall.length).toBe(70);
    expect(s.rinshanWall.length).toBe(4);
    expect(s.doraIndicators.length).toBe(5);
    expect(s.uraIndicators.length).toBe(5);
  });

  it('摸牌 + 打牌会推进回合并计数弃牌', () => {
    let s = dummyState();
    const r0 = step(s, { type: 'draw' }, noSkills());
    expect(r0.effects.some((e) => e.type === 'drawn')).toBe(true);
    s = r0.state;

    const tile = s.players[0].hand[0];
    const r1 = step(s, { type: 'discard', tile }, noSkills());
    s = r1.state;
    expect(s.players[0].log.discards).toBe(1);
    expect(s.players[0].hand.length).toBe(13);
    expect(s.current).toBe(1);
  });
});

describe('引擎：和牌结算 + 沮授渐营', () => {
  it('连续三张同类弃牌 → 渐营 +3 番（示例序列）', () => {
    const s = dummyState();
    s.turnCount = 10; // 非首巡（避免触发天和）
    // 注入：seat0 的**未被鸣走**弃牌区有 5 张万 → 3 个同类窗口 → +3 番
    s.players[0].discards = [1, 2, 3, 4, 5];
    s.players[0].log.discards = 5;
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35];

    const r = step(s, { type: 'tsumo' }, { skillsOf });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未产生和牌事件');
    // 基础役（役牌發 + 门清自摸 = 2 番）+ 渐营 +3 = 5 番
    expect(agaru.han).toBe(5);
    expect(r.state.phase).toBe('ended');
    expect(r.state.reason).toBe('normal');
  });
});

describe('引擎：关羽武圣（万面子加番）', () => {
  it('手牌万面子按拆解计入 → 3 番变 6 番', () => {
    const s = dummyState();
    const skillsOfMan = (seat: number) => (seat === 0 ? [wusheng] : []);
    s.turnCount = 10; // 非首巡（避免触发天和）
    // 123m 456m 789m 456p 白白：一气通贯+门清自摸 3 番，3 个万面子 → +3 → 6 番
    s.players[0].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 35, 35];
    const r = step(s, { type: 'tsumo' }, { skillsOf: skillsOfMan });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未产生和牌事件');
    expect(agaru.yaku).toEqual(expect.arrayContaining(['一气通贯', '门清自摸']));
    expect(agaru.han).toBe(6);
  });
});

describe('引擎：流局 + 技能三', () => {
  it('荒牌流局：基础罚符 + 技能三 2000×3 入账', () => {
    const s = dummyState();
    const TENPAI = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35]; // 听白
    const NOTEN = [1, 4, 7, 11, 15, 19, 22, 25, 28, 31, 33, 35, 37]; // 乱牌不听
    s.players[0].hand = [...NOTEN];
    s.players[1].hand = [...TENPAI];
    s.players[2].hand = [...TENPAI];
    s.players[3].hand = [...NOTEN];
    const before = s.players.map((p) => p.score);

    const r = step(s, { type: 'ryukyoku' }, { skillsOf });
    expect(r.state.phase).toBe('ended');
    expect(r.state.reason).toBe('ryukyoku');

    // 听牌由真实手牌判定 ✓
    expect(r.state.players.map((p) => p.log.tenpai)).toEqual([false, true, true, false]);
    // 基础罚符：不听者 seat0(亲)付 2000、seat3(子)付 1000，听牌者各 +1500
    // 技能三（seat2 点灵）：seat0/1/3 各付 2000 给 seat2
    expect(r.state.players[0].score - before[0]).toBe(-2000 - 2000);
    expect(r.state.players[1].score - before[1]).toBe(+1500 - 2000);
    expect(r.state.players[2].score - before[2]).toBe(+1500 + 2000 * 3);
    expect(r.state.players[3].score - before[3]).toBe(-1000 - 2000);
  });
});

describe('和牌事件携带技能数值（供结算面板显示）', () => {
  it('关羽武圣：万面子 ×3 → 和牌事件里记录 +3 番', () => {
    const s = dummyState();
    s.turnCount = 10;
    s.awaiting = 'discard';
    // 123m 456m 789m 456p 白白 → 3 个万面子
    s.players[0].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 35, 35];
    const r = step(s, { type: 'tsumo' }, { skillsOf: (seat: number) => (seat === 0 ? [wusheng] : []) });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.skills).toEqual([{ skill: '武圣', han: 3, fu: 0 }]);
  });

  it('技能可把番数扣到 0 番：0 番仍可和牌，且照常收走立直棒（以技能为准）', () => {
    const s = dummyState();
    s.turnCount = 20;
    s.awaiting = 'discard';
    // 立直（1 番）+ 门清自摸（1 番）= 2 番；暴敛 >12 张 -2 → 0 番（仍可和）
    // 手牌：123m 456p 567s 南南南 中中（无断幺/三色/平和/役牌）
    s.players[0].log.riichi = true;
    s.players[0].log.discards = 14;
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 25, 26, 27, 32, 32, 32, 33, 33];
    s.riichiSticks = 2; // 场上还有 2 根立直棒（含自己的）
    const r = step(s, { type: 'tsumo' }, { skillsOf: (seat: number) => (seat === 0 ? [baolian] : []) });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.han).toBe(0); // 技能扣到 0 番，仍然和牌
    expect(agaru.yaku.length).toBeGreaterThan(0); // 役种依然存在
    // 立直棒（2 根 = 2000）全部收归和牌者
    expect(agaru.payments.some((p) => p.from === -1 && p.to === 0 && p.amount === 2000)).toBe(true);
    expect(r.state.riichiSticks).toBe(0);
  });

  it('无技能时不产生技能记录', () => {
    const s = dummyState();
    s.turnCount = 10;
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35];
    const r = step(s, { type: 'tsumo' }, { skillsOf: () => [] });
    const agaru = r.effects.find((e) => e.type === 'agaru');
    if (agaru?.type !== 'agaru') throw new Error('未和牌');
    expect(agaru.skills).toEqual([]);
  });
});

describe('引擎：飞人规则（雀魂）', () => {
  it('有人点数为负立即终局，reason = tobi', () => {
    const s = dummyState();
    // 放铳者（seat1）即将被飞；seat0 真听牌：123m456p456s白白55m 听 白/5m
    s.players[1].score = 100;
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 35, 35, 5, 5];
    s.lastDiscard = { player: 1, tile: 35 };
    // 荣和 白：白白成刻子（役牌白 1 番）+ 55m 雀头
    const r1 = step(s, { type: 'ron', player: 0, tile: 35, from: 1 }, noSkills());
    expect(r1.state.players[1].score).toBeLessThan(0);
    // 关闭响应窗口 → 终局
    const r2 = step(r1.state, { type: 'pass' }, noSkills());
    expect(r2.state.phase).toBe('ended');
    expect(r2.state.reason).toBe('tobi');
  });

  it('正常和牌不触发飞人', () => {
    const s = dummyState();
    // 注入真和牌：平和自摸
    s.players[0].hand = [1, 2, 4, 5, 6, 11, 12, 13, 14, 15, 16, 5, 5, 3];
    const r = step(s, { type: 'tsumo' }, noSkills());
    expect(r.state.reason).toBe('normal');
  });
});
