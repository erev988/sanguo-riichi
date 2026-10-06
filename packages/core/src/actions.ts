import type { Tile } from './types';

/**
 * 客户端意图 / 服务器动作。
 * 副露动作带 player（声明者座位），由 step 校验座位关系。
 * 抢杠、加杠（kakan）等留待后续。
 */
export type Action =
  | { type: 'draw' }
  | { type: 'discard'; tile: Tile; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ron'; player: number; tile: Tile; from: number }
  | { type: 'ryukyoku' }
  /** 九种九牌（第一巡，幺九种类 ≥ 9 时宣告途中流局） */
  | { type: 'kyuushu' }
  /** 放弃荣和/副露，推进局面（打牌后等待窗口结束时发送） */
  | { type: 'pass' }
  // ---- 副露 ----
  | { type: 'chii'; player: number; tile: Tile; tiles: [Tile, Tile] }
  | { type: 'pon'; player: number; tile: Tile }
  | { type: 'kan'; player: number; tile: Tile } // 大明杠（碰别人打出的第 4 张）
  | { type: 'ankan'; player: number; tile: Tile } // 暗杠（自己回合手里 4 张）
  | { type: 'kakan'; player: number; tile: Tile }; // 加杠（碰过的刻子 + 摸到第 4 张）
