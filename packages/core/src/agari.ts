import { YAKU_LIST, YAKUMAN_LIST, type YakuContext } from './yaku';
import { countAka, countDora, type Meld, type Tile } from './types';

// ============================================================================
// 和牌判定（agari.ls 的转写 + 自研拆解）
// 输入：13 张手牌 + 和牌 + 副露 + 上下文 → 役/番/符 结果（无役返回 null）
// ============================================================================

export interface AgariContext {
  juntehai: Tile[];
  agariPai: Tile;
  fuuro: Meld[];
  menzen: boolean;
  isTsumo: boolean;
  riichi: { accepted: boolean; double: boolean; ippatsu: boolean };
  rinshan: boolean;
  chankan: boolean;
  isHaitei: boolean;
  virgin: boolean;
  agariPlayer: number;
  chancha: number;
  bakaze: Tile;
  jikaze: Tile;
  kuitan: boolean;
  /** 双重役满开关（默认 2） */
  yakumanMax?: number;
  /** 已翻开的宝牌指示牌（公开信息） */
  doraIndicators?: Tile[];
  /** 里宝牌指示牌（仅立直和牌时计入） */
  uraIndicators?: Tile[];
  /** 允许无役和牌（技能 forceWin）：无役时也返回结果（保留宝牌番数） */
  allowNoYaku?: boolean;
}

export interface AgariYaku {
  name: string;
  han: number;
}

export interface AgariResult {
  yaku: AgariYaku[];
  hanTotal: number;
  fu: number;
  yakuman: AgariYaku[];
  yakumanTotal: number;
  agariPai: Tile;
  /** 使用的标准形拆解（七对/国士为 null） */
  winDecomp: WinDecomp | null;
}

type Counts = [number[], number[], number[], number[]];

const SUIT = (t: Tile): number => (t <= 9 ? 0 : t <= 19 ? 1 : t <= 29 ? 2 : 3);
const NUM = (t: Tile): number => (t % 10 === 0 ? 5 : t % 10);
function isTsuupai(t: Tile): boolean {
  return t >= 31;
}
function isYaochuupai(t: Tile): boolean {
  return t <= 29 && (NUM(t) === 1 || NUM(t) === 9) || isTsuupai(t);
}

function countsOf(tiles: Tile[]): Counts {
  const c: Counts = [
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(9).fill(0),
    new Array<number>(7).fill(0),
  ];
  for (const t of tiles) {
    if (t <= 9) c[0][t === 0 ? 4 : t - 1]++;
    else if (t <= 19) c[1][t === 10 ? 4 : t - 11]++;
    else if (t <= 29) c[2][t === 20 ? 4 : t - 21]++;
    else if (t >= 31) c[3][t - 31]++;
  }
  return c;
}

/** 七对判定 */
function isChiitoi(c14: Counts): boolean {
  let pairs = 0;
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c14[s][i] !== 0 && c14[s][i] !== 2) return false;
      if (c14[s][i] === 2) pairs++;
    }
  }
  return pairs === 7;
}

/** 国士：13 种幺九齐全 + 恰好 1 对 */
function isKokushi(c14: Counts, all: Tile[]): boolean {
  const yaochuu: Tile[] = [1, 9, 11, 19, 21, 29, 31, 32, 33, 34, 35, 36, 37];
  let kinds = 0;
  let pairs = 0;
  for (const y of yaochuu) {
    const s = SUIT(y);
    const i = y <= 9 ? y - 1 : y <= 19 ? y - 11 : y <= 29 ? y - 21 : y - 31;
    const n = c14[s][i] ?? 0;
    if (n === 0) continue;
    if (n === 2) pairs++;
    else if (n !== 1) return false;
    kinds++;
  }
  return kinds === 13 && pairs === 1;
}

/** 役牌（三元/场风/自风；连风算役牌） */
function isYakuhai(t: Tile, bakaze: Tile, jikaze: Tile): boolean {
  return t >= 35 || t === bakaze || t === jikaze;
}

/** 和牌时听牌形与符：单骑2 / 边张2 / 嵌张2 / 两面0 / 双碰0 */
function calcWaitFu(decomps: WinDecomp[], agariPai: Tile): { fu: number; isRyanmen: boolean } {
  for (const d of decomps) {
    if (d.jantou === agariPai) return { fu: 2, isRyanmen: false }; // 单骑
    for (const m of d.mentsu) {
      if (m.kind === 'koutsu' && m.anchor === agariPai) {
        return { fu: 0, isRyanmen: false }; // 双碰（和牌补成刻子）
      }
      if (m.kind === 'shuntsu') {
        const [a, b, c] = [m.anchor, m.anchor + 1, m.anchor + 2]; // 编码连续
        if (b === agariPai) return { fu: 2, isRyanmen: false }; // 嵌张
        if (a === agariPai && NUM(a) === 1) return { fu: 2, isRyanmen: false }; // 边张123
        if (c === agariPai && NUM(c) === 9) return { fu: 2, isRyanmen: false }; // 边张789
        if (a === agariPai || c === agariPai) return { fu: 0, isRyanmen: true }; // 两面
      }
    }
  }
  return { fu: 0, isRyanmen: false };
}

/** 平和：4 顺子 + 役牌外雀头 + 两面听（自摸也要求两面） */
function isPinfu(ctx: AgariContext, decomps: WinDecomp[]): boolean {
  return decomps.some((d) => {
    if (d.mentsu.some((m) => m.kind !== 'shuntsu')) return false;
    if (isYakuhai(d.jantou, ctx.bakaze, ctx.jikaze)) return false;
    return calcWaitFu([d], ctx.agariPai).isRyanmen;
  });
}

/** 追加宝牌 / 里宝牌 / 赤宝牌番数（宝牌不构成役，因此只在已有役时追加） */
function addDora(ctx: AgariContext, tehai: Tile[], yaku: AgariYaku[]): void {
  const dora = countDora(tehai, ctx.doraIndicators ?? []);
  if (dora > 0) yaku.push({ name: '宝牌', han: dora });
  if (ctx.riichi.accepted && ctx.uraIndicators) {
    const ura = countDora(tehai, ctx.uraIndicators);
    if (ura > 0) yaku.push({ name: '里宝牌', han: ura });
  }
  const aka = countAka(tehai);
  if (aka > 0) yaku.push({ name: '赤宝牌', han: aka });
}

/** 和牌判定主入口 */
export function evaluateAgari(ctx: AgariContext): AgariResult | null {
  const all: Tile[] = [...ctx.juntehai, ctx.agariPai];
  for (const f of ctx.fuuro) all.push(...f.tiles);
  const c14 = countsOf(all);

  // 七对（2 番，固定 25 符，不参与标准拆解）
  if (isChiitoi(c14)) {
    const yakuCtx = makeYakuContext(ctx, all, c14, [], true, false);
    const yaku = collectYaku(yakuCtx);
    addDora(ctx, all, yaku);
    return {
      yaku,
      hanTotal: yaku.reduce((a, x) => a + x.han, 0),
      fu: 25,
      yakuman: [],
      yakumanTotal: 0,
      agariPai: ctx.agariPai,
      winDecomp: null,
    };
  }

  // 国士（役满；13 面听双倍）
  if (isKokushi(c14, all)) {
    // ★ 13 面听 = 手牌 13 张且 13 种幺九各 1 张（无对子）——此前用 isKokushi 判定恒 false
    const thirteenWait =
      ctx.juntehai.length === 13 &&
      new Set(ctx.juntehai).size === 13 &&
      ctx.juntehai.every(isYaochuupai);
    return {
      yaku: [],
      hanTotal: 0,
      fu: 0,
      yakuman: [{ name: '国士无双', han: thirteenWait ? 2 : 1 }],
      yakumanTotal: thirteenWait ? 2 : 1,
      agariPai: ctx.agariPai,
      winDecomp: null,
    };
  }

  // 标准形：副露面子已固定，手牌只需再凑 (4 - 副露数) 个面子 + 1 雀头
  const needMentsu = Math.max(0, 4 - ctx.fuuro.length);
  const decomps = enumerateDecomps([...ctx.juntehai, ctx.agariPai], needMentsu);
  if (decomps.length === 0) return null;
  const pinfu = isPinfu(ctx, decomps);
  const yakuCtx = makeYakuContext(ctx, all, c14, decomps, false, false);
  const yaku = collectYaku(yakuCtx);
  const yakuman = YAKUMAN_LIST.filter((y) => y.predicate(yakuCtx)).map((y) => ({ name: y.name, han: 1 }));
  if (yakuman.length > 0) {
    const total = Math.min(yakuman.reduce((a, x) => a + x.han, 0), ctx.yakumanMax ?? 2);
    return { yaku: [], hanTotal: 0, fu: 0, yakuman, yakumanTotal: total, agariPai: ctx.agariPai, winDecomp: null };
  }
  // 平和不在 YAKU_LIST（由符数阶段处理），单独并入
  if (pinfu) yaku.unshift({ name: '平和', han: 1 });
  // 无役不可和 —— 除非技能放行（forceWin：允许无役和牌，宝牌番数照算）
  if (yaku.length === 0 && !ctx.allowNoYaku) return null;
  addDora(ctx, all, yaku); // 宝牌番数照加（宝牌不构成役，但计入番数）

  // 符数（平和：门清荣和 30 符 / 自摸 20 符）
  const fu = pinfu ? (ctx.menzen && !ctx.isTsumo ? 30 : 20) : calcFu(ctx, decomps);
  return {
    yaku,
    hanTotal: yaku.reduce((a, x) => a + x.han, 0),
    fu,
    yakuman: [],
    yakumanTotal: 0,
    agariPai: ctx.agariPai,
    winDecomp: decomps[0] ?? null,
  };
}

// ---- 内部 ----

function makeYakuContext(
  ctx: AgariContext,
  tehai: Tile[],
  c14: Counts,
  decomps: WinDecomp[],
  k7: boolean,
  kokushi: boolean,
): YakuContext {
  return {
    tehai,
    bins: c14,
    binsSum: c14.map((b) => b.reduce((a, x) => a + x, 0)),
    fuuro: ctx.fuuro,
    menzen: ctx.menzen,
    isTsumo: ctx.isTsumo,
    isRon: !ctx.isTsumo,
    riichi: ctx.riichi,
    rinshan: ctx.rinshan,
    chankan: ctx.chankan,
    isHaitei: ctx.isHaitei,
    virgin: ctx.virgin,
    agariPlayer: ctx.agariPlayer,
    chancha: ctx.chancha,
    bakaze: ctx.bakaze,
    jikaze: ctx.jikaze,
    agariPai: ctx.agariPai,
    decomp: decomps,
    k7,
    kokushi,
    kuitan: ctx.kuitan,
  };
}

function collectYaku(ctx: YakuContext): AgariYaku[] {
  const hit = YAKU_LIST.filter((y) => y.predicate(ctx));
  const excluded = new Set(hit.flatMap((y) => y.shadows ?? []));
  const kept = hit.filter((y) => !excluded.has(y.name));
  return kept.map((y) => ({ name: y.name, han: ctx.menzen ? y.menzenHan! : y.kuiHan! }));
}

function calcFu(ctx: AgariContext, decomps: WinDecomp[]): number {
  let fu = 20; // 副底
  // 面子符：手牌里的刻子原则上都是暗刻（幺九 8 / 中张 4），
  // 例外：荣和补成的那组刻子按明刻（幺九 4 / 中张 2）——见「双碰荣和」
  for (const d of decomps[0].mentsu) {
    const yaochuu = isYaochuupai(d.anchor);
    if (d.kind === 'koutsu') {
      const ronCompleted = !ctx.isTsumo && d.anchor === ctx.agariPai;
      if (ronCompleted) fu += yaochuu ? 4 : 2;
      else fu += yaochuu ? 8 : 4;
    }
  }
  for (const f of ctx.fuuro) {
    const anchor = Math.min(...f.tiles);
    const yaochuu = isYaochuupai(anchor);
    switch (f.type) {
      case 'chii': break;
      case 'pon': fu += yaochuu ? 4 : 2; break;
      case 'kan':
      case 'kakan': fu += yaochuu ? 16 : 8; break;
      case 'ankan': fu += yaochuu ? 32 : 16; break; // 暗杠（幺九 32 / 中张 16）
    }
  }
  // 雀头符
  if (isYakuhai(decomps[0].jantou, ctx.bakaze, ctx.jikaze)) {
    fu += decomps[0].jantou === ctx.bakaze && decomps[0].jantou === ctx.jikaze ? 4 : 2;
  }
  // 听牌形符
  fu += calcWaitFu(decomps, ctx.agariPai).fu;
  // 门清荣和 +10；门清自摸 +2（自摸符：子家自摸加 2）
  if (ctx.menzen) fu += ctx.isTsumo ? 2 : 10;
  // 进位到 10（最小 30 符：20 副底+2 自摸=22 → 30）
  return Math.ceil(fu / 10) * 10;
}

export type MentsuKind = 'shuntsu' | 'koutsu';

export interface MentsuDecomp {
  kind: MentsuKind;
  /** 顺子最小牌 / 刻子牌（标准编码） */
  anchor: Tile;
}

export interface WinDecomp {
  jantou: Tile;
  mentsu: MentsuDecomp[];
}

/** 花色内 i（0-based 数字）→ 标准牌编码 */
function tileOfSuite(s: number, i: number): Tile {
  return s === 0 ? i + 1 : s === 1 ? 11 + i : s === 2 ? 21 + i : 31 + i;
}

/** 标准形：14 张 → 全部拆法（不含七对/国士） */
export function enumerateDecomps(tiles14: Tile[], needMentsu = 4): WinDecomp[] {
  const c = countsOf(tiles14);
  const out: WinDecomp[] = [];

  // 雀头
  for (let s = 0; s < 4; s++) {
    const len = s === 3 ? 7 : 9;
    for (let i = 0; i < len; i++) {
      if (c[s][i] >= 2) {
        c[s][i] -= 2;
        collectMentsu(c, tileOfSuite(s, i), [], out, needMentsu);
        c[s][i] += 2;
      }
    }
  }
  return out;
}

function collectMentsu(
  c: Counts,
  jantou: Tile,
  acc: MentsuDecomp[],
  out: WinDecomp[],
  need = 4,
): void {
  if (acc.length === need) {
    // 校验全部清零
    for (let s = 0; s < 4; s++) {
      const len = s === 3 ? 7 : 9;
      for (let i = 0; i < len; i++) if (c[s][i] !== 0) return;
    }
    out.push({ jantou, mentsu: [...acc] });
    return;
  }
  // 最左非零牌
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 9; i++) {
      if (c[s][i] > 0) {
        if (c[s][i] >= 3) {
          c[s][i] -= 3;
          acc.push({ kind: 'koutsu', anchor: tileOfSuite(s, i) });
          collectMentsu(c, jantou, acc, out, need);
          acc.pop();
          c[s][i] += 3;
        }
        if (i <= 6 && c[s][i + 1] > 0 && c[s][i + 2] > 0) {
          c[s][i]--;
          c[s][i + 1]--;
          c[s][i + 2]--;
          acc.push({ kind: 'shuntsu', anchor: tileOfSuite(s, i) });
          collectMentsu(c, jantou, acc, out, need);
          acc.pop();
          c[s][i]++;
          c[s][i + 1]++;
          c[s][i + 2]++;
        }
        return; // 最左非零牌必须被消耗
      }
    }
  }
  for (let i = 0; i < 7; i++) {
    if (c[3][i] > 0) {
      if (c[3][i] >= 3) {
        c[3][i] -= 3;
        acc.push({ kind: 'koutsu', anchor: tileOfSuite(3, i) });
        collectMentsu(c, jantou, acc, out, need);
        acc.pop();
        c[3][i] += 3;
      }
      return; // 字牌只能刻子
    }
  }
}
