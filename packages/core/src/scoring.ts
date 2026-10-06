import type { Payment } from './effects';
import type { MentsuDecomp } from './agari';

/**
 * 和牌判定结果（基础规则部分）。
 * 正式版：由 riichi-core 的 Agaru / WinningHand 迁移而来，
 * 负责役种枚举、符数精确计算、无役不可和等。
 */
export interface WinInfo {
  kind: 'tsumo' | 'ron';
  yaku: string[];
  han: number;
  fu: number;
  /** 和牌拆解（供技能层统计面子，如「万面子加番」）；七对/国士为 null */
  decomp?: { mentsu: MentsuDecomp[]; jantou: number } | null;
}

/**
 * 点数计算（骨架参考实现，注释清楚、公式标准）。
 * 正式版：整体替换为从 riichi-core 迁移的 Scoring
 * （含精确符数、役满、立直棒/本场、双响分配、供托等细节）。
 */
export function computePayments(
  win: WinInfo,
  winner: number,
  dealer: number,
  loser?: number,
  opts: { riichiSticks?: number; honba?: number; kiriageMangan?: boolean } = {},
): Payment[] {
  const { han, fu, kind } = win;
  const dealerWin = winner === dealer;
  const honba = opts.honba ?? 0;
  const kiriage = opts.kiriageMangan ?? false;
  const out: Payment[] = [];

  // 番数分级：1=通常 2=满贯 3=跳满 4=倍满 6=三倍满 8=役满
  // 切上满贯：4 番 30 符 / 3 番 60 符 也算满贯
  const manganFu4 = kiriage ? 30 : 40;
  const manganFu3 = kiriage ? 60 : 70;
  const level =
    han >= 13
      ? 8
      : han >= 11
        ? 6
        : han >= 8
          ? 4
          : han >= 6
            ? 3
            : han >= 5 || (han === 4 && fu >= manganFu4) || (han === 3 && fu >= manganFu3)
              ? 2
              : 1;

  if (level === 1) {
    // 基础点 b = 符 × 2^(2+番)；荣和 4b（亲 6b），自摸按 子1b/亲2b 分摊，百位进位
    const b = fu * 2 ** (2 + han);
    const ceil100 = (n: number) => Math.ceil(n / 100) * 100;
    if (kind === 'ron' && loser != null) {
      out.push({ from: loser, to: winner, amount: dealerWin ? ceil100(6 * b) : ceil100(4 * b) });
    } else if (kind === 'tsumo') {
      for (let seat = 0; seat < 4; seat++) {
        if (seat === winner) continue;
        const amount = dealerWin ? ceil100(2 * b) : ceil100(seat === dealer ? 2 * b : b);
        out.push({ from: seat, to: winner, amount });
      }
    }
  } else {
    // 役满（han>=13）：点数 ×役满倍数。超出部分按整倍役满计（floor），
    // 避免技能加番后出现 16/13 这类非整数倍导致点棒小数
    const m = han >= 13 ? Math.floor(han / 13) * 4 : level / 2; // 满贯=2→1, ..., 役满=8→4
    if (kind === 'ron' && loser != null) {
      out.push({ from: loser, to: winner, amount: dealerWin ? 12000 * m : 8000 * m });
    } else if (kind === 'tsumo') {
      for (let seat = 0; seat < 4; seat++) {
        if (seat === winner) continue;
        const amount = dealerWin ? 4000 * m : seat === dealer ? 4000 * m : 2000 * m;
        out.push({ from: seat, to: winner, amount });
      }
    }
  }

  // 本场：荣和 300(子)/400(亲)×honba 由放铳者另付；自摸各家另付 100×honba
  if (honba > 0) {
    if (kind === 'ron' && loser != null) {
      out.push({ from: loser, to: winner, amount: (dealerWin ? 400 : 300) * honba });
    } else if (kind === 'tsumo') {
      for (let seat = 0; seat < 4; seat++) {
        if (seat === winner) continue;
        out.push({ from: seat, to: winner, amount: 100 * honba });
      }
    }
  }

  // 立直棒：和牌者收走全部（供托合计）
  if (opts.riichiSticks) {
    out.push({ from: -1, to: winner, amount: opts.riichiSticks * 1000 });
  }

  return out;
}
