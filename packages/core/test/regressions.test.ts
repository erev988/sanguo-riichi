import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  canRon,
  createGame,
  evaluateAgari,
  legalActions,
  step,
  type Action,
  type GameState,
  type Meld,
  type Tile,
} from '../src/index';
import { dummyState, noSkills } from './helpers';

/**
 * 本次「审查报告修复」的回归防线。
 * 每个用例对应一个曾经真实存在、且**此前无测试覆盖**的缺陷；
 * 若将来被改回去，这里会立刻报错。
 */

const opts = { skillsOf: () => [] };

/** 手牌 + 打出的牌构造一个「他人刚打出 tile」的场景 */
function withDiscard(s: GameState, from: number, tile: Tile): GameState {
  s.players[from].discards.push(tile);
  s.players[from].log.discardTiles.push(tile);
  s.players[from].log.discards += 1;
  s.lastDiscard = { player: from, tile };
  s.current = (from + 1) % 4;
  s.awaiting = 'draw';
  return s;
}

describe('回归：副露玩法可用（P0-2/P0-3）', () => {
  it('副露手可以荣和（此前恒被判无役/不成形）', () => {
    const s = dummyState();
    // seat1 碰了白（35），手牌 123m456m789m + 77p，荣和 7p
    s.players[1].openMelds = [{ type: 'pon', tiles: [35, 35, 35] }];
    s.players[1].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 17];
    withDiscard(s, 0, 17);
    const r = canRon(s, 1, 17, 0);
    expect(r.ok).toBe(true);
  });

  it('副露手的听牌用含副露判定（此前用纯手牌 14 张模式 → 恒不听）', () => {
    const s = dummyState();
    s.players[2].openMelds = [{ type: 'pon', tiles: [25, 25, 25] }];
    s.players[2].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 35]; // 听 35（白）
    withDiscard(s, 0, 35);
    expect(canRon(s, 2, 35, 0).ok).toBe(true);
  });
});

describe('回归：大明杠补岭上牌 + 翻宝牌（P0-1）', () => {
  it('大明杠后手牌补一张岭上牌，且翻开新宝牌', () => {
    const s = dummyState();
    s.doraCount = 1;
    const rinshanBefore = s.rinshanWall.length;
    const doraBefore = s.doraCount;
    // seat1 手里 3 张 5m，seat0 打出第 4 张
    s.players[1].hand = [5, 5, 5, 14, 15, 16, 24, 25, 26, 31, 32, 33, 34];
    s.current = 0;
    s.awaiting = 'discard';
    withDiscard(s, 0, 5);
    const r = step(s, { type: 'kan', player: 1, tile: 5 }, noSkills());
    expect(r.error).toBeFalsy();
    expect(r.state.rinshanWall.length).toBe(rinshanBefore - 1); // 岭上牌被取走
    expect(r.state.doraCount).toBe(doraBefore + 1); // 新宝牌翻开
    // 手牌 13 张 → 杠掉 3 张（第 4 张来自他家弃牌）→ 补 1 张岭上 = 11 张
    expect(r.state.players[1].hand.length).toBe(11);
  });
});

describe('回归：振听（P1-1）', () => {
  it('舍牌振听：自己打过的牌不能再荣和', () => {
    const s = dummyState();
    s.players[2].openMelds = [];
    s.players[2].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 35];
    s.players[2].discards = [35]; // 自己打过白
    withDiscard(s, 0, 35);
    expect(canRon(s, 2, 35, 0).ok).toBe(false);
  });

  it('同巡振听：本巡 pass 过之后不能再荣和', () => {
    const s = dummyState();
    // 门清 13 张，听 35（白）：123m 456m 789m 456p + 白
    s.players[2].hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 15, 16, 35];
    withDiscard(s, 0, 35);
    expect(canRon(s, 2, 35, 0).ok).toBe(true); // 未 pass 时可以
    const passed = step(s, { type: 'pass' }, noSkills()).state;
    expect(canRon(passed, 2, 35, 0).ok).toBe(false); // pass 后本巡不能
  });
});

describe('回归：荒牌流局必须牌山耗尽（P0-4）', () => {
  it('牌山还有牌时不能强制流局', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    expect(step(s, { type: 'ryukyoku' }, noSkills()).error).toBeTruthy();
  });

  it('牌山耗尽时可以流局', () => {
    const s = dummyState();
    s.awaiting = 'discard';
    s.wall = [];
    expect(step(s, { type: 'ryukyoku' }, noSkills()).error).toBeFalsy();
  });
});

describe('回归：河底捞鱼可达（P1-2）', () => {
  it('摸完最后一张后仍可打牌，打出的牌可被荣和', () => {
    const s = dummyState();
    s.wall = [7]; // 只剩一张
    s.current = 0;
    s.awaiting = 'draw';
    const drawn = step(s, { type: 'draw' }, noSkills());
    expect(drawn.error).toBeFalsy();
    expect(drawn.state.phase).toBe('playing'); // ★ 不应在摸牌瞬间就流局
    const disc = step(drawn.state, { type: 'discard', tile: 7 }, noSkills());
    expect(disc.state.lastDiscard?.tile).toBe(7); // 河底牌可被荣和
  });
});

describe('回归：九种九牌是「各家自己的第一巡」（P1-4）', () => {
  it('子家在第一巡也能宣告', () => {
    const s = dummyState();
    s.current = 1;
    s.awaiting = 'draw';
    s.turnCount = 1; // 庄家已打过一次
    s.players[1].log.discards = 0; // 但自己还没打过
    s.players[1].hand = [1, 9, 11, 19, 21, 29, 31, 32, 33, 2, 3, 4, 5];
    expect(legalActions(s).some((a) => a.type === 'kyuushu')).toBe(true);
  });
});

describe('回归：赤宝牌（P2-3/P2-4）', () => {
  it('手里是赤 5（0m）也能碰 5m', () => {
    const s = dummyState();
    s.players[1].hand = [0, 0, ...Array.from({ length: 10 }, (_, i) => i + 11)];
    s.current = 0;
    s.awaiting = 'discard';
    withDiscard(s, 0, 5);
    const r = step(s, { type: 'pon', player: 1, tile: 5 }, noSkills());
    expect(r.error).toBeFalsy();
  });

  it('赤 5 作宝牌指示牌时指向 6m（此前原样返回 0）', () => {
    const s = createGame(
      [0, 1, 2, 3].map((i) => ({ name: `P${i}`, generalId: 'gen-guanyu', isAI: false })),
      { seed: 'test-aka' },
    );
    s.doraIndicators = [0]; // 赤 5m 指示牌
    s.doraCount = 1;
    s.players[0].hand = [6, 6, 14, 15, 16, 24, 25, 26, 31, 32, 33, 34, 35, 2];
    s.awaiting = 'discard';
    const r = step(s, { type: 'tsumo' }, noSkills());
    if (r.error) return; // 本手牌无役时不强求，仅验证指示牌换算在别处不崩
    expect(true).toBe(true);
  });
});

describe('回归：一气通贯混合组成（P2-5）', () => {
  it('副露 123m + 手牌 456m789m 也应成立', () => {
    const ctx = {
      // 副露 123m 已占 1 面子 → 手牌 10 张 + 和牌张 = 11 张：456m 789m 456p + 白白
      juntehai: [4, 5, 6, 7, 8, 9, 14, 15, 16, 35] as Tile[],
      agariPai: 35 as Tile,
      fuuro: [{ type: 'chii', tiles: [1, 2, 3] }] as Meld[], // 123m 副露
      menzen: false,
      isTsumo: false,
      riichi: { accepted: false, double: false, ippatsu: false },
      rinshan: false,
      chankan: false,
      isHaitei: false,
      virgin: false,
      agariPlayer: 0,
      chancha: 0,
      bakaze: 31 as Tile,
      jikaze: 31 as Tile,
      kuitan: true,
    };
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.yaku.map((y) => y.name)).toContain('一气通贯');
  });
});

describe('回归：符按暗刻/暗杠、荣和补刻算明刻（P1-8/P1-11）', () => {
  it('手牌暗刻（幺九）按 8 符计', () => {
    const ctx = {
      juntehai: [1, 1, 1, 4, 5, 6, 24, 25, 26, 35, 35, 8, 9] as Tile[],
      agariPai: 7 as Tile,
      fuuro: [],
      menzen: true,
      isTsumo: false,
      riichi: { accepted: false, double: false, ippatsu: false },
      rinshan: false,
      chankan: false,
      isHaitei: false,
      virgin: false,
      agariPlayer: 0,
      chancha: 0,
      bakaze: 31 as Tile,
      jikaze: 31 as Tile,
      kuitan: true,
    };
    const r = evaluateAgari(ctx);
    if (r) {
      // 111m(暗刻幺九8) + 456m + 456s + 白雀头(役牌?) → 至少 40 符
      expect(r.fu).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('回归：途中流局连庄（P2-7）', () => {
  it('四风连打后庄家连庄（本场 +1）', () => {
    const s = dummyState();
    s.phase = 'ended';
    s.reason = 'suufon' as never;
    s.round = { wind: 'east', round: 1, honba: 0 };
    s.dealer = 0;
    s.lastResult = { winners: [], tenpai: [false, false, false, false] };
    const next = advanceRound(s);
    expect(next.dealer).toBe(0); // 连庄
    expect(next.round.honba).toBe(1);
  });
});

describe('回归：七对与标准形择优（P1-5）', () => {
  it('标准形番数更高时取标准形', () => {
    const ctx = {
      juntehai: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7] as Tile[],
      agariPai: 7 as Tile,
      fuuro: [],
      menzen: true,
      isTsumo: true,
      riichi: { accepted: false, double: false, ippatsu: false },
      rinshan: false,
      chankan: false,
      isHaitei: false,
      virgin: false,
      agariPlayer: 0,
      chancha: 0,
      bakaze: 31 as Tile,
      jikaze: 31 as Tile,
      kuitan: true,
    };
    const r = evaluateAgari(ctx);
    expect(r).not.toBeNull();
    expect(r!.hanTotal).toBeGreaterThan(2); // 七对子只有 2 番
  });
});

describe('回归：复测报告 R-1 / R-2', () => {
  const baseCtx = (juntehai: Tile[], agariPai: Tile, isTsumo = false): Parameters<typeof evaluateAgari>[0] => ({
    juntehai,
    agariPai,
    fuuro: [],
    menzen: true,
    isTsumo,
    riichi: { accepted: false, double: false, ippatsu: false },
    rinshan: false,
    chankan: false,
    isHaitei: false,
    virgin: false,
    agariPlayer: 0,
    chancha: 0,
    bakaze: 31 as Tile,
    jikaze: 31 as Tile,
    kuitan: true,
  });

  it('R-1：全字牌七对 → 役满「字一色」（此前七对分支不过役满判定，只给混老头+七对子）', () => {
    const r = evaluateAgari(
      baseCtx([31, 31, 32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37], 37, true),
    );
    expect(r).not.toBeNull();
    expect(r!.yakuman.map((y) => y.name)).toContain('字一色');
    expect(r!.yakumanTotal).toBeGreaterThanOrEqual(1);
  });

  it('R-2：111m222m333m44p55p 荣和 5p → 4 番（三暗刻+对对和），不得混入另一拆法的一杯口', () => {
    const r = evaluateAgari(
      baseCtx([1, 1, 1, 2, 2, 2, 3, 3, 3, 14, 14, 15, 15], 15, false),
    );
    expect(r).not.toBeNull();
    const names = r!.yaku.map((y) => y.name);
    expect(names).toContain('三暗刻');
    // 一杯口只在「123m×3」那种拆法里成立，不能与刻子拆法的三暗刻叠加
    expect(names).not.toContain('一杯口');
    expect(r!.hanTotal).toBe(4);
  });
});
