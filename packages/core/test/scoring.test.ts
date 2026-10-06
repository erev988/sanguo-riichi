import { describe, expect, it } from 'vitest';
import { computePayments, type WinInfo } from '../src/index';

function ron(han: number, fu: number, winner = 1, loser = 0, opts = {}): number {
  const win: WinInfo = { kind: 'ron', yaku: [], han, fu };
  const p = computePayments(win, winner, 0, loser, opts);
  return p.find((x) => x.from === loser && x.to === winner)?.amount ?? 0;
}

function tsumoTotal(han: number, fu: number, winner = 1, opts = {}): number {
  const win: WinInfo = { kind: 'tsumo', yaku: [], han, fu };
  const p = computePayments(win, winner, 0, undefined, opts);
  return p.filter((x) => x.to === winner).reduce((a, x) => a + x.amount, 0);
}

describe('点数计算（符×番表）', () => {
  it('子 30符1番 荣和 = 1000', () => expect(ron(1, 30)).toBe(1000));
  it('子 30符2番 荣和 = 2000', () => expect(ron(2, 30)).toBe(2000));
  it('子 30符3番 荣和 = 3900', () => expect(ron(3, 30)).toBe(3900));
  it('子 40符2番 荣和 = 2600', () => expect(ron(2, 40)).toBe(2600));
  it('亲 30符1番 荣和 = 1500', () => expect(ron(1, 30, 0, 1)).toBe(1500));
  it('子 30符4番 自摸 = 2000/3900（合计 7900）', () => {
    const win: WinInfo = { kind: 'tsumo', yaku: [], han: 4, fu: 30 };
    const p = computePayments(win, 1, 0);
    expect(p.find((x) => x.from === 3 && x.to === 1)?.amount).toBe(2000);
    expect(p.find((x) => x.from === 0 && x.to === 1)?.amount).toBe(3900);
    expect(tsumoTotal(4, 30)).toBe(7900);
  });

  it('满贯：子 5番 = 8000', () => expect(ron(5, 30)).toBe(8000));
  it('跳满：子 6番 = 12000', () => expect(ron(6, 30)).toBe(12000));
  it('倍满：子 8番 = 16000', () => expect(ron(8, 30)).toBe(16000));
  it('役满：子 13番 = 32000', () => expect(ron(13, 30)).toBe(32000));
  it('双倍役满：子 26番 = 64000', () => expect(ron(26, 30)).toBe(64000));
  it('役满：亲 13番 = 48000', () => expect(ron(13, 30, 0, 1)).toBe(48000));

  it('双倍役满：子 26番 = 64000', () => expect(ron(26, 30)).toBe(64000));

  it('役满 + 技能加番（16 番）仍按单倍役满，且为整数', () => {
    expect(ron(16, 30)).toBe(32000); // floor(16/13)=1 → 单倍役满
    expect(Number.isInteger(ron(16, 30))).toBe(true);
  });

  it('双倍役满 + 技能加番（30 番）→ 64000（整数）', () => {
    expect(ron(30, 30)).toBe(64000); // floor(30/13)=2
  });

  it('本场：子 30符1番 荣和 honba=1 → 1000 + 300', () => {
    const win: WinInfo = { kind: 'ron', yaku: [], han: 1, fu: 30 };
    const p = computePayments(win, 1, 0, 0, { honba: 1 });
    const total = p.filter((x) => x.to === 1).reduce((a, x) => a + x.amount, 0);
    expect(total).toBe(1000 + 300);
  });

  it('立直棒：2 根 → 和牌者 +2000', () => {
    const win: WinInfo = { kind: 'ron', yaku: [], han: 1, fu: 30 };
    const p = computePayments(win, 1, 0, 0, { riichiSticks: 2 });
    expect(p.find((x) => x.to === 1 && x.from === -1)?.amount).toBe(2000);
  });
});
