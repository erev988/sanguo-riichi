import { sha256Hex, sha256Rng } from './sha256';
// ============================================================================
// 牌与状态基础类型
// 编码采用 riichi-core 的 6-bit 方案（0..37）：
//   万1-9 (1-9，0=赤5m)  饼1-9 (11-19，10=赤5p)  索1-9 (21-29，20=赤5s)
//   东南西北白发中 (31-37)  30 = NULL（保留）
// ============================================================================

import type { Rules } from './rules';

export type Suit = 'man' | 'pin' | 'sou' | 'honor' | 'null';export type Tile = number;

export const MAN_BASE = 0;
export const PIN_BASE = 10;
export const SOU_BASE = 20;
export const HONOR_BASE = 31;

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];

export function suitOf(t: Tile): Suit {
  if (t <= 9) return 'man';
  if (t <= 19) return 'pin';
  if (t <= 29) return 'sou';
  if (t >= HONOR_BASE) return 'honor';
  return 'null'; // 30
}

export function rankOf(t: Tile): number {
  const r = t % 10;
  return r === 0 ? 5 : r; // 赤5 视为 5
}

export function isMan(t: Tile): boolean {
  return t <= 9;
}

export function isHonor(t: Tile): boolean {
  return t >= HONOR_BASE;
}

export function isAka(t: Tile): boolean {
  return t === 0 || t === 10 || t === 20;
}

export function tileName(t: Tile): string {
  if (t === 0 || t === 10 || t === 20) {
    return `0${'mps'[t / 10]}`; // 赤宝牌显示 0m/0p/0s
  }
  if (isHonor(t)) return HONOR_NAMES[t - HONOR_BASE];
  const suit = suitOf(t);
  const abbr = suit === 'man' ? 'm' : suit === 'pin' ? 'p' : 's';
  return `${rankOf(t)}${abbr}`;
}

// ---- 面子 ----
export type MeldType = 'chii' | 'pon' | 'kan' | 'ankan' | 'kakan';

export interface Meld {
  type: MeldType;
  tiles: Tile[];
  /** 从谁那里吃/碰/大明杠（0-3） */
  from?: number;
  /** 被鸣的那张牌（用于 UI 横置显示；暗杠/加杠无） */
  calledTile?: Tile;
}

// ---- 玩家 ----
export interface PlayerLog {
  /** 本局已打出的牌数（技能二依赖） */
  discards: number;
  /** 完整弃牌历史（含被鸣走的牌；数据留存，当前未被技能使用） */
  discardTiles: Tile[];
  /** 本局被鸣走（被吃/碰/杠）的牌数（陈到「往烈」依赖） */
  calledCount: number;
  riichi: boolean;
  /** 一发有效（立直后一巡内，无鸣牌打断） */
  ippatsu: boolean;
  /** 双立直（第一巡立直） */
  doubleRiichi?: boolean;
  /** 先制立直（场上第一个立直） */
  firstRiichi?: boolean;
  /** 立直宣言时的听牌集合（立直后暗杠/加杠需保持不变听牌） */
  riichiTenpai?: Tile[];
  /** 流局时是否听牌（由和牌判定给出） */
  tenpai: boolean;
}

export interface PlayerState {
  seat: number;
  name: string;
  generalId: string;
  isAI: boolean;
  score: number;
  /** 手牌：服务器私有，绝不广播给其他座位 */
  hand: Tile[];
  openMelds: Meld[];
  discards: Tile[];
  log: PlayerLog;
}

// ---- 对局 ----
export type Phase = 'playing' | 'ended';
export type Wind = 'east' | 'south' | 'west' | 'north';

export interface RoundInfo {
  wind: Wind;
  round: number;
  honba: number;
}

// ---- 宝牌 ----

/** 宝牌：指示牌 → 实际宝牌（数牌 +1，风 东→南→西→北→东，三元 白→发→中→白） */
export function doraFromIndicator(indicator: Tile): Tile {
  if (indicator >= 1 && indicator <= 9) return indicator === 9 ? 1 : indicator + 1; // 万
  if (indicator >= 10 && indicator <= 19) return indicator === 19 ? 11 : indicator + 1; // 饼
  if (indicator >= 20 && indicator <= 29) return indicator === 29 ? 21 : indicator + 1; // 索
  if (indicator >= 31 && indicator <= 34) return indicator === 34 ? 31 : indicator + 1; // 风
  if (indicator >= 35 && indicator <= 37) return indicator === 37 ? 35 : indicator + 1; // 三元
  return indicator;
}

/** 统计一组牌中的宝牌张数（赤宝牌按其牌面 5 计入） */
export function countDora(tiles: Tile[], indicators: Tile[]): number {
  const doraSet = indicators.map(doraFromIndicator);
  let n = 0;
  for (const t of tiles) {
    const normalized = t === 0 ? 5 : t === 10 ? 15 : t === 20 ? 25 : t; // 赤 5 视作 5
    if (doraSet.includes(normalized)) n++;
  }
  return n;
}

/** 赤宝牌张数 */
export function countAka(tiles: Tile[]): number {
  return tiles.filter((t) => t === 0 || t === 10 || t === 20).length;
}

export interface GameState {
  /** 状态版本号：每次 step 递增，用于快照 / 断线重连补偿 */
  version: number;
  round: RoundInfo;
  /** 本局庄家座位 */
  dealer: number;
  /** 可摸牌山（服务器私有），剩余张数会作为公开信息广播 */
  wall: Tile[];
  /** 岭上牌（杠后补牌，4 张，服务器私有） */
  rinshanWall: Tile[];
  /** 宝牌指示牌（5 张，按翻开顺序；公开信息） */
  doraIndicators: Tile[];
  /** 里宝牌指示牌（5 张，仅立直和牌者可见） */
  uraIndicators: Tile[];
  /** 已翻开的宝牌指示牌数量（初始 1，每次杠 +1） */
  doraCount: number;
  players: PlayerState[];
  /** 当前行动座位 */
  current: number;
  /** 当前座位该做什么：摸牌 or 打牌（副露后直接进入打牌） */
  awaiting: 'draw' | 'discard';
  turnCount: number;
  lastDiscard?: { player: number; tile: Tile };
  /** 最近被杠的牌（加杠可被抢；暗杠仅国士可抢） */
  pendingKakan?: { player: number; tile: Tile; kind: 'kakan' | 'ankan' };
  /** 当前摸牌是否来自岭上（杠后补牌，制造「岭上开花」） */
  rinshan: boolean;
  /** 海底牌状态：已摸完牌山最后一张（海底摸月 / 河底捞鱼） */
  isHaitei: boolean;
  /** 本局是否有人鸣牌（副露/杠；影响双立直与一发） */
  anyCall: boolean;
  /** 各家第一张弃牌（四风连打判定） */
  firstDiscards: (Tile | null)[];
  /** 本巡已荣和的座位（支持一炮多响） */
  agariThisTurn: number[];
  /** 场上立直棒数量（每根 1000 点，立直时已从该玩家扣除） */
  riichiSticks: number;
  /** 先制立直封锁者（妄尊）：非 null 时其他人不能立直 */
  riichiLockBy?: number;
  phase: Phase;
  /** 结束原因：normal 正常和了 / tobi 飞人 / ryukyoku 荒牌流局 */
  reason?: 'normal' | 'tobi' | 'ryukyoku';
  /** 本局结果（供连庄判定） */
  lastResult?: { winners: number[]; tenpai: boolean[] };
  /** 本局规则（初始点数 / 返点 / 切上满贯） */
  rules: Rules;
  /** 本局发牌输入 = `服务器种子:盐`（局中保密；回放数据里保留以便验证与复现） */
  seed: string;
}

export interface SeatConfig {
  name: string;
  generalId: string;
  isAI: boolean;
}

// ---- 随机（确定性洗牌，服务端种子驱动，可回放） ----

/**
 * 洗牌随机源：SHA-256(种子+盐) 计数器流，密码学安全且确定性。
 * 相同 (服务器种子, 盐) → 永远同一副牌序（可复现 / 可验证）；
 * 局中种子保密 → 无法从已见牌推出后续牌序（不可枚举）。
 */
export function rngFromSeed(seed: string): () => number {
  return sha256Rng(seed);
}

/** 把 number / string 种子统一成 32 位 hex 字符串（number 仅测试用，展开为 128 位） */
export function normalizeSeed(seed?: number | string): string {
  if (typeof seed === 'string') return seed;
  if (typeof seed === 'number') {
    let s = seed >>> 0;
    let out = '';
    for (let i = 0; i < 4; i++) {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out += ((t ^ (t >>> 14)) >>> 0).toString(16).padStart(8, '0');
    }
    return out;
  }
  return '00000000000000000000000000000001'; // 兜底
}

/** 由旧种子派生新种子（确定性；128 位不可枚举，用于每局独立发牌） */
export function deriveSeed(seed: string): string {
  return sha256Hex(`${seed}:next-round`);
}



export function buildWall(rng: () => number): Tile[] {
  const tiles: Tile[] = [];
  for (let k = 1; k <= 9; k++) for (let i = 0; i < 4; i++) tiles.push(k); // 万
  for (let k = 11; k <= 19; k++) for (let i = 0; i < 4; i++) tiles.push(k); // 饼
  for (let k = 21; k <= 29; k++) for (let i = 0; i < 4; i++) tiles.push(k); // 索
  for (let k = 31; k <= 37; k++) for (let i = 0; i < 4; i++) tiles.push(k); // 字
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  // 赤宝牌（雀魂默认每花色 1 张赤5）：洗牌后随机选一张 5 替换
  replaceAka(tiles, rng, 5, 0);
  replaceAka(tiles, rng, 15, 10);
  replaceAka(tiles, rng, 25, 20);
  return tiles;
}

function replaceAka(tiles: Tile[], rng: () => number, from: Tile, to: Tile): void {
  const idxs: number[] = [];
  tiles.forEach((t, i) => {
    if (t === from) idxs.push(i);
  });
  if (!idxs.length) return;
  tiles[idxs[Math.floor(rng() * idxs.length)]] = to;
}
