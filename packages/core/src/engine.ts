import type { Action } from './actions';
import type { GameEffect, Payment } from './effects';
import { computePayments, type WinInfo } from './scoring';
import type { AgaruContext, CallContext, OtherAgaruContext, RyukyokuContext, Skill } from './skills';
import { evaluateAgari } from './agari';
import { calcTenpai, calcTenpaiWithMelds } from './tenpai';
import { resolveRules, type Rules } from './rules';
import {
  buildWall,
  mulberry32,
  type GameState,
  type Meld,
  type PlayerState,
  type RoundInfo,
  type SeatConfig,
  type Tile,
} from './types';

// ============================================================================
// 引擎：把 riichi-core 的 Game 拆成 纯数据(GameState) + 纯函数(step) + 事件流(effects)
// 技能层在结算点注入（三国杀式：技能优先级高于基础规则，在其之上追加/覆盖）
// ============================================================================

export interface StepOptions {
  /** 每个座位的技能列表（服务器把 武将→技能 映射传进来，引擎不直接依赖 generals） */
  skillsOf: (seat: number) => Skill[];
  /** 和牌判定（默认用 evaluateAgari 真判定；测试可注入自定义） */
  calcWin?: (state: GameState, seat: number, kind: 'tsumo' | 'ron', agariPai: number) => WinInfo | null;
}

export interface StepResult {
  state: GameState;
  effects: GameEffect[];
  error?: string;
}

const DEFAULT_INITIAL_SCORE = 25000;

/** 宝牌：指示牌 → 实际宝牌（数牌 +1，风 东→南→西→北→东，三元 白→发→中→白） */
export { doraFromIndicator, countDora, countAka } from './types';

export function createGame(
  seats: SeatConfig[],
  opts: { seed?: number; round?: RoundInfo; initialScore?: number; rules?: Partial<Rules> } = {},
): GameState {
  const seed = opts.seed ?? 20240101;
  const rng = mulberry32(seed);
  const all = buildWall(rng);
  const rules = resolveRules(opts.rules);
  // 配牌 52 张后，余下 84 张中拆出「王牌」14 张：岭上 4 + 宝牌指示牌 5 + 里宝牌指示牌 5
  const dealt = all.splice(0, 52);
  const wangpai = all.splice(-14);
  return {
    version: 0,
    round: opts.round ?? { wind: 'east', round: 1, honba: 0 },
    dealer: 0,
    wall: all, // 70 张可摸
    rinshanWall: wangpai.slice(0, 4),
    doraIndicators: wangpai.slice(4, 9),
    uraIndicators: wangpai.slice(9, 14),
    doraCount: 1, // 开局翻开 1 张宝牌指示牌
    players: seats.map((s, i) => ({
      seat: i,
      name: s.name,
      generalId: s.generalId,
      isAI: s.isAI,
      score: opts.initialScore ?? rules.initialScore,
      hand: dealt.slice(i * 13, i * 13 + 13),
      openMelds: [],
      discards: [],
      log: { discards: 0, discardTiles: [], calledCount: 0, riichi: false, ippatsu: false, tenpai: false },
    })),
    current: 0,
    awaiting: 'draw',
    agariThisTurn: [],
    rinshan: false,
    isHaitei: false,
    anyCall: false,
    firstDiscards: [null, null, null, null],
    turnCount: 0,
    riichiSticks: 0,
    phase: 'playing',
    rules,
    seed,
  };
}

/** 荣和判定（供服务器/AI：某人能否荣和这张牌；暗杠仅国士能抢） */
export function canRon(
  s: GameState,
  seat: number,
  tile: Tile,
  from: number,
): { ok: boolean; chankan: boolean } {
  const no = { ok: false, chankan: false };
  if (seat === from) return no;
  if (s.agariThisTurn.includes(seat)) return no;
  const fromKakan = !!(s.pendingKakan && s.pendingKakan.player === from && s.pendingKakan.tile === tile);
  const fromDiscard = !!(s.lastDiscard && s.lastDiscard.player === from && s.lastDiscard.tile === tile);
  if (!fromKakan && !fromDiscard) return no;
  // 抢暗杠仅限国士无双
  if (fromKakan && s.pendingKakan!.kind === 'ankan' && !isKokushiWin(s.players[seat].hand, tile)) return no;
  const p = s.players[seat];
  if (!calcTenpai(p.hand).includes(tile)) return no;
  return { ok: !!winFromState(s, seat, 'ron', tile, fromKakan), chankan: fromKakan };
}

/** 手牌 + tile 是否国士无双和牌形 */
function isKokushiWin(hand: Tile[], tile: Tile): boolean {
  const yaochuu: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37];
  const counts = new Map<Tile, number>();
  for (const t of [...hand, tile]) counts.set(t, (counts.get(t) ?? 0) + 1);
  let kinds = 0;
  let pairs = 0;
  for (const [t, n] of counts) {
    if (!yaochuu.includes(t)) return false;
    if (n === 2) pairs++;
    else if (n !== 1) return false;
    kinds++;
  }
  return kinds === 13 && pairs === 1;
}

/** 当前可执行动作（含副露/荣和/杠提示） */
export function legalActions(s: GameState): Action[] {
  if (s.phase !== 'playing') return [];
  const p = s.players[s.current];
  const acts: Action[] = [];

  // 响应窗口（打出的牌 / 被杠的牌）：荣和 + pass
  const src = s.pendingKakan ?? s.lastDiscard;
  if (src) {
    for (let me = 0; me < 4; me++) {
      if (canRon(s, me, src.tile, src.player).ok) {
        acts.push({ type: 'ron', player: me, tile: src.tile, from: src.player });
      }
    }
    acts.push({ type: 'pass' });
  }

  if (s.awaiting === 'draw') {
    if (s.wall.length > 0) acts.push({ type: 'draw' });
    // 九种九牌（第一巡）
    if (s.turnCount === 0 && new Set(p.hand.filter(isYaochuupaiLocal)).size >= 9) {
      acts.push({ type: 'kyuushu' });
    }
  } else {
    acts.push({ type: 'tsumo' });
    for (const t of new Set(p.hand)) acts.push({ type: 'discard', tile: t });
    // 暗杠
    const counts = new Map<Tile, number>();
    for (const t of p.hand) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, n] of counts) if (n >= 4) acts.push({ type: 'ankan', player: s.current, tile: t });
    // 加杠
    for (const m of p.openMelds) {
      if (m.type === 'pon' && p.hand.includes(m.tiles[0])) {
        acts.push({ type: 'kakan', player: s.current, tile: m.tiles[0] });
      }
    }
  }

  // 副露（吃/碰/杠）：别人打出牌后，其他座位可声明
  if (s.lastDiscard && s.awaiting === 'draw') {
    const { player: dp, tile } = s.lastDiscard;
    for (let me = 0; me < 4; me++) {
      if (me === dp) continue;
      const mp = s.players[me];
      if (mp.log.riichi) continue;
      const n = mp.hand.filter((t) => t === tile).length;
      if (n >= 2) acts.push({ type: 'pon', player: me, tile });
      if (n >= 3) acts.push({ type: 'kan', player: me, tile });
      if (me === (dp + 1) % 4) {
        for (const pair of chiiPairs(mp.hand, tile)) acts.push({ type: 'chii', player: me, tile, tiles: pair });
      }
    }
  }
  return acts;
}

/** 找出能与 tile 组成顺子的两张手牌 */
function chiiPairs(hand: Tile[], tile: Tile): [Tile, Tile][] {
  const out: [Tile, Tile][] = [];
  const has = (t: Tile) => hand.includes(t);
  const num = tile % 10;
  const suit = Math.floor(tile / 10);
  if (suit > 2) return out; // 字牌不能吃
  const cand: Tile[][] = [
    [tile - 2, tile - 1], // x x+1 [tile]
    [tile - 1, tile + 1], // x [tile] x+2
    [tile + 1, tile + 2], // [tile] x x+1
  ];
  for (const [a, b] of cand) {
    if (a < suit * 10 + 1 || b > suit * 10 + 9) continue;
    if (has(a) && has(b)) out.push([a, b]);
  }
  return out;
}

/** 单步推进：不改变入参，返回新状态 + 事件流 */
export function step(state: GameState, action: Action, opts: StepOptions): StepResult {
  const s = structuredClone(state) as GameState;
  const effects: GameEffect[] = [];
  const fail = (error: string): StepResult => ({ state, effects, error });

  if (s.phase !== 'playing') return fail('游戏已结束');

  switch (action.type) {
    case 'draw': {
      if (s.awaiting !== 'draw') return fail('当前不是摸牌时机');
      if (s.lastDiscard || s.pendingKakan) return fail('等待响应窗口关闭');
      if (s.wall.length === 0) return settleRyukyoku(s, opts, effects);
      const tile = s.wall.pop()!;
      const drawer = s.players[s.current];
      drawer.hand.push(tile);
      s.rinshan = false; // 普通摸牌
      if (s.wall.length === 0) s.isHaitei = true; // 摸完牌山最后一张（海底摸月）
      s.awaiting = 'discard';
      effects.push({ type: 'drawn', player: s.current, tile, targetSeat: s.current });
      effects.push({ type: 'wall', count: s.wall.length });
      effects.push({
        type: 'hand',
        player: s.current,
        tiles: [...s.players[s.current].hand],
        targetSeat: s.current,
      });
      break;
    }

    case 'discard': {
      if (s.awaiting !== 'discard') return fail('当前不是打牌时机');
      const p = s.players[s.current];
      const idx = p.hand.indexOf(action.tile);
      if (idx === -1) return fail('手里没有这张牌');
      p.hand.splice(idx, 1);
      p.discards.push(action.tile);
      p.log.discardTiles.push(action.tile); // 完整弃牌历史（含被鸣走的）
      p.log.discards += 1;
      // 四风连打判定：记录各家第一张弃牌
      if (p.discards.length === 1) s.firstDiscards[s.current] = action.tile;

      if (action.riichi) {
        if (p.log.riichi) return fail('已经立直过了');
        if (p.openMelds.length > 0) return fail('副露后不能立直');
        // 妄尊：先制立直封锁中，其他人不能立直
        if (s.riichiLockBy != null && s.riichiLockBy !== s.current) {
          return fail('先制立直封锁中，你无法立直（妄尊）');
        }
        // 打出该牌后（手牌 13 张）必须听牌
        if (calcTenpai(p.hand).length === 0) return fail('立直宣言必须听牌');
        const othersRiichi = s.players.some((x, i) => i !== s.current && x.log.riichi);
        p.log.riichi = true;
        p.log.ippatsu = true; // 一发有效，直到轮回自己摸牌或被鸣牌打断
        p.log.doubleRiichi = s.turnCount === 0 && !s.anyCall; // 双立直：第一巡且无鸣牌
        p.log.firstRiichi = !othersRiichi; // 先制立直（场上第一个）
        p.log.riichiTenpai = calcTenpai(p.hand); // 记录立直时听牌集合
        // 妄尊：先制立直 → 封锁他人立直
        if (p.log.firstRiichi && hasFlag(opts, s.current, (sk) => !!sk.locksRiichi)) {
          s.riichiLockBy = s.current;
        }
        p.score -= 1000; // 立直棒立即扣除
        s.riichiSticks += 1;
      }

      s.lastDiscard = { player: s.current, tile: action.tile };
      s.agariThisTurn = []; // 开启本巡荣和窗口
      // 立直后自己打牌（非宣言那次）→ 一发失效
      if (!action.riichi && p.log.ippatsu) p.log.ippatsu = false;
      effects.push({
        type: 'discarded',
        player: s.current,
        tile: action.tile,
        riichi: !!action.riichi,
        handCount: p.hand.length, // 公开信息：打牌后手牌张数
      });
      effects.push({ type: 'hand', player: s.current, tiles: [...p.hand], targetSeat: s.current });
      if (action.riichi) effects.push({ type: 'scores', scores: s.players.map((x) => x.score) });

      s.current = (s.current + 1) % 4;
      s.awaiting = 'draw';
      s.turnCount += 1;
      // 四风连打：四家第一张弃牌为同一风牌 → 途中流局
      if (
        s.turnCount === 4 &&
        s.firstDiscards.every((t) => t !== null && t >= 31 && t <= 34 && t === s.firstDiscards[0])
      ) {
        return settleAbortive(s, effects, 'suufon');
      }
      // 四家立直 → 途中流局
      if (s.players.every((x) => x.log.riichi)) {
        return settleAbortive(s, effects, 'suuchariichi');
      }
      if (s.wall.length === 0) return settleRyukyoku(s, opts, effects); // 牌山摸尽 → 荒牌流局
      break;
    }

    case 'tsumo': {
      const winner = s.current;
      const hand = s.players[winner].hand;
      const agariPai = hand[hand.length - 1]; // 摸牌在末尾
      let win = (opts.calcWin ?? winFromState)(s, winner, 'tsumo', agariPai);
      // 无役但拥有「无役亦可和」技能 → 按 0 番放行
      if (!win && (opts.skillsOf(winner) ?? []).some((sk) => sk.forceWin)) {
        win = { kind: 'tsumo', yaku: ['无役和牌（技能）'], han: 0, fu: 30, decomp: null };
      }
      if (!win) return fail('无役，不能自摸');
      const { payments: skillPayments, skillLog } = applyAgaruSkills(s, opts, winner, win);
      const otherPayments: Payment[] = [];
      applyOtherAgaruSkills(s, opts, winner, otherPayments); // 他人和牌钩子（妄尊）
      const payments = [
        ...computePayments({ ...win, kind: 'tsumo' }, winner, s.dealer, undefined, {
          riichiSticks: s.riichiSticks,
          honba: s.round.honba,
          kiriageMangan: s.rules.kiriageMangan,
        }),
        ...skillPayments,
        ...otherPayments,
      ];
      applyPayments(s, payments, opts);
      s.riichiSticks = 0;
      s.lastResult = { winners: [winner], tenpai: s.players.map((p) => p.log.tenpai) };
      effects.push({ type: 'agaru', winner, kind: 'tsumo', han: win.han, fu: win.fu, yaku: win.yaku, payments, skills: skillLog });
      effects.push({ type: 'scores', scores: s.players.map((x) => x.score) });
      finish(s, effects, 'normal');
      break;
    }

    case 'ron': {
      const winner = action.player;
      if (winner === action.from) return fail('不能荣和自己的牌');
      if (s.agariThisTurn.includes(winner)) return fail('本巡已经荣和过了');
      // 来源：打出的牌 或 抢杠（加杠任意家；暗杠仅国士由 calcWin 判定）
      const fromDiscard =
        s.lastDiscard && s.lastDiscard.player === action.from && s.lastDiscard.tile === action.tile;
      const fromKakan =
        s.pendingKakan && s.pendingKakan.player === action.from && s.pendingKakan.tile === action.tile;
      if (!fromDiscard && !fromKakan) return fail('没有可荣和的牌');
      const win = (opts.calcWin ?? winFromState)(s, winner, 'ron', action.tile, !!fromKakan);
      let win2 = win;
      // 无役但拥有「无役亦可和」技能 → 按 0 番放行
      if (!win2 && (opts.skillsOf(winner) ?? []).some((sk) => sk.forceWin)) {
        win2 = { kind: 'ron', yaku: ['无役和牌（技能）'], han: 0, fu: 30, decomp: null };
      }
      if (!win2) return fail('无役，不能荣和');
      const { payments: skillPayments, skillLog } = applyAgaruSkills(s, opts, winner, win2);
      const otherPayments: Payment[] = [];
      applyOtherAgaruSkills(s, opts, winner, otherPayments); // 他人和牌钩子（妄尊）
      const first = s.agariThisTurn.length === 0; // 頭跳ね：仅第一家和牌者得立直棒/本场
      const payments = [
        ...computePayments({ ...win2, kind: 'ron' }, winner, s.dealer, action.from, {
          riichiSticks: first ? s.riichiSticks : 0,
          honba: first ? s.round.honba : 0,
          kiriageMangan: s.rules.kiriageMangan,
        }),
        ...skillPayments,
        ...otherPayments,
      ];
      applyPayments(s, payments, opts);
      if (first) s.riichiSticks = 0;
      s.agariThisTurn.push(winner);
      clearIppatsu(s);
      effects.push({ type: 'agaru', winner, kind: 'ron', han: win2.han, fu: win2.fu, yaku: win2.yaku, payments, skills: skillLog });
      effects.push({ type: 'scores', scores: s.players.map((x) => x.score) });
      // 不立即结束：等待其他家荣和（一炮多响），由 pass 收尾
      break;
    }

    // ---- 关闭本巡响应窗口（无人再和/鸣） ----
    case 'pass': {
      if (s.agariThisTurn.length > 0) {
        // 一炮多响结算完毕 → 终局
        s.lastResult = { winners: [...s.agariThisTurn], tenpai: s.players.map((p) => p.log.tenpai) };
        finish(s, effects, 'normal');
        break;
      }
      s.pendingKakan = undefined;
      s.lastDiscard = undefined;
      effects.push({ type: 'passed' });
      break;
    }

    case 'ryukyoku': {
      return settleRyukyoku(s, opts, effects);
    }

    // ---- 九种九牌（第一巡，幺九种类 ≥ 9 可宣告流局） ----
    case 'kyuushu': {
      const p = s.players[s.current];
      if (s.turnCount !== 0) return fail('只能在第一巡宣告九种九牌');
      if (s.awaiting !== 'draw') return fail('摸牌前才能宣告九种九牌');
      const kinds = new Set(p.hand.filter((t) => isYaochuupaiLocal(t))).size;
      if (kinds < 9) return fail('幺九牌种类不足 9 种');
      return settleAbortive(s, effects, 'kyuushu');
    }

    // ---- 副露：吃 / 碰 / 大明杠 ----
    case 'chii':
    case 'pon':
    case 'kan': {
      const me = action.player;
      const disc = s.lastDiscard;
      if (s.agariThisTurn.length > 0) return fail('本巡已有和牌');
      if (!disc) return fail('没有可副露的牌');
      if (disc.tile !== action.tile) return fail('副露的牌不匹配');
      if (disc.player === me) return fail('不能副露自己打出的牌');
      if (action.type === 'chii' && me !== (disc.player + 1) % 4) return fail('只有下家能吃');
      // 刚烈：打出该牌者若拥有「不可被鸣」，则拒绝副露
      if (hasFlag(opts, disc.player, (sk) => !!sk.blocksCalls)) {
        return fail('对方的牌不能被鸣（刚烈）');
      }
      const p = s.players[me];
      if (p.log.riichi) return fail('立直后不能副露');

      // 从手牌取出需要的牌
      const need: Tile[] =
        action.type === 'chii'
          ? action.tiles
          : action.type === 'pon'
            ? [action.tile, action.tile]
            : [action.tile, action.tile, action.tile];
      const hand = [...p.hand];
      for (const t of need) {
        const i = hand.indexOf(t);
        if (i < 0) return fail('手牌不足，无法副露');
        hand.splice(i, 1);
      }
      // 吃必须是同花色连续顺子
      if (action.type === 'chii') {
        const trio = [...action.tiles, action.tile].sort((a, b) => a - b);
        const s0 = Math.floor(trio[0] / 10);
        if (
          s0 !== Math.floor(trio[1] / 10) ||
          s0 !== Math.floor(trio[2] / 10) ||
          trio[1] !== trio[0] + 1 ||
          trio[2] !== trio[1] + 1
        ) {
          return fail('吃牌必须是同花色顺子');
        }
      }

      p.hand = hand;
      const meld: Meld = {
        type: action.type === 'chii' ? 'chii' : action.type === 'pon' ? 'pon' : 'kan',
        tiles: [...need, action.tile].sort((a, b) => a - b),
        from: disc.player,
        calledTile: action.tile, // 被鸣的牌（UI 横置显示）
      };
      p.openMelds.push(meld);
      // 被鸣的牌从打牌者弃牌区移除，并记录「被鸣走」计数（往烈等技能依赖）
      const dp = s.players[disc.player];
      const di = dp.discards.indexOf(disc.tile);
      if (di >= 0) dp.discards.splice(di, 1);
      dp.log.calledCount += 1;
      s.lastDiscard = undefined;
      s.pendingKakan = undefined;
      s.current = me;
      s.awaiting = 'discard'; // 副露后直接进入打牌
      clearIppatsu(s); // 鸣牌打断一发
      effects.push({ type: 'called', player: me, from: disc.player, meld, handCount: p.hand.length });
      effects.push({ type: 'hand', player: me, tiles: [...p.hand], targetSeat: me });
      applyCallSkills(s, opts, me, action.type, effects); // 副露钩子（如「突袭」）
      break;
    }

    // ---- 暗杠（可被国士无双抢杠） ----
    case 'ankan': {
      const me = action.player;
      if (me !== s.current) return fail('未轮到');
      if (s.awaiting !== 'discard') return fail('摸牌后才能暗杠');
      const p = s.players[me];
      if (p.hand.filter((t) => t === action.tile).length < 4) return fail('暗杠需要手里 4 张相同牌');
      // 立直后暗杠：必须不改变听牌（用含副露的听牌判定）
      if (p.log.riichi) {
        const handAfter = [...p.hand];
        for (let k = 0; k < 4; k++) handAfter.splice(handAfter.indexOf(action.tile), 1);
        if (s.wall.length > 0) handAfter.push(s.wall[s.wall.length - 1]); // 模拟岭上摸
        const meldsAfter: Meld[] = [
          ...p.openMelds,
          { type: 'ankan', tiles: [action.tile, action.tile, action.tile, action.tile] },
        ];
        if (!keepsRiichiTenpai(p, handAfter, meldsAfter)) return fail('立直后暗杠不能改变听牌');
      }
      for (let k = 0; k < 4; k++) p.hand.splice(p.hand.indexOf(action.tile), 1);
      const meld: Meld = { type: 'ankan', tiles: [action.tile, action.tile, action.tile, action.tile] };
      p.openMelds.push(meld);
      effects.push({ type: 'called', player: me, from: me, meld, handCount: p.hand.length });
      // 岭上摸牌（从岭上区取牌）
      if (s.rinshanWall.length > 0) {
        const rinshan = s.rinshanWall.pop()!;
        p.hand.push(rinshan);
        s.rinshan = true; // 岭上开花标志
        effects.push({ type: 'drawn', player: me, tile: rinshan, targetSeat: me });
      }
      effects.push({ type: 'hand', player: me, tiles: [...p.hand], targetSeat: me });
      // 杠后翻开新宝牌
      if (s.doraCount < 5) s.doraCount += 1;
      effects.push({ type: 'dora', indicators: s.doraIndicators.slice(0, s.doraCount) });
      // 抢杠窗口：暗杠仅国士无双可抢
      s.pendingKakan = { player: me, tile: action.tile, kind: 'ankan' };
      effects.push({ type: 'chankan-window', player: me, tile: action.tile, kind: 'ankan' });
      clearIppatsu(s);
      applyCallSkills(s, opts, me, 'ankan', effects); // 杠也触发副露钩子
      // 四杠散了 → 途中流局
      if (totalKantsu(s) >= 4) return settleAbortive(s, effects, 'suukantsu');
      break;
    }

    // ---- 加杠（碰过的刻子 + 摸到第 4 张；任意家可抢杠） ----
    case 'kakan': {
      const me = action.player;
      if (me !== s.current) return fail('未轮到');
      if (s.awaiting !== 'discard') return fail('摸牌后才能加杠');
      const p = s.players[me];
      const meld = p.openMelds.find((m) => m.type === 'pon' && m.tiles[0] === action.tile);
      if (!meld) return fail('没有对应的碰');
      const i = p.hand.indexOf(action.tile);
      if (i < 0) return fail('手里没有第 4 张');
      // 立直后加杠：必须不改变听牌
      if (p.log.riichi) {
        const handAfter = [...p.hand];
        handAfter.splice(handAfter.indexOf(action.tile), 1);
        if (s.wall.length > 0) handAfter.push(s.wall[s.wall.length - 1]);
        const meldsAfter: Meld[] = p.openMelds.map((m) =>
          m === meld ? { type: 'kakan' as const, tiles: [action.tile, action.tile, action.tile, action.tile] } : m,
        );
        if (!keepsRiichiTenpai(p, handAfter, meldsAfter)) return fail('立直后加杠不能改变听牌');
      }
      p.hand.splice(i, 1);
      meld.type = 'kakan';
      meld.tiles = [action.tile, action.tile, action.tile, action.tile];
      // 岭上摸牌（从岭上区取牌）
      if (s.rinshanWall.length > 0) {
        const rinshan = s.rinshanWall.pop()!;
        p.hand.push(rinshan);
        s.rinshan = true; // 岭上开花标志
        effects.push({ type: 'drawn', player: me, tile: rinshan, targetSeat: me });
      }
      effects.push({ type: 'called', player: me, from: me, meld, handCount: p.hand.length });
      effects.push({ type: 'hand', player: me, tiles: [...p.hand], targetSeat: me });
      // 杠后翻开新宝牌
      if (s.doraCount < 5) s.doraCount += 1;
      effects.push({ type: 'dora', indicators: s.doraIndicators.slice(0, s.doraCount) });
      // 抢杠窗口：加杠任意家可抢
      s.pendingKakan = { player: me, tile: action.tile, kind: 'kakan' };
      effects.push({ type: 'chankan-window', player: me, tile: action.tile, kind: 'kakan' });
      clearIppatsu(s);
      applyCallSkills(s, opts, me, 'kakan', effects); // 杠也触发副露钩子
      // 四杠散了 → 途中流局
      if (totalKantsu(s) >= 4) return settleAbortive(s, effects, 'suukantsu');
      break;
    }
  }

  s.version += 1;
  return { state: s, effects };
}

// ---------- 内部结算 ----------

/** 和牌技能钩子：按 priority 依次结算，技能可改 han/fu 或追加点棒转移 */
function applyAgaruSkills(
  s: GameState,
  opts: StepOptions,
  winner: number,
  win: WinInfo,
): { payments: Payment[]; skillLog: { skill: string; han: number; fu: number }[] } {
  // 把手牌拆解转成 Meld[]，供技能统计面子（如「武圣」「制衡」）
  const handMelds: Meld[] = (win.decomp?.mentsu ?? []).map((m) =>
    m.kind === 'shuntsu'
      ? { type: 'chii' as const, tiles: [m.anchor, m.anchor + 1, m.anchor + 2] }
      : { type: 'pon' as const, tiles: [m.anchor, m.anchor, m.anchor] },
  );
  const payments: Payment[] = [];
  const skillLog: { skill: string; han: number; fu: number }[] = [];
  const ctx: AgaruContext = {
    seat: winner,
    state: s,
    winInfo: win,
    handMelds,
    openMelds: s.players[winner].openMelds,
    discards: s.players[winner].log.discards,
    // 渐营：判定「连续三张同类」时被鸣走的牌不算（用未被鸣走的弃牌序列）
    discardTiles: [...s.players[winner].discards],
    payments,
    skillLog,
  };
  const skills = (opts.skillsOf(winner) ?? [])
    .filter((sk) => sk.onAgaru)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const sk of skills) {
    const beforeHan = win.han;
    const beforeFu = win.fu;
    sk.onAgaru!(ctx);
    const dh = win.han - beforeHan;
    const df = win.fu - beforeFu;
    if (dh !== 0 || df !== 0) skillLog.push({ skill: sk.name, han: dh, fu: df });
  }
  // 技能减番下限为 0：按设定「暴敛」等技能可以把番数扣到 0 番 —— 此时仍可和牌
  //（役种依然存在，只是番数为 0；和牌者照常收走场上全部立直棒）
  if (win.han < 0) win.han = 0;
  return { payments, skillLog };
}

/** 某座位是否拥有满足条件的技能 */
function hasFlag(opts: StepOptions, seat: number, pred: (sk: Skill) => boolean): boolean {
  return (opts.skillsOf(seat) ?? []).some(pred);
}

/** 他人和牌时触发其余玩家的技能（如妄尊：和牌者付袁术 1000） */
function applyOtherAgaruSkills(
  s: GameState,
  opts: StepOptions,
  winner: number,
  payments: Payment[],
): void {
  for (let seat = 0; seat < 4; seat++) {
    if (seat === winner) continue;
    const skills = (opts.skillsOf(seat) ?? [])
      .filter((sk) => sk.onOtherAgaru)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    if (skills.length === 0) continue;
    const ctx: OtherAgaruContext = { seat, state: s, winner, payments };
    for (const sk of skills) sk.onOtherAgaru!(ctx);
  }
}

/** 触发全体玩家的副露钩子（如「突袭」：副露者付 500） */
function applyCallSkills(
  s: GameState,
  opts: StepOptions,
  caller: number,
  kind: 'chii' | 'pon' | 'kan' | 'ankan' | 'kakan',
  effects: GameEffect[],
): void {
  const payments: Payment[] = [];
  const names: string[] = [];
  for (let seat = 0; seat < 4; seat++) {
    const ctx: CallContext = { seat, state: s, caller, kind, payments };
    const skills = (opts.skillsOf(seat) ?? [])
      .filter((sk) => sk.onCall)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    for (const sk of skills) {
      const before = payments.length;
      sk.onCall!(ctx);
      if (payments.length > before) names.push(sk.name);
    }
  }
  if (payments.length > 0) {
    applyPayments(s, payments, opts);
    effects.push({ type: 'skill-pay', skill: names.join('、') || '技能', payments });
    effects.push({ type: 'scores', scores: s.players.map((p) => p.score) });
  }
}

/** 荒牌流局结算：流局满贯 / 基础罚符 + 各玩家技能，随后统一入账 */
function settleRyukyoku(s: GameState, opts: StepOptions, effects: GameEffect[]): StepResult {
  const payments: Payment[] = [];
  // 计算听牌状态（流局罚符与连庄判定都依赖它）
  const tenpai = s.players.map((p) => calcTenpai(p.hand).length > 0);
  s.players.forEach((p, i) => {
    p.log.tenpai = tenpai[i];
  });
  const nTen = tenpai.filter(Boolean).length;

  // 暴敛等技能：拥有者听牌时「接管」流局结算 → 屏蔽基础罚符分配
  const suppressed = s.players.some(
    (p, i) => p.log.tenpai && hasFlag(opts, i, (sk) => !!sk.suppressesRyukyoku),
  );

  // 流局满贯（弃牌全部幺九、未被鸣、门清）→ 按满贯自摸结算，不支付罚符
  const nagashi = s.players.map(
    (p) =>
      p.log.discards > 0 &&
      p.log.discards === p.discards.length && // 弃牌未被鸣走
      p.openMelds.length === 0 &&
      p.discards.every((t) => isYaochuupaiLocal(t)),
  );
  if (nagashi.some(Boolean)) {
    for (let seat = 0; seat < 4; seat++) {
      if (!nagashi[seat]) continue;
      payments.push(
        ...computePayments({ kind: 'tsumo', yaku: ['流局满贯'], han: 5, fu: 30 }, seat, s.dealer, undefined, {
          kiriageMangan: s.rules.kiriageMangan,
        }),
      );
    }
  } else if (!suppressed && nTen > 0 && nTen < 4) {
    // 基础流局罚符：不听者 子1000 / 亲2000，听牌者平分（被技能接管时不结算）
    let total = 0;
    const payers: { seat: number; amount: number }[] = [];
    for (let seat = 0; seat < 4; seat++) {
      if (tenpai[seat]) continue;
      const amount = seat === s.dealer ? 2000 : 1000;
      payers.push({ seat, amount });
      total += amount;
    }
    const share = Math.floor(total / nTen / 100) * 100;
    const tenpaiSeats = tenpai.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    for (let i = 0; i < nTen; i++) {
      const to = tenpaiSeats[i];
      const amount = i === 0 ? share + (total - share * nTen) : share;
      payments.push({ from: -1, to, amount });
    }
    for (const { seat, amount } of payers) payments.push({ from: seat, to: -1, amount });
  }

  // 技能结算（三国杀式：在基础规则之上追加，优先级更高）
  for (let seat = 0; seat < 4; seat++) {
    const ctx: RyukyokuContext = { seat, state: s, tenpai: tenpai[seat], payments };
    const skills = (opts.skillsOf(seat) ?? [])
      .filter((sk) => sk.onRyukyoku)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    for (const sk of skills) sk.onRyukyoku!(ctx);
  }

  applyPayments(s, payments, opts);
  effects.push({ type: 'ryukyoku', tenpai, payments, kind: 'howanpai' });
  effects.push({ type: 'scores', scores: s.players.map((x) => x.score) });
  finish(s, effects, 'ryukyoku');
  return { state: s, effects };
}

function applyPayments(s: GameState, payments: Payment[], opts?: StepOptions): void {
  // 技能可在支付前修改金额（如「往烈」：每张被鸣走的牌减 1000，最低 0）
  if (opts) {
    for (const pay of payments) {
      if (pay.from < 0) continue;
      const skills = (opts.skillsOf(pay.from) ?? []).filter((sk) => sk.onPay);
      for (const sk of skills) sk.onPay!({ seat: pay.from, state: s, payment: pay });
    }
  }
  for (const { from, to, amount } of payments) {
    if (from >= 0) s.players[from].score -= amount;
    if (to >= 0) s.players[to].score += amount;
  }
}

/** 鸣牌打断一发 */
function clearIppatsu(s: GameState): void {
  for (const p of s.players) {
    if (p.log.ippatsu) p.log.ippatsu = false;
  }
  s.anyCall = true; // 本局有鸣牌（双立直失效）
}

/** 立直后操作（暗杠/加杠）是否保持原听牌集合不变 */
function keepsRiichiTenpai(p: PlayerState, handWithDraw: Tile[], melds: Meld[]): boolean {
  const oldKey = (p.log.riichiTenpai ?? [])
    .slice()
    .sort((a, b) => a - b)
    .join(',');
  if (!oldKey) return true;
  for (let i = 0; i < handWithDraw.length; i++) {
    const rest = handWithDraw.filter((_, j) => j !== i); // 模拟打出待打牌
    const tp = calcTenpaiWithMelds(rest, melds)
      .slice()
      .sort((a, b) => a - b)
      .join(',');
    if (tp === oldKey) return true;
  }
  return false;
}

/** 全场杠数（大明杠 + 暗杠 + 加杠） */
function totalKantsu(s: GameState): number {
  return s.players.reduce(
    (a, p) => a + p.openMelds.filter((m) => m.type === 'kan' || m.type === 'ankan' || m.type === 'kakan').length,
    0,
  );
}

/** 幺九牌（1/9 数牌 + 字牌） */
function isYaochuupaiLocal(t: Tile): boolean {
  if (t >= 31) return true;
  const n = t % 10;
  return n === 1 || n === 9;
}

/**
 * 途中流局（九种九牌 / 四风连打 / 四杠散了 / 四家立直）：
 * 无罚符、无听牌结算，直接结束（不连庄）
 */
function settleAbortive(
  s: GameState,
  effects: GameEffect[],
  kind: 'kyuushu' | 'suufon' | 'suukantsu' | 'suuchariichi',
): StepResult {
  s.players.forEach((p) => {
    p.log.tenpai = false;
  });
  s.lastResult = { winners: [], tenpai: [false, false, false, false] };
  effects.push({ type: 'ryukyoku', tenpai: [false, false, false, false], payments: [], kind });
  finish(s, effects, 'ryukyoku');
  return { state: s, effects };
}

/** 终局：雀魂规则，有人点数 < 0 立即结束（飞人），照常结算 */
function finish(s: GameState, effects: GameEffect[], reason: 'normal' | 'ryukyoku'): void {
  const tobi = s.players.some((p) => p.score < 0);
  s.phase = 'ended';
  s.reason = tobi ? 'tobi' : reason;
  if (!s.lastResult) s.lastResult = { winners: [], tenpai: s.players.map((p) => p.log.tenpai) };
  effects.push({ type: 'gameEnded', scores: s.players.map((p) => p.score), reason: s.reason });
}

/**
 * 一局结束后推进到下一局（连庄 / 进庄 / 整场结束）。
 * - 亲家和牌 或 亲家听牌流局 → 连庄（本场 +1）
 * - 否则进庄（庄家移下家、局数推进、本场归 0）
 * - 飞人 / 南 4 局结束 → 返回原状态（表示整场结束）
 */
export function advanceRound(s: GameState): GameState {
  if (s.phase !== 'ended') return s;
  if (s.reason === 'tobi') return s;
  const res = s.lastResult;
  const dealer = s.dealer;
  const dealerWon = res ? res.winners.includes(dealer) : false;
  const dealerTenpai = res ? res.tenpai[dealer] : false;
  const renchan = s.reason === 'normal' ? dealerWon : s.reason === 'ryukyoku' ? dealerTenpai : false;

  // 终局判定（非连庄时）：
  // 半庄（南 4 局）结束若无人达到返点 → 进入延长战（西场）；
  // 延长战中达成返点或西 4 局结束 → 终局。
  if (!renchan) {
    const { wind, round: rr } = s.round;
    const reachedOrigin = Math.max(...s.players.map((p) => p.score)) >= s.rules.origin;
    if (wind === 'south' && rr === 4 && reachedOrigin) return s;
    if (wind === 'west' && (reachedOrigin || rr === 4)) return s;
  }

  const round: RoundInfo = renchan
    ? { ...s.round, honba: s.round.honba + 1 }
    : { ...nextRoundInfo(s.round), honba: 0 };
  const nextDealer = renchan ? dealer : (dealer + 1) % 4;

  const seats: SeatConfig[] = s.players.map((p) => ({ name: p.name, generalId: p.generalId, isAI: p.isAI }));
  const next = createGame(seats, { seed: s.seed + s.turnCount + 1, round, initialScore: 0, rules: s.rules });
  next.players.forEach((p, i) => {
    p.score = s.players[i].score;
  });
  next.dealer = nextDealer;
  next.current = nextDealer; // 庄家先摸
  next.riichiSticks = s.riichiSticks;
  return next;
}

function nextRoundInfo(r: RoundInfo): RoundInfo {
  if (r.round < 4) return { wind: r.wind, round: r.round + 1, honba: 0 };
  return { wind: r.wind === 'east' ? 'south' : 'west', round: 1, honba: 0 };
}

/** 场风（局信息 → 牌编码） */
const WIND_TILE: Record<string, number> = { east: 31, south: 32, west: 33, north: 34 };

/**
 * 默认和牌判定：evaluateAgari 真判定（自摸取手牌末张，荣和取 action.tile）
 * 役满番数记为 13×倍数（点数表按 han>=13 走役满档；双倍役满点数待 scoring 细化）
 */
function winFromState(
  s: GameState,
  seat: number,
  kind: 'tsumo' | 'ron',
  agariPai: number,
  chankan = false,
): WinInfo | null {
  const p = s.players[seat];
  const juntehai = kind === 'tsumo' ? p.hand.slice(0, -1) : p.hand;
  const r = evaluateAgari({
    juntehai,
    agariPai,
    fuuro: p.openMelds,
    menzen: p.openMelds.length === 0,
    isTsumo: kind === 'tsumo',
    riichi: { accepted: p.log.riichi, double: !!p.log.doubleRiichi, ippatsu: p.log.ippatsu },
    rinshan: kind === 'tsumo' && s.rinshan,
    chankan,
    isHaitei: s.isHaitei,
    virgin: s.turnCount === 0,
    agariPlayer: seat,
    chancha: s.dealer,
    bakaze: WIND_TILE[s.round.wind], // 场风由局信息决定
    jikaze: 31 + ((seat - s.dealer + 4) % 4), // 自风 = 庄家起顺时针
    kuitan: true,
    doraIndicators: s.doraIndicators.slice(0, s.doraCount),
    uraIndicators: p.log.riichi ? s.uraIndicators.slice(0, s.doraCount) : undefined,
  });
  if (!r) return null;
  if (r.yakumanTotal > 0) {
    return { kind, yaku: r.yakuman.map((y) => y.name), han: r.yakumanTotal * 13, fu: 0, decomp: null };
  }
  return { kind, yaku: r.yaku.map((y) => y.name), han: r.hanTotal, fu: r.fu, decomp: r.winDecomp };
}
