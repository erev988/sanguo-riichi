import { describe, expect, it } from 'vitest';
import { canRon, step, type Tile } from '../src/index';
import { dummyState, noSkills } from './helpers';

describe('抢暗杠必须国士听牌', () => {
  /** 造出：seat0 暗杠 1m，seat1 手牌为国士「听中」形（12 种幺九 + 1m 对，缺中） */
  function ankanSetup() {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [1, 1, 1, 1, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31];
    const r = step(s, { type: 'ankan', player: 0, tile: 1 }, noSkills());
    // 12 种幺九各 1 + 1m 对（缺中）→ 只听中
    r.state.players[1].hand = [1, 1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36];
    return r.state;
  }

  it('国士听该牌 → 可抢暗杠', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.players[0].hand = [37, 37, 37, 37, 2, 3, 4, 14, 15, 16, 24, 25, 26, 31]; // 暗杠 中
    const r = step(s, { type: 'ankan', player: 0, tile: 37 }, noSkills());
    // seat1 国士 12 种 + 1m 对，缺中 → 听中
    r.state.players[1].hand = [1, 1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36];
    const can = canRon(r.state, 1, 37, 0);
    expect(can.ok).toBe(true);
    expect(can.chankan).toBe(true);
  });

  it('国士形但没听这张牌 → 不能抢', () => {
    const st = ankanSetup(); // seat0 暗杠 1m；seat1 国士只听中（不听 1m）
    expect(canRon(st, 1, 1, 0).ok).toBe(false);
  });

  it('非国士听牌（普通形）→ 不能抢暗杠', () => {
    const st = ankanSetup();
    // seat1 普通听牌（断幺听 2m/5m），与 1m 无关
    st.players[1].hand = [2, 3, 4, 12, 13, 14, 22, 23, 24, 15, 15, 3, 4];
    expect(canRon(st, 1, 1, 0).ok).toBe(false);
  });
});

describe('海底 / 河底', () => {
  it('海底摸月：摸最后一张自摸和牌 → 含海底捞月', () => {
    const s = dummyState();
    s.awaiting = 'draw';
    s.turnCount = 10;
    s.wall = [35]; // 牌山只剩白（海底牌）
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35];
    const r1 = step(s, { type: 'draw' }, noSkills());
    expect(r1.state.isHaitei).toBe(true);
    const r2 = step(r1.state, { type: 'tsumo' }, noSkills());
    const agaru = r2.effects.find((e) => e.type === 'agaru');
    expect(agaru?.type === 'agaru' && agaru.yaku).toContain('海底捞月');
  });
});

describe('天和 / 地和', () => {
  it('亲家首巡自摸 → 天和（役满）', () => {
    const s = dummyState();
    s.turnCount = 0;
    s.awaiting = 'discard';
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35];
    const r = step(s, { type: 'tsumo' }, noSkills());
    const agaru = r.effects.find((e) => e.type === 'agaru');
    expect(agaru?.type === 'agaru' && agaru.yaku).toContain('天和');
  });
});

describe('双立直', () => {
  it('第一巡立直 → 两立直（double）成立', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.turnCount = 0;
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r = step(s, { type: 'discard', tile: 34, riichi: true }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.players[0].log.doubleRiichi).toBe(true);
  });

  it('非首巡立直 → 普通立直（double=false）', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.turnCount = 5;
    s.players[0].hand = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 34];
    const r = step(s, { type: 'discard', tile: 34, riichi: true }, noSkills());
    expect(r.state.players[0].log.doubleRiichi).toBe(false);
  });
});

describe('九种九牌', () => {
  it('首巡幺九 ≥ 9 种 → 可宣告流局', () => {
    const s = dummyState();
    s.turnCount = 0;
    s.awaiting = 'draw';
    s.players[0].hand = [1, 9, 11, 19, 21, 29, 31, 32, 33, 2, 3, 4, 5]; // 9 种幺九
    const r = step(s, { type: 'kyuushu' }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.phase).toBe('ended');
    expect(r.state.reason).toBe('ryukyoku');
  });

  it('幺九不足 9 种 → 拒绝', () => {
    const s = dummyState();
    s.turnCount = 0;
    s.awaiting = 'draw';
    s.players[0].hand = [1, 9, 11, 19, 21, 29, 31, 32, 2, 3, 4, 5, 6]; // 8 种幺九
    expect(step(s, { type: 'kyuushu' }, noSkills()).error).toBeTruthy();
  });

  it('非首巡（自己已打过牌）→ 拒绝', () => {
    const s = dummyState();
    s.turnCount = 1;
    s.awaiting = 'draw';
    s.players[0].log.discards = 1; // ★ 规则是「各家自己的第一巡」：已打过牌就不能再宣告
    s.players[0].hand = [1, 9, 11, 19, 21, 29, 31, 32, 33, 2, 3, 4, 5];
    expect(step(s, { type: 'kyuushu' }, noSkills()).error).toBeTruthy();
  });
});

describe('四风连打', () => {
  it('四家第一张都打同一风牌 → 途中流局', () => {
    let st = dummyState();
    for (let seat = 0; seat < 4; seat++) {
      st.players[seat].hand = [31, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];
    }
    // 依次：draw + discard 东(31)（打牌后关闭响应窗口）
    for (let seat = 0; seat < 4; seat++) {
      st = step(st, { type: 'draw' }, noSkills()).state;
      st = step(st, { type: 'discard', tile: 31 }, noSkills()).state;
      if (st.phase === 'ended') break;
      st = step(st, { type: 'pass' }, noSkills()).state;
    }
    expect(st.phase).toBe('ended');
    expect(st.reason).toBe('ryukyoku');
  });
});

describe('四杠散了', () => {
  it('第 4 个杠 → 途中流局', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    // seat0 已有 3 个杠
    s.players[0].openMelds = [
      { type: 'kan', tiles: [2, 2, 2, 2] },
      { type: 'ankan', tiles: [3, 3, 3, 3] },
      { type: 'kakan', tiles: [4, 4, 4, 4] },
    ];
    s.players[0].hand = [5, 5, 5, 5, 14, 15, 16, 24, 25, 26, 31, 31, 35, 36];
    const r = step(s, { type: 'ankan', player: 0, tile: 5 }, noSkills());
    expect(r.state.phase).toBe('ended');
    expect(r.state.reason).toBe('ryukyoku');
  });
});
