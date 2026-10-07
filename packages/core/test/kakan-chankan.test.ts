import { describe, expect, it } from 'vitest';
import { advanceRound, canRon, step, type Tile } from '../src/index';
import { dummyState, noSkills } from './helpers';

/** 断幺听牌形：234m 234p 234s 55p + 34m，听 2m/5m */
const TANYAO_TENPAI: Tile[] = [2, 3, 4, 12, 13, 14, 22, 23, 24, 15, 15, 3, 4];

describe('加杠（kakan）', () => {
  it('碰过的刻子 + 手里第 4 张 → 加杠成立 + 岭上摸 + 抢杠窗口', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].openMelds = [{ type: 'pon', tiles: [5, 5, 5], from: 1 }];
    s.players[0].hand = [5, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35];
    const rinshanBefore = s.rinshanWall.length;
    const r = step(s, { type: 'kakan', player: 0, tile: 5 }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.players[0].openMelds[0].type).toBe('kakan');
    expect(r.state.players[0].openMelds[0].tiles.length).toBe(4);
    expect(r.state.rinshanWall.length).toBe(rinshanBefore - 1); // 岭上摸
    expect(r.state.pendingKakan).toEqual({ player: 0, tile: 5, kind: 'kakan' });
  });

  it('没有对应碰 → 拒绝', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [5, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35, 36];
    expect(step(s, { type: 'kakan', player: 0, tile: 5 }, noSkills()).error).toBeTruthy();
  });
});

describe('抢杠', () => {
  function afterKakan() {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].openMelds = [{ type: 'pon', tiles: [5, 5, 5], from: 1 }];
    s.players[0].hand = [5, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31, 31, 35];
    const r = step(s, { type: 'kakan', player: 0, tile: 5 }, noSkills());
    r.state.players[1].hand = [...TANYAO_TENPAI]; // 听 2m/5m 的断幺形
    return r.state;
  }

  it('加杠可被任意家抢：canRon 成立且标记 chankan', () => {
    const st = afterKakan();
    const can = canRon(st, 1, 5, 0);
    expect(can.ok).toBe(true);
    expect(can.chankan).toBe(true);
    const r = step(st, { type: 'ron', player: 1, tile: 5, from: 0 }, noSkills());
    expect(r.error).toBeFalsy();
    const agaru = r.effects.find((e) => e.type === 'agaru');
    expect(agaru?.type === 'agaru' && agaru.yaku).toContain('抢杠');
  });

  it('暗杠仅国士可抢：普通听牌者不能抢', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 1, 1, 1, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31]; // 4 张 1m
    const r = step(s, { type: 'ankan', player: 0, tile: 1 }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.pendingKakan?.kind).toBe('ankan');
    // seat1 普通听牌（断幺听 2m/5m），与暗杠的 1m 无关
    r.state.players[1].hand = [...TANYAO_TENPAI];
    expect(canRon(r.state, 1, 1, 0).ok).toBe(false);
  });

  it('暗杠可被国士无双抢', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 1, 1, 1, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31];
    const r = step(s, { type: 'ankan', player: 0, tile: 1 }, noSkills());
    // seat1 国士 12 种 + 白白，缺 1m → 听 1m
    r.state.players[1].hand = [9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 35, 36, 37];
    const can = canRon(r.state, 1, 1, 0);
    expect(can.ok).toBe(true);
    expect(can.chankan).toBe(true);
  });
});

describe('一炮多响（可一炮三响）', () => {
  it('三家同时荣和同一张牌：各自结算，放铳者付三家', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 31, 31, 35, 5]; // 打 5m
    const r1 = step(s, { type: 'discard', tile: 5 }, noSkills());
    for (const seat of [1, 2, 3]) r1.state.players[seat].hand = [...TANYAO_TENPAI];

    let st = r1.state;
    const before = st.players[0].score;
    for (const seat of [1, 2, 3]) {
      const r = step(st, { type: 'ron', player: seat, tile: 5, from: 0 }, noSkills());
      expect(r.error).toBeFalsy();
      st = r.state;
    }
    // 三家都荣和 → pass 收尾 → 终局
    const rf = step(st, { type: 'pass' }, noSkills());
    expect(rf.state.phase).toBe('ended');
    expect(rf.state.lastResult?.winners.sort()).toEqual([1, 2, 3]);
    // 放铳者付出三家点数；三家各得分
    expect(st.players[0].score).toBeLessThan(before);
    expect([1, 2, 3].every((x) => st.players[x].score > 25000)).toBe(true);
  });
});

describe('一发', () => {
  it('立直后一发有效；自己再打一张后失效', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34]; // 听白（打出北）
    const r1 = step(s, { type: 'discard', tile: 34, riichi: true }, noSkills());
    expect(r1.state.players[0].log.riichi).toBe(true);
    expect(r1.state.players[0].log.ippatsu).toBe(true);

    // 下家摸打不打消 seat0 的一发
    const r2 = step(r1.state, { type: 'draw' }, noSkills());
    expect(r2.state.players[0].log.ippatsu).toBe(true);
    const r3 = step(r2.state, { type: 'discard', tile: r2.state.players[1].hand[0] }, noSkills());
    expect(r3.state.players[0].log.ippatsu).toBe(true);

    // 轮回 seat0 摸牌 → 一发仍在（可一发自摸）
    let st = r3.state;
    while (st.current !== 0) {
      st = step(st, { type: 'draw' }, noSkills()).state;
      st = step(st, { type: 'discard', tile: st.players[st.current].hand[0] }, noSkills()).state;
      st = step(st, { type: 'pass' }, noSkills()).state; // 关闭响应窗口
    }
    const r4 = step(st, { type: 'draw' }, noSkills());
    expect(r4.state.players[0].log.ippatsu).toBe(true);
    // 打出一张 → 一发失效
    const r5 = step(r4.state, { type: 'discard', tile: r4.state.players[0].hand[0] }, noSkills());
    expect(r5.state.players[0].log.ippatsu).toBe(false);
  });

  it('副露打断一发（立直宣言牌被碰：立直仍在，一发失效）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // seat0 打北立直（听白）
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r1 = step(s, { type: 'discard', tile: 34, riichi: true }, noSkills());
    expect(r1.state.players[0].log.riichi).toBe(true);
    expect(r1.state.players[0].log.ippatsu).toBe(true);
    // seat1 手里 2 张北 → 碰
    r1.state.players[1].hand = [34, 34, 1, 2, 3, 4, 12, 13, 14, 22, 23, 24, 15];
    const r2 = step(r1.state, { type: 'pon', player: 1, tile: 34 }, noSkills());
    expect(r2.error).toBeFalsy();
    expect(r2.state.players[0].log.riichi).toBe(true); // 立直成立
    expect(r2.state.players[0].log.ippatsu).toBe(false); // 一发被打断
  });
});

describe('连庄', () => {
  it('亲家和牌 → 连庄（本场 +1，庄家不变）', () => {
    const s = dummyState();
    s.dealer = 0;
    s.lastResult = { winners: [0], tenpai: [] };
    s.reason = 'normal';
    s.phase = 'ended';
    const next = advanceRound(s);
    expect(next.dealer).toBe(0);
    expect(next.round.honba).toBe(1);
    expect(next.round.round).toBe(1);
    expect(next.phase).toBe('playing');
  });

  it('子家和牌 → 进庄（庄家移下家，本场归零，局数推进）', () => {
    const s = dummyState();
    s.dealer = 0;
    s.lastResult = { winners: [1], tenpai: [] };
    s.reason = 'normal';
    s.phase = 'ended';
    const next = advanceRound(s);
    expect(next.dealer).toBe(1);
    expect(next.round.round).toBe(2);
    expect(next.round.honba).toBe(0);
  });

  it('亲家听牌流局 → 连庄', () => {
    const s = dummyState();
    s.dealer = 0;
    s.lastResult = { winners: [], tenpai: [true, false, false, false] };
    s.reason = 'ryukyoku';
    s.phase = 'ended';
    const next = advanceRound(s);
    expect(next.dealer).toBe(0);
    expect(next.round.honba).toBe(1);
  });

  it('座位分数保留到新局', () => {
    const s = dummyState();
    s.phase = 'ended';
    s.reason = 'normal';
    s.lastResult = { winners: [1], tenpai: [] };
    s.players[0].score = 20000;
    s.players[1].score = 33000;
    const next = advanceRound(s);
    expect(next.players[0].score).toBe(20000);
    expect(next.players[1].score).toBe(33000);
    expect(next.players[0].hand.length).toBe(13); // 已重新配牌
  });
});
