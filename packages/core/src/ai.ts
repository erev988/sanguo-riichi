import type { Action } from './actions';
import { calcTenpai } from './tenpai';
import { shanten } from './shanten';
import type { GameState, Meld, Tile } from './types';

/**
 * AI 策略（M5 强化版）：
 * - 摸牌阶段：摸牌
 * - 打牌阶段：① 能自摸则和牌 ② 否则打出后向听数最小的牌（平手打孤立牌）
 *   ③ 门清听牌且未立直 → 立直
 * - 暂不主动副露（副露判断较复杂，留待后续）
 */

const ALL_TILES: Tile[] = [];
for (let k = 1; k <= 9; k++) ALL_TILES.push(k);
for (let k = 11; k <= 19; k++) ALL_TILES.push(k);
for (let k = 21; k <= 29; k++) ALL_TILES.push(k);
for (let k = 31; k <= 37; k++) ALL_TILES.push(k);

export function aiPlan(state: GameState, seat: number): Action[] {
  const p = state.players[seat];
  if (state.phase !== 'playing' || state.current !== seat) return [];

  if (state.awaiting === 'draw') {
    // 九种九牌（首巡幺九 ≥ 9 种）→ 主动宣告流局
    if (state.turnCount === 0) {
      const kinds = new Set(p.hand.filter(isYaochuu)).size;
      if (kinds >= 9) return [{ type: 'kyuushu' }];
    }
    return [{ type: 'draw' }];
  }
  if (state.awaiting !== 'discard') return [];

  const hand = p.hand;
  const last = hand[hand.length - 1];
  const juntehai = hand.slice(0, -1);

  // ① 自摸和牌
  if (hand.length === juntehai.length + 1 && calcTenpai(juntehai).includes(last)) {
    return [{ type: 'tsumo' }];
  }

  // ② 选打出后向听数最小的牌
  let bestTile = hand[0];
  let bestShanten = Infinity;
  let bestIso = Infinity;
  const seen = new Set<Tile>();
  for (let i = 0; i < hand.length; i++) {
    const t = hand[i];
    if (seen.has(t)) continue;
    seen.add(t);
    const rest = hand.filter((_, j) => j !== i);
    const sh = shanten(rest, p.openMelds);
    const iso = isolation(rest, t);
    if (sh < bestShanten || (sh === bestShanten && iso < bestIso)) {
      bestShanten = sh;
      bestTile = t;
      bestIso = iso;
    }
  }

  // ③ 立直判定：门清 + 打出后听牌（用与引擎一致的 calcTenpai）+ 未立直
  const rest13 = [...hand];
  rest13.splice(rest13.indexOf(bestTile), 1);
  const riichi = p.openMelds.length === 0 && !p.log.riichi && calcTenpai(rest13).length > 0;
  return [{ type: 'discard', tile: bestTile, riichi }];
}

/** 幺九牌（1/9 数牌 + 字牌） */
function isYaochuu(t: Tile): boolean {
  return t >= 31 || t % 10 === 1 || t % 10 === 9;
}

/** 牌的孤立程度：越小越该打（相邻牌/同牌越少） */
function isolation(hand: Tile[], t: Tile): number {
  // ★ 必须判同花色：此前直接用数值差，9m(9) 与 赤5p(10) 差 1 会被误判成「相邻」
  const norm = (v: Tile): Tile => (v === 0 ? 5 : v === 10 ? 15 : v === 20 ? 25 : v);
  const suitOf = (v: Tile): number => (v >= 31 ? 3 : Math.floor(v / 10));
  const numOf = (v: Tile): number => (v >= 31 ? v - 31 : v % 10);
  let rel = 0;
  for (const x of hand) {
    if (x === t) rel += 2;
    else if (suitOf(x) === suitOf(t)) {
      const d = Math.abs(numOf(norm(x)) - numOf(norm(t)));
      if (d === 1 || d === 2) rel += 1;
    }
  }
  return rel;
}

/** 有效牌种类数（进张），供将来更强的打牌选择使用 */
