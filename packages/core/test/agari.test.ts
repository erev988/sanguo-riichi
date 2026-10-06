import { describe, expect, it } from 'vitest';
import { enumerateDecomps, tileName, type Tile } from '../src/index';

function fmt(decomps: ReturnType<typeof enumerateDecomps>): string[] {
  return decomps.map((d) => {
    const m = d.mentsu
      .map((x) => `${x.kind === 'shuntsu' ? '顺' : '刻'}${tileName(x.anchor)}`)
      .join(' ');
    return `雀${tileName(d.jantou)} ${m}`;
  });
}

describe('和牌拆解（自研 decompAgari 替代）', () => {
  it('平和形唯一拆：123m456p789s中中中白白', () => {
    const tiles: Tile[] = [1, 2, 3, 14, 15, 16, 24, 25, 26, 36, 36, 36, 35, 35];
    const d = enumerateDecomps(tiles);
    expect(d.length).toBe(1);
    expect(d[0].jantou).toBe(35); // 白
    expect(d[0].mentsu.map((m) => m.kind)).toEqual(['shuntsu', 'shuntsu', 'shuntsu', 'koutsu']);
  });

  it('多拆：222333444m 555p 東東 → 4刻 或 3顺+1刻 两种拆法', () => {
    const tiles: Tile[] = [2, 2, 2, 3, 3, 3, 4, 4, 4, 15, 15, 15, 31, 31];
    const d = enumerateDecomps(tiles);
    const kinds = d.map((x) => x.mentsu.map((m) => m.kind).join(','));
    expect(kinds).toContain('koutsu,koutsu,koutsu,koutsu'); // 222 333 444 555p
    expect(kinds).toContain('shuntsu,shuntsu,shuntsu,koutsu'); // 234×3 + 555p
  });

  it('国士 14 张非标准形 → 无拆解', () => {
    const tiles: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37, 1];
    expect(enumerateDecomps(tiles)).toEqual([]);
  });

  it('七对 14 张也常是标准形（复合听牌）：11223344556677m', () => {
    const tiles: Tile[] = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
    expect(enumerateDecomps(tiles).length).toBeGreaterThan(0);
  });
});
