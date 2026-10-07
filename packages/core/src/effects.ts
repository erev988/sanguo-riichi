import type { Action } from './actions';
import type { Meld, RoundInfo, Tile } from './types';

/** 单笔点棒转移（from/to 可为 -1 表示“流局基金”，见流局结算） */
export interface Payment {
  from: number;
  to: number;
  amount: number;
}

export interface SeatInfo {
  seat: number;
  name: string;
  generalId: string;
  isAI: boolean;
  score: number;
}

/**
 * 发给客户端的事件流（对应 riichi-core 的事件回调）。
 * targetSeat 表示“只发给该座位”（用于手牌/摸牌等私有信息）。
 */
export type GameEffect =
  | { type: 'gameStarted'; round: RoundInfo; dealer: number; seats: SeatInfo[] }
  | { type: 'hand'; player: number; tiles: Tile[]; targetSeat: number }
  | { type: 'drawn'; player: number; tile: Tile; targetSeat: number }
  | { type: 'discarded'; player: number; tile: Tile; riichi: boolean; handCount: number }
  | { type: 'called'; player: number; from: number; meld: Meld; handCount: number }
  /** 有人杠牌，其他家可抢杠（kakan 任意家；ankan 仅国士） */
  | { type: 'chankan-window'; player: number; tile: Tile; kind: 'kakan' | 'ankan' }
  /** 本巡荣和窗口关闭（无 pending），局面推进 */
  | { type: 'passed' }
  /** 技能触发的点棒转移（如「突袭」副露收费） */
  | { type: 'skill-pay'; skill: string; payments: Payment[] }
  /** 已翻开的宝牌指示牌（公开信息） */
  | { type: 'dora'; indicators: Tile[] }
  /** 牌山剩余张数（公开信息） */
  | { type: 'wall'; count: number }
  /** 该座位当前可执行的动作（私有，用于渲染吃/碰/杠/荣和按钮） */
  | { type: 'options'; actions: Action[]; targetSeat: number }
  /** 该座位的思考时限（私有，客户端据此显示倒计时） */
  | { type: 'timer'; seat: number; ms: number; total: number; targetSeat: number }
  | { type: 'scores'; scores: number[] }
  | {
      type: 'agaru';      winner: number;
      kind: 'tsumo' | 'ron';
      han: number;
      fu: number;
      yaku: string[];
      payments: Payment[];
      /** 本局和牌时各技能的影响（改了多少番/符） */
      skills?: { skill: string; han: number; fu: number }[];
      /** 和牌者手牌（含和牌张；和牌即公开） */
      hand?: number[];
      /** 和牌者的副露 */
      melds?: Meld[];
      /** 和牌张 */
      winTile?: number;
    }
  | {
      /** 定牌信息公开：局后公布，用于验证牌序未被篡改（provably fair） */
      type: 'seedReveal';
      /** 服务器种子（局后公开；局前只公布其哈希） */
      serverSeed: string;
      /** 各家贡献的随机数（未提交者由服务器代生成） */
      clientSeeds: string[];
      /** 最终盐 = sha256(serverSeed : clientSeeds...) */
      salt: string;
    }
  | { type: 'ryukyoku'; tenpai: boolean[]; payments: Payment[]; kind?: 'howanpai' | 'kyuushu' | 'suufon' | 'suukantsu' | 'suuchariichi' }
  | { type: 'gameEnded'; scores: number[]; reason: 'normal' | 'tobi' | 'ryukyoku' };
