import type { Meld, Tile } from './types';
import type { MentsuDecomp } from './agari';

// ============================================================================
// 役种判定（从 riichi-core src/yaku.ls 转写）
// 高番优先；shadows 表示高番成立时跳过其列出的低番（防重复计番）
// ============================================================================

// ---- 牌型辅助（编码 0-37） ----
const NUM = (t: Tile): number => (t % 10 === 0 ? 5 : t % 10); // 数字 1-9
const SUIT = (t: Tile): number => (t <= 9 ? 0 : t <= 19 ? 1 : t <= 29 ? 2 : 3);

function isSuupai(t: Tile): boolean {
  return t <= 29;
}
function isTsuupai(t: Tile): boolean {
  return t >= 31;
}
function isRaotoupai(t: Tile): boolean {
  return t <= 29 && (NUM(t) === 1 || NUM(t) === 9);
}
function isYaochuupai(t: Tile): boolean {
  return isRaotoupai(t) || isTsuupai(t);
}
function isChunchanpai(t: Tile): boolean {
  return t <= 29 && NUM(t) >= 2 && NUM(t) <= 8;
}

export interface YakuContext {
  /** 14 张和牌（含和牌与副露全部牌） */
  tehai: Tile[];
  /** 各花色计数 [万9, 饼9, 索9, 字7] */
  bins: number[][];
  /** 每花色总和 */
  binsSum: number[];
  /** 食断（kuitan）：副露断幺九是否有效 */
  kuitan: boolean;
  fuuro: Meld[];
  menzen: boolean;
  isTsumo: boolean;
  isRon: boolean;
  riichi: { accepted: boolean; double: boolean; ippatsu: boolean };
  rinshan: boolean;
  chankan: boolean;
  isHaitei: boolean;
  /** 亲家首巡（天和/地和） */
  virgin: boolean;
  agariPlayer: number;
  chancha: number;
  /** 场风/自风：1z-4z → 31-34 */
  bakaze: Tile;
  jikaze: Tile;
  agariPai: Tile;
  /** 标准形全部拆法（七对/国士为空） */
  decomp: { mentsu: MentsuDecomp[]; jantou: Tile }[];
  /** 七对 */
  k7: boolean;
  /** 国士 */
  kokushi: boolean;
}

export interface YakuDef {
  name: string;
  /** 门清番数（役满不用） */
  menzenHan?: number;
  /** 副露番数（役满不用） */
  kuiHan?: number;
  /** 高番成立时跳过这些低番（该拆法内） */
  shadows?: string[];
  /** 任意一个拆法/条件满足即成立 */
  predicate: (ctx: YakuContext) => boolean;
}

/** 手牌（不含副露）拆法里的暗刻数 */
function countAnko(ctx: YakuContext, decomp: { mentsu: MentsuDecomp[] }): number {
  return decomp.mentsu.filter((m) => {
    if (m.kind !== 'koutsu') return false;
    // ★ 荣和补成的那组刻子规则上算明刻（双碰荣和 → 四暗刻降为三暗刻）
    if (!ctx.isTsumo && m.anchor === ctx.agariPai) return false;
    return true;
  }).length;
}

function anyDecomp(ctx: YakuContext, f: (d: { mentsu: MentsuDecomp[]; jantou: Tile }) => boolean): boolean {
  return ctx.decomp.some(f);
}

// 顺子锚点集合（123/456/789）
const IKKITSU_ANCHORS: number[] = [1, 4, 7];

export const YAKU_LIST: YakuDef[] = [
  // == 6 番 ==
  {
    name: '清一色',
    menzenHan: 6,
    kuiHan: 5,
    shadows: ['混一色', '三色同顺', '三色同刻', '混老头', '混全带', '纯全带'],
    predicate: (ctx) => {
      const su: number[] = ctx.binsSum;
      const numSuits = (su[0] > 0 ? 1 : 0) + (su[1] > 0 ? 1 : 0) + (su[2] > 0 ? 1 : 0);
      return su[3] === 0 && numSuits === 1;
    },
  },

  // == 3 番 ==
  {
    name: '二杯口',
    menzenHan: 3,
    kuiHan: 0,
    shadows: ['一杯口', '三色同刻', '对对和'],
    predicate: (ctx) => countPeikou(ctx) === 2,
  },
  {
    name: '纯全带',
    menzenHan: 3,
    kuiHan: 2,
    shadows: ['混全带', '一气通贯', '断幺九'],
    predicate: (ctx) => allYaochuu(ctx, true),
  },
  {
    name: '混一色',
    menzenHan: 3,
    kuiHan: 2,
    shadows: ['三色同顺', '三色同刻'],
    predicate: (ctx) => {
      const su = ctx.binsSum;
      const numSuits = (su[0] > 0 ? 1 : 0) + (su[1] > 0 ? 1 : 0) + (su[2] > 0 ? 1 : 0);
      return numSuits === 1;
    },
  },

  // == 2 番 ==
  {
    name: '两立直',
    menzenHan: 2,
    kuiHan: 0,
    shadows: ['立直'],
    predicate: (ctx) => ctx.riichi.accepted && ctx.riichi.double,
  },
  {
    name: '小三元',
    menzenHan: 2,
    kuiHan: 2,
    predicate: (ctx) => {
      const [p, h, c] = [countBins(ctx, 35), countBins(ctx, 36), countBins(ctx, 37)].sort((a, b) => a - b);
      return p === 2 && h >= 3 && c >= 3;
    },
  },
  {
    name: '三杠子',
    menzenHan: 2,
    kuiHan: 2,
    predicate: (ctx) => countKantsu(ctx) === 3,
  },
  {
    name: '三色同刻',
    menzenHan: 2,
    kuiHan: 2,
    shadows: ['三色同顺', '一气通贯'],
    predicate: (ctx) => hasSanshokuKoutsu(ctx),
  },
  {
    name: '混老头',
    menzenHan: 2,
    kuiHan: 2,
    shadows: ['混全带', '断幺九'],
    predicate: (ctx) => ctx.tehai.every(isYaochuupai),
  },
  {
    name: '三暗刻',
    menzenHan: 2,
    kuiHan: 2,
    shadows: ['三色同顺', '一气通贯'],
    predicate: (ctx) => ctx.decomp.some((d) => countAnko(ctx, d) === 3),
  },
  {
    name: '对对和',
    menzenHan: 2,
    kuiHan: 2,
    shadows: ['三色同顺', '一气通贯'],
    predicate: (ctx) =>
      !ctx.k7 &&
      ctx.fuuro.every((f) => f.type !== 'chii') &&
      ctx.decomp.some((d) => d.mentsu.every((m) => m.kind === 'koutsu')),
  },
  {
    name: '七对子',
    menzenHan: 2,
    kuiHan: 0,
    predicate: (ctx) => ctx.k7,
  },
  {
    name: '混全带',
    menzenHan: 2,
    kuiHan: 1,
    shadows: ['一气通贯'],
    predicate: (ctx) => allYaochuu(ctx, false),
  },
  {
    name: '一气通贯',
    menzenHan: 2,
    kuiHan: 1,
    predicate: (ctx) => hasIkkitsuukan(ctx),
  },
  {
    name: '三色同顺',
    menzenHan: 2,
    kuiHan: 1,
    predicate: (ctx) => hasSanshokuShuntsu(ctx),
  },

  // == 1 番 ==
  {
    name: '河底捞鱼',
    menzenHan: 1,
    kuiHan: 1,
    predicate: (ctx) => ctx.isHaitei && ctx.isRon,
  },
  {
    name: '海底捞月',
    menzenHan: 1,
    kuiHan: 1,
    shadows: ['抢杠'],
    predicate: (ctx) => ctx.isHaitei && ctx.isTsumo,
  },
  {
    name: '抢杠',
    menzenHan: 1,
    kuiHan: 1,
    predicate: (ctx) => ctx.chankan && ctx.isRon,
  },
  {
    name: '岭上开花',
    menzenHan: 1,
    kuiHan: 1,
    predicate: (ctx) => ctx.rinshan && ctx.isTsumo,
  },
  { name: '役牌·白', menzenHan: 1, kuiHan: 1, predicate: (ctx) => countBins(ctx, 35) >= 3 },
  { name: '役牌·發', menzenHan: 1, kuiHan: 1, predicate: (ctx) => countBins(ctx, 36) >= 3 },
  { name: '役牌·中', menzenHan: 1, kuiHan: 1, predicate: (ctx) => countBins(ctx, 37) >= 3 },
  { name: '场风', menzenHan: 1, kuiHan: 1, predicate: (ctx) => countBins(ctx, ctx.bakaze) >= 3 },
  { name: '自风', menzenHan: 1, kuiHan: 1, predicate: (ctx) => countBins(ctx, ctx.jikaze) >= 3 },
  {
    name: '一杯口',
    menzenHan: 1,
    kuiHan: 0,
    predicate: (ctx) => countPeikou(ctx) === 1,
  },
  {
    name: '断幺九',
    menzenHan: 1,
    kuiHan: 1,
    predicate: (ctx) => (ctx.menzen || ctx.kuitan) && ctx.tehai.every(isChunchanpai),
  },
  {
    name: '门清自摸',
    menzenHan: 1,
    kuiHan: 0,
    predicate: (ctx) => ctx.menzen && ctx.isTsumo,
  },
  {
    name: '一发',
    menzenHan: 1,
    kuiHan: 0,
    predicate: (ctx) => ctx.riichi.accepted && ctx.riichi.ippatsu,
  },
  {
    name: '立直',
    menzenHan: 1,
    kuiHan: 0,
    predicate: (ctx) => ctx.riichi.accepted,
  },
];

export const YAKUMAN_LIST: YakuDef[] = [
  { name: '天和', predicate: (ctx) => ctx.isTsumo && ctx.virgin && ctx.agariPlayer === ctx.chancha },
  { name: '地和', predicate: (ctx) => ctx.isTsumo && ctx.virgin && ctx.agariPlayer !== ctx.chancha },
  {
    name: '纯正九莲宝灯',
    shadows: ['九莲宝灯'],
    predicate: (ctx) => isChuuren(ctx, true),
  },
  {
    name: '九莲宝灯',
    predicate: (ctx) => isChuuren(ctx, false),
  },
  {
    name: '四杠子',
    predicate: (ctx) => countKantsu(ctx) === 4,
  },
  { name: '清老头', predicate: (ctx) => ctx.tehai.every(isRaotoupai) },
  {
    name: '绿一色',
    predicate: (ctx) =>
      ctx.tehai.length > 0 &&
      ctx.tehai.every((t) => [23, 24, 26, 28, 22, 36].includes(t)), // 23468s + 發
  },
  {
    name: '大四喜',
    shadows: ['小四喜'],
    predicate: (ctx) => [31, 32, 33, 34].every((t) => countBins(ctx, t) >= 3),
  },
  {
    name: '小四喜',
    predicate: (ctx) => {
      const c = [31, 32, 33, 34].map((t) => countBins(ctx, t)).sort((a, b) => a - b);
      return c[0] === 2 && c[1] >= 3 && c[2] >= 3 && c[3] >= 3;
    },
  },
  { name: '字一色', predicate: (ctx) => ctx.tehai.every(isTsuupai) },
  {
    name: '大三元',
    predicate: (ctx) => [35, 36, 37].every((t) => countBins(ctx, t) >= 3),
  },
  {
    name: '四暗刻单骑',
    shadows: ['四暗刻'],
    predicate: (ctx) =>
      ctx.menzen &&
      ctx.decomp.some((d) => countAnko(ctx, d) === 4 && d.jantou === ctx.agariPai),
  },
  {
    name: '四暗刻',
    predicate: (ctx) => ctx.menzen && ctx.decomp.some((d) => countAnko(ctx, d) === 4),
  },
  // 国士无双在 agari 流程中单独判定（kokushi 标志）
];

// ---- 内部辅助 ----
function countBins(ctx: YakuContext, t: Tile): number {
  const s = SUIT(t);
  const i = t <= 9 ? (t === 0 ? 4 : t - 1) : t <= 19 ? (t === 10 ? 4 : t - 11) : t <= 29 ? (t === 20 ? 4 : t - 21) : t - 31;
  return ctx.bins[s][i] ?? 0;
}

function countKantsu(ctx: YakuContext): number {
  return ctx.fuuro.filter((f) => f.type === 'kan' || f.type === 'ankan' || f.type === 'kakan').length;
}

function countPeikou(ctx: YakuContext): number {
  if (ctx.k7) return 0;
  // 每个拆法内独立计数（yaku.ls 逻辑：一对即置反），取最大值
  let best = 0;
  for (const d of ctx.decomp) {
    const seen = new Set<number>();
    let peikou = 0;
    for (const m of d.mentsu) {
      if (m.kind !== 'shuntsu') continue;
      if (seen.has(m.anchor)) {
        peikou++;
        seen.delete(m.anchor);
      } else {
        seen.add(m.anchor);
      }
    }
    if (peikou > best) best = peikou;
  }
  return best;
}

/** 全带判定：所有面子+雀头都含幺九（或含字牌） */
function allYaochuu(ctx: YakuContext, noTsuu: boolean): boolean {
  if (ctx.k7) return false;
  const jantouOk = (j: Tile) => (noTsuu ? isRaotoupai(j) : isYaochuupai(j));
  // 顺子必须 123/789（anchor 数字 1 或 7），刻子必须 111/999（1 或 9）
  const meldOk = (kind: MentsuDecomp['kind'], anchor: Tile) => {
    const n = NUM(anchor);
    if (isTsuupai(anchor)) return !noTsuu; // 字牌刻子：混全带允许，纯全带不允许
    return kind === 'shuntsu' ? n === 1 || n === 7 : n === 1 || n === 9;
  };
  const decompOk = (d: { mentsu: MentsuDecomp[]; jantou: Tile }) => {
    if (!jantouOk(d.jantou)) return false;
    for (const m of d.mentsu) {
      if (!meldOk(m.kind, m.anchor)) return false;
    }
    return true;
  };
  const fuuroOk = ctx.fuuro.every((f) => {
    const anchor = Math.min(...f.tiles);
    return meldOk(f.type === 'chii' ? 'shuntsu' : 'koutsu', anchor);
  });
  return ctx.decomp.some(decompOk) && fuuroOk;
}

function hasIkkitsuukan(ctx: YakuContext): boolean {
  const check = (ment: { kind: MentsuDecomp['kind']; anchor: Tile }[], anchorOf: (x: { anchor: Tile }) => Tile) => {
    for (const s of [0, 1, 2]) {
      const hit = IKKITSU_ANCHORS.map((n) =>
        ment.some((m) => m.kind === 'shuntsu' && anchorOf(m) === tileOfSuite(s, n)),
      );
      if (hit.every(Boolean)) return true;
    }
    return false;
  };
  if (check(ctx.decomp.flatMap((d) => d.mentsu), (m) => m.anchor)) return true;
  // 副露中的顺子
  const fuuroShuntsu = ctx.fuuro.filter((f) => f.type === 'chii').map((f) => ({ kind: 'shuntsu' as const, anchor: Math.min(...f.tiles) }));
  return check(fuuroShuntsu, (m) => m.anchor);
}

function hasSanshokuShuntsu(ctx: YakuContext): boolean {
  const anchors = new Set<number>();
  for (const d of ctx.decomp) {
    for (const m of d.mentsu) if (m.kind === 'shuntsu') anchors.add(m.anchor);
  }
  for (const f of ctx.fuuro) if (f.type === 'chii') anchors.add(Math.min(...f.tiles));
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    if (anchors.has(tileOfSuite(0, n)) && anchors.has(tileOfSuite(1, n)) && anchors.has(tileOfSuite(2, n))) return true;
  }
  return false;
}

function hasSanshokuKoutsu(ctx: YakuContext): boolean {
  const anchors = new Set<number>();
  for (const d of ctx.decomp) {
    for (const m of d.mentsu) if (m.kind === 'koutsu' && isSuupai(m.anchor)) anchors.add(m.anchor);
  }
  for (const f of ctx.fuuro) if (f.type !== 'chii') anchors.add(Math.min(...f.tiles));
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    if (anchors.has(tileOfSuite(0, n)) && anchors.has(tileOfSuite(1, n)) && anchors.has(tileOfSuite(2, n))) return true;
  }
  return false;
}

/** 九莲宝灯：1112345678999 + 1 任意同色牌（和牌若是 1/9 则纯正） */
function isChuuren(ctx: YakuContext, pure: boolean): boolean {
  if (!ctx.menzen) return false;
  const s = SUIT(ctx.agariPai);
  if (!isSuupai(ctx.agariPai)) return false;
  const bins = ctx.bins[s];
  const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let i = 0; i < 9; i++) {
    if (bins[i] < base[i]) return false;
    bins[i] -= base[i];
  }
  let extra = -1;
  for (let i = 0; i < 9; i++) {
    if (bins[i] === 1) {
      if (extra >= 0) return false;
      extra = i;
    } else if (bins[i] !== 0) return false;
  }
  if (extra < 0) return false;
  const is1or9 = extra === 0 || extra === 8;
  return pure ? is1or9 : true;
}

function tileOfSuite(s: number, n: number): Tile {
  return s === 0 ? n : s === 1 ? 10 + n : 20 + n;
}
