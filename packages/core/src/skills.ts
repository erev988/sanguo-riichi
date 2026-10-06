import type { Payment } from './effects';
import type { WinInfo } from './scoring';
import type { GameState, Meld, Tile } from './types';
import { isMan, suitOf } from './types';

// ============================================================================
// 技能系统（三国杀式：技能效果优先级高于基础规则，在其之上追加/覆盖）
// ============================================================================

export interface SkillContext {
  seat: number;
  state: GameState;
}

/** 和牌结算钩子上下文 */
export interface AgaruContext extends SkillContext {
  /** 已算出的基础役/番/符；技能可修改 han / fu */
  winInfo: WinInfo;
  /** 手牌面子拆解（由和牌判定给出） */
  handMelds: Meld[];
  openMelds: Meld[];
  /** 本局已打出牌数 */
  discards: number;
  /** 本局完整弃牌历史（含被鸣走的牌，按打出顺序） */
  discardTiles: Tile[];
  /** 技能可追加点棒转移（如先制立直和牌 +1000/家） */
  payments: Payment[];
  /** 技能结算记录：某技能改了多少番/符（供结算面板展示） */
  skillLog: { skill: string; han: number; fu: number }[];
}

/** 荒牌流局结算钩子上下文 */
export interface RyukyokuContext extends SkillContext {
  /** 自己是否听牌（结算前已按真实手牌算好） */
  tenpai: boolean;
  /** 已含基础流局罚符；技能可追加 */
  payments: Payment[];
}

/** 有人吃/碰/杠时的钩子上下文 */
export interface CallContext extends SkillContext {
  /** 副露者座位 */
  caller: number;
  kind: 'chii' | 'pon' | 'kan' | 'ankan' | 'kakan';
  /** 技能可追加点棒转移（如突袭：副露者付 500） */
  payments: Payment[];
}

/** 他人和牌时的钩子上下文（如妄尊：和牌者付 1000） */
export interface OtherAgaruContext extends SkillContext {
  /** 和牌者座位（≠ 自己） */
  winner: number;
  /** 技能可追加点棒转移 */
  payments: Payment[];
}

/** 付出点数时的钩子上下文（如往烈：减少支付金额） */
export interface PayContext extends SkillContext {
  /** 待处理的支付（技能可改 amount，最低 0，不能变收钱） */
  payment: Payment;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  /** 同玩家多技能时的结算顺序，数字小的先结算 */
  priority?: number;
  /** 自己和牌时（可改番符 / 追加转移） */
  onAgaru?: (ctx: AgaruContext) => void;
  /** 他人和牌时（追加转移，如妄尊向和牌者收 1000；不能改他人番数） */
  onOtherAgaru?: (ctx: OtherAgaruContext) => void;
  onRyukyoku?: (ctx: RyukyokuContext) => void;
  onCall?: (ctx: CallContext) => void;
  /** 你需要付出点数时（可减少支付金额，如「往烈」） */
  onPay?: (ctx: PayContext) => void;
  /** 你打出的牌不可被吃 / 碰 / 杠（刚烈） */
  blocksCalls?: boolean;
  /** 先制立直后封锁他人立直（妄尊） */
  locksRiichi?: boolean;
  /** 你听牌时接管流局罚符结算：屏蔽其他听牌者的罚符收入（暴敛） */
  suppressesRyukyoku?: boolean;
  /** 突破「必须有役」：拥有此技能时，即使无役也可和牌（按 0 番结算） */
  forceWin?: boolean;
}

// ============================================================================
// 武将技能实现
// ============================================================================

// ---------- 关羽「武圣」（蜀）：万面子加番 ----------
export const wusheng: Skill = {
  id: 'wusheng',
  name: '武圣',
  desc: '当你胡牌时，每有一个万牌面子，和牌加 1 番。',
  onAgaru: (ctx) => {
    const count = [...ctx.openMelds, ...ctx.handMelds].filter(
      (m) => m.tiles.length > 0 && m.tiles.every(isMan),
    ).length;
    if (count > 0) ctx.winInfo.han += count;
  },
};

// ---------- 沮授「渐营」（群）：连续三张同类牌加番 ----------
// 滑动窗口：弃牌序列中每出现「连续 3 张同类牌（万/饼/索/字）」就 +1 番，可累计
export const jianying: Skill = {
  id: 'jianying',
  name: '渐营',
  desc: '当你连续三张打出一类牌（同一花色或字牌）时，和牌加 1 番，可累计。',
  onAgaru: (ctx) => {
    const t = ctx.discardTiles;
    let bonus = 0;
    for (let i = 0; i + 2 < t.length; i++) {
      const a = suitOf(t[i]);
      const b = suitOf(t[i + 1]);
      const c = suitOf(t[i + 2]);
      if (a === b && b === c) bonus++;
    }
    ctx.winInfo.han += bonus;
  },
};

// ---------- 司马懿「忍戒」（魏）：流局征收 ----------
export const renjie: Skill = {
  id: 'renjie',
  name: '忍戒',
  desc: '当牌局“荒牌流局”结束时，其余三位对手各付你 2000 点。',
  onRyukyoku: (ctx) => {
    for (let seat = 0; seat < 4; seat++) {
      if (seat === ctx.seat) continue;
      ctx.payments.push({ from: seat, to: ctx.seat, amount: 2000 });
    }
  },
};

// ---------- 张辽「突袭」（魏）：副露者付 500 ----------
export const tuxi: Skill = {
  id: 'tuxi',
  name: '突袭',
  desc: '当有人吃 / 碰 / 杠时，该玩家付你 500 点。',
  onCall: (ctx) => {
    if (ctx.caller === ctx.seat) return; // 自己副露不触发
    ctx.payments.push({ from: ctx.caller, to: ctx.seat, amount: 500 });
  },
};

// ---------- 袁术「妄尊」（群）：先制立直封锁 + 向他人和牌收费 ----------
export const wangzun: Skill = {
  id: 'wangzun',
  name: '妄尊',
  desc: '当你先制立直（场上第一个立直）时，其他人无法立直；此后其他人和牌时，须付你 1000 点（你自己和牌时不触发）。',
  locksRiichi: true,
  onOtherAgaru: (ctx) => {
    const p = ctx.state.players[ctx.seat];
    if (!p.log.firstRiichi) return; // 需先制立直过
    if (ctx.winner === ctx.seat) return; // 自己和牌不触发
    ctx.payments.push({ from: ctx.winner, to: ctx.seat, amount: 1000 });
  },
};

// ---------- 董卓「暴敛」（群）：弃牌档位 + 接管流局结算 ----------
export const baolian: Skill = {
  id: 'baolian',
  name: '暴敛',
  desc:
    '和牌时按你已打出的牌数改番：≤8 张 +3 番；9~12 张 +1 番；>12 张 -2 番（下限 0）。' +
    '流局时：你听牌则不管别人听不听、所有人各付你 2000（且其他听牌者收不到罚符）；' +
    '你未听牌则其他人正常结算，你额外付 2000（分给听牌者）。',
  suppressesRyukyoku: true,
  onAgaru: (ctx) => {
    const d = ctx.discards;
    if (d <= 8) ctx.winInfo.han += 3;
    else if (d <= 12) ctx.winInfo.han += 1;
    else ctx.winInfo.han -= 2;
  },
  onRyukyoku: (ctx) => {
    const me = ctx.seat;
    const others = [0, 1, 2, 3].filter((s) => s !== me);
    if (ctx.tenpai) {
      // 听牌：所有人（不管听没听）各付 2000
      for (const s of others) ctx.payments.push({ from: s, to: me, amount: 2000 });
    } else {
      // 未听牌：额外付 2000（分给听牌者）
      const winners = others.filter((s) => ctx.state.players[s].log.tenpai);
      if (winners.length > 0) {
        ctx.payments.push({ from: me, to: -1, amount: 2000 });
        for (const w of winners) {
          ctx.payments.push({ from: -1, to: w, amount: Math.floor(2000 / winners.length) });
        }
      }
    }
  },
};

// ---------- 孙权「制衡」（吴）：索子一气通贯加番 ----------
export const zhiheng: Skill = {
  id: 'zhiheng',
  name: '制衡',
  desc: '当你和牌的手牌中有索子的一气通贯（123s + 456s + 789s）时，和牌加 3 番。',
  onAgaru: (ctx) => {
    const shuntsu = [...ctx.handMelds, ...ctx.openMelds].filter(
      (m) => m.type === 'chii' && m.tiles.length >= 3,
    );
    const has = (a: Tile, b: Tile, c: Tile) =>
      shuntsu.some((m) => m.tiles[0] === a && m.tiles[1] === b && m.tiles[2] === c);
    if (has(21, 22, 23) && has(24, 25, 26) && has(27, 28, 29)) {
      ctx.winInfo.han += 3;
    }
  },
};

// ---------- 陈到「往烈」（蜀）：被鸣走则减少支付 ----------
export const wanglie: Skill = {
  id: 'wanglie',
  name: '往烈',
  desc: '本局中你每有一张打出的牌被鸣走（被吃/碰/杠），你付出点数时减 1000（最低 0）。',
  onPay: (ctx) => {
    const n = ctx.state.players[ctx.seat].log.calledCount;
    if (n > 0) ctx.payment.amount = Math.max(0, ctx.payment.amount - n * 1000);
  },
};

// ---------- 袁绍「乱击」（群）：可无役和牌；无役 -1 番，有役 +1 番 ----------
export const luanji: Skill = {
  id: 'luanji',
  name: '乱击',
  desc: '你可以无役和牌；无役和牌时番数 -1，若手中有役则和牌番数 +1。',
  forceWin: true,
  onAgaru: (ctx) => {
    // 宝牌 / 里宝牌 / 赤宝牌 不算「役」；技能放行的无役和牌同样不算
    const notYaku = new Set(['宝牌', '里宝牌', '赤宝牌', '无役和牌（技能）']);
    const hasYaku = ctx.winInfo.yaku.some((y) => !notYaku.has(y));
    ctx.winInfo.han += hasYaku ? 1 : -1;
  },
};

// ---------- 夏侯惇「刚烈」（魏）：弃牌不可被鸣 ----------
export const ganglie: Skill = {
  id: 'ganglie',
  name: '刚烈',
  desc: '你打出的牌不可以被吃 / 碰 / 杠。',
  blocksCalls: true,
};
