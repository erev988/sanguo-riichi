<script setup lang="ts">
import {
  ALL_GENERALS,
  calcTenpai,
  sha256Hex,
  tileName,
  type Action,
  type GameEffect,
  type Meld,
  type Tile,
} from '@sanguo/core';
import type { ServerMsg } from '@sanguo/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import TileSprite from './components/TileSprite.vue';
import { Net } from './net';
import { Sfx } from './sfx';

const net = new Net();
const sfx = new Sfx();

const connected = ref(false);
const status = ref('未连接');
const name = ref('玩家');
/** 创建房间用 */
const newRoomId = ref(`room-${Math.floor(1000 + Math.random() * 9000)}`);
const newPassword = ref('');
/** 加入房间用 */
const joinRoomId = ref('');
const joinPassword = ref('');
const generalId = ref('gen-guanyu');
/** 已成功入座的房间（断线后自动复座；仅入座成功才记录） */
let joinedRoom = '';
const kiriageMangan = ref(false);
const soundOn = ref(true);
const token = ref(
  localStorage.getItem('sanguo-token') ??
    (() => {
      const t = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('sanguo-token', t);
      return t;
    })(),
);
const rooms = ref<{ id: string; humans: number; ais: number; started: boolean }[]>([]);

const mySeat = ref<number | null>(null);
const roomMembers = ref<{ seat: number; name: string; isAI: boolean; generalId: string }[]>([]);
const hostSeat = ref(-1);
const roomStarted = ref(false);
const isHost = computed(() => mySeat.value != null && mySeat.value === hostSeat.value);

// ---- live 对局状态 ----
const scores = ref<number[]>([]);
const hand = ref<Tile[]>([]);
const handCounts = ref<number[]>([13, 13, 13, 13]);
const discards = ref<Tile[][]>([[], [], [], []]);
const melds = ref<Meld[][]>([[], [], [], []]);
const riichiFlags = ref<boolean[]>([false, false, false, false]);
const riichiDiscardIdx = ref<Record<number, number>>({});
const currentSeat = ref(-1);
const roundText = ref('');
const honbaText = ref('');
/** 本场数（场供 = 本场 × 300） */
const honba = ref(0);
const riichiSticks = ref(0);
const logs = ref<string[]>([]);
const ended = ref(false);
const reason = ref('');
const pendingDiscard = ref<{ player: number; tile: Tile; chankan: boolean } | null>(null);
const lastDrawn = ref<Tile | null>(null);
/** 自己当前可执行的动作（服务器下发） */
const myOptions = ref<Action[]>([]);
/** 宝牌指示牌（已翻开） */
const doraIndicators = ref<Tile[]>([]);
/** 牌山剩余张数 */
const wallCount = ref(0);
/** 本局庄家座位 */
const dealer = ref(0);
/** 思考时限（本地倒计时） */
const timerEnd = ref(0);
const timerTotal = ref(35000);
const nowTick = ref(Date.now());
/** 精简模式（默认开）：收起对手牌背与日志，只留牌桌关键信息 */
const compact = ref(localStorage.getItem('sanguo-compact') !== '0');
/** 日志展开（精简模式下默认收起，只留最新一条） */
const logOpen = ref(false);
watch(compact, (v) => localStorage.setItem('sanguo-compact', v ? '1' : '0'));
const vw = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);

/** 剩余秒数（无计时为 null） */
const remainSec = computed(() => {
  if (timerEnd.value <= 0) return null;
  const ms = timerEnd.value - nowTick.value;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 1000);
});
/** 是否进入补时（最后 10 秒） */
const inExtraTime = computed(() => {
  if (remainSec.value == null) return false;
  return Math.max(0, timerEnd.value - nowTick.value) <= 10000;
});

// ---- 结算面板 ----
interface ResultInfo {
  type: 'agaru' | 'ryukyoku';
  title: string;
  detail: string;
  yaku: string[];
  payments: { from: number; to: number; amount: number }[];
  delta: number[];
  skills: string[];
  /** 和牌时各技能的数值影响 */
  skillDetails: { skill: string; han: number; fu: number }[];
  /** 和牌者牌型（和牌即公开） */
  hand?: Tile[];
  melds?: Meld[];
  winTile?: Tile;
  tenpai?: boolean[];
  yakuman: boolean;
}
const result = ref<ResultInfo | null>(null);
const animDelta = ref<number[]>([0, 0, 0, 0]);
let skillBuffer: string[] = [];

// ---- 回放 ----
interface Frame {
  roundText: string;
  honbaText: string;
  scores: number[];
  hands: Tile[][];
  handCounts: number[];
  discards: Tile[][];
  melds: Meld[][];
  riichi: boolean[];
  riichiDiscardIdx: Record<number, number>;
  current: number;
  riichiSticks: number;
  logs: string[];
  lastDrawn: Tile | null;
}

/** 我的实际武将（以房间成员为准，入座后可在选将区切换） */
const myGeneralId = computed(
  () => roomMembers.value.find((m) => m.seat === mySeat.value)?.generalId ?? generalId.value,
);
const currentGeneral = computed(() => ALL_GENERALS.find((g) => g.id === myGeneralId.value));

/** 查看某座位武将详情（点击座位名触发） */
const inspectSeat = ref<number | null>(null);
function generalOf(seat: number) {
  const gid = roomMembers.value.find((m) => m.seat === seat)?.generalId;
  return ALL_GENERALS.find((g) => g.id === gid);
}
/** 未开局时切换自己的武将 */
function pickGeneral(id: string): void {
  net.send({ t: 'pickGeneral', generalId: id });
}
const seats = computed(() => {
  const s = mySeat.value ?? 0;
  return { self: s, right: (s + 1) % 4, top: (s + 2) % 4, left: (s + 3) % 4 };
});

/** live 数据 → 与回放帧同构 */
const liveFrame = computed<Frame>(() => ({
  roundText: roundText.value,
  honbaText: honbaText.value,
  scores: scores.value,
  hands: [0, 1, 2, 3].map((s) => (s === mySeat.value ? hand.value : [])),
  handCounts: handCounts.value,
  discards: discards.value,
  melds: melds.value,
  riichi: riichiFlags.value,
  riichiDiscardIdx: riichiDiscardIdx.value,
  current: currentSeat.value,
  riichiSticks: riichiSticks.value,
  logs: logs.value,
  lastDrawn: lastDrawn.value,
}));

const shown = computed<Frame>(() => liveFrame.value);

/** 牌序：万→饼→索→字（赤 5 归入 5 的位置） */
const normTile = (t: Tile): number => (t === 0 ? 5 : t === 10 ? 15 : t === 20 ? 25 : t);
function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => normTile(a) - normTile(b));
}

/** 和牌张在排序后手牌中的标记位置（-1 表示无） */
const winTileMark = computed(() => {
  const r = result.value;
  if (!r?.hand || r.winTile == null) return -1;
  return sortTiles(r.hand).indexOf(r.winTile);
});

/** 手牌主体（不含刚摸的牌），并按牌面排序（万→饼→索→字；赤 5 归入 5 的位置） */
const handCore = computed(() => {
  const h = shown.value.hands[mySeat.value ?? 0] ?? [];
  const body = shown.value.lastDrawn != null ? h.slice(0, -1) : h;
  const norm = (t: Tile): number => (t === 0 ? 5 : t === 10 ? 15 : t === 20 ? 25 : t);
  return [...body].sort((a, b) => norm(a) - norm(b));
});

/** 顶部提示条（技能触发等），5 秒后自动消失 */
interface Toast {
  id: number;
  text: string;
}
const toasts = ref<Toast[]>([]);
let toastSeq = 0;
function pushToast(text: string, ms = 5000): void {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, text }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}

/** 手牌牌高：**固定按 14 张计算**（不随实际张数变化），并为副露/倒计时预留宽度 */
const handTileSize = computed(() => {
  const byWidth = Math.floor((vw.value - 240) / 14); // 预留约 240px 给副露与倒计时
  const byHeight = Math.floor(vh.value * 0.125);
  return Math.max(22, Math.min(48, byWidth, byHeight));
});

/** 风位：庄家为东，逆时针（座位号 +1）依次 南西北 */
function windOf(seat: number): string {
  return ['东', '南', '西', '北'][(((seat - dealer.value) % 4) + 4) % 4];
}

/** 该座位是否庄家 */
const isDealer = (seat: number): boolean => seat === dealer.value;

function memberName(seat: number, face = 'P'): string {
  const m = roomMembers.value.find((x) => x.seat === seat);
  if (m) return m.name;
  // 回放时房间成员可能已变，退化用座位号
  return `${face}${seat + 1}`;
}

/** 该座位的武将名（武将公开） */
function generalNameOf(seat: number): string {
  const m = roomMembers.value.find((x) => x.seat === seat);
  if (!m) return '';
  return ALL_GENERALS.find((g) => g.id === m.generalId)?.name ?? '';
}

/** 该座位武将的技能名 */
function skillNameOf(seat: number): string {
  const m = roomMembers.value.find((x) => x.seat === seat);
  if (!m) return '';
  return ALL_GENERALS.find((g) => g.id === m.generalId)?.skills[0]?.name ?? '';
}

function pushLog(msg: string): void {
  logs.value.unshift(msg);
  if (logs.value.length > 200) logs.value.pop();
}

const FACTION: Record<string, string> = { wei: '魏', shu: '蜀', wu: '吴', qun: '群' };
function factionName(f?: string): string {
  return f ? (FACTION[f] ?? f) : '';
}

const WIND: Record<string, string> = { east: '东', south: '南', west: '西', north: '北' };
const roundLabel = (round: { wind: string; round: number; honba: number }): [string, string] => [
  `${WIND[round.wind] ?? round.wind}${round.round}局`,
  round.honba > 0 ? `${round.honba} 本场` : '',
];

function deltaOf(payments: { from: number; to: number; amount: number }[]): number[] {
  const d = [0, 0, 0, 0];
  for (const p of payments) {
    if (p.from >= 0) d[p.from] -= p.amount;
    if (p.to >= 0) d[p.to] += p.amount;
  }
  return d;
}

function isCalled(m: Meld, idx: number): boolean {
  if (m.calledTile == null) return false;
  return idx === m.tiles.indexOf(m.calledTile);
}

/** 效果 → 一行文字（live 与回放共用） */
function describe(e: GameEffect, nameOf: (s: number) => string): string | null {
  switch (e.type) {
    case 'gameStarted':
      return `—— ${WIND[e.round.wind] ?? ''}${e.round.round}局 开始 ——`;
    case 'discarded':
      return `${nameOf(e.player)} 打 ${tileName(e.tile)}${e.riichi ? '（立直）' : ''}`;
    case 'drawn':
      return `${nameOf(e.player)} 摸牌`;
    case 'called': {
      const kind = e.meld.type === 'chii' ? '吃' : e.meld.type === 'pon' ? '碰' : '杠';
      return `${nameOf(e.player)} ${kind} ${e.meld.tiles.map(tileName).join(' ')}`;
    }
    case 'chankan-window':
      return `${nameOf(e.player)} ${e.kind === 'kakan' ? '加杠' : '暗杠'} ${tileName(e.tile)}`;
    case 'skill-pay':
      return e.payments
        .filter((p) => p.from >= 0 && p.to >= 0)
        .map((p) => `【${e.skill}】${nameOf(p.from)} → ${nameOf(p.to)} ${p.amount}`)
        .join('　');
    case 'agaru':
      return `🎉 ${nameOf(e.winner)} ${e.kind === 'tsumo' ? '自摸' : '荣和'}：${e.han}番 ${e.fu}符 [${e.yaku.join('、')}]`;
    case 'ryukyoku':
      return `流局：${e.tenpai.map((t, i) => `${nameOf(i)}${t ? '听' : '不听'}`).join(' ')}`;
    case 'gameEnded':
      return `🏁 本局结束：${e.scores.join(' / ')}`;
    default:
      return null;
  }
}

/** 结算面板：增量数字滚动 */
function animateDelta(target: number[]): void {
  const t0 = performance.now();
  const dur = 620;
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    animDelta.value = target.map((v) => Math.round(v * e));
    if (t < 1) requestAnimationFrame(tick);
  };
  animDelta.value = [0, 0, 0, 0];
  requestAnimationFrame(tick);
}

function handleEffect(e: GameEffect): void {
  const nm = (s: number): string => memberName(s);
  const line = describe(e, nm);
  if (line) pushLog(line);

  switch (e.type) {
    case 'gameStarted': {
      const [rt, ht] = roundLabel(e.round);
      roundText.value = rt;
      honbaText.value = ht;
      dealer.value = e.dealer;
      scores.value = e.seats.map((s) => s.score);
      discards.value = [[], [], [], []];
      melds.value = [[], [], []].concat([[]]) as Meld[][];
      riichiFlags.value = [false, false, false, false];
      riichiDiscardIdx.value = {};
      handCounts.value = [13, 13, 13, 13];
      lastDrawn.value = null;
      ended.value = false;
      timerEnd.value = 0;
      myOptions.value = [];
      skillBuffer = [];
      break;
    }
    case 'hand':
      if (e.player === mySeat.value) hand.value = e.tiles;
      break;
    case 'options':
      if (e.targetSeat === mySeat.value) myOptions.value = e.actions;
      break;
    case 'dora':
      doraIndicators.value = e.indicators;
      break;
    case 'wall':
      wallCount.value = e.count;
      break;
    case 'timer':
      if (e.targetSeat === mySeat.value) {
        timerTotal.value = e.total;
        timerEnd.value = Date.now() + e.ms;
      }
      break;
    case 'drawn':
      if (e.player === mySeat.value) lastDrawn.value = e.tile;
      break;
    case 'discarded': {
      const d = [...(discards.value[e.player] ?? []), e.tile];
      discards.value[e.player] = d;
      handCounts.value[e.player] = e.handCount;
      if (e.riichi) {
        riichiFlags.value[e.player] = true;
        riichiDiscardIdx.value[e.player] = d.length - 1;
        riichiSticks.value += 1;
        sfx.riichi();
      } else {
        sfx.discard();
      }
      if (e.player === mySeat.value) lastDrawn.value = null;
      myOptions.value = []; // 等待服务器下发新的可选动作
      if (e.player !== mySeat.value) {
        pendingDiscard.value = { player: e.player, tile: e.tile, chankan: false };
      }
      break;
    }
    case 'called': {
      melds.value[e.player] = [...(melds.value[e.player] ?? []), e.meld];
      handCounts.value[e.player] = e.handCount;
      const d = [...(discards.value[e.from] ?? [])];
      for (const t of e.meld.tiles) {
        const idx = d.lastIndexOf(t);
        if (idx >= 0) {
          d.splice(idx, 1);
          break;
        }
      }
      discards.value[e.from] = d;
      sfx.call();
      break;
    }
    case 'chankan-window':
      if (e.player !== mySeat.value) {
        pendingDiscard.value = { player: e.player, tile: e.tile, chankan: true };
      }
      break;
    case 'seedReveal': {
      // 冻结「本局」的承诺指纹：服务器开局后会立刻为下一局轮换承诺，不能让它覆盖本局记录
      const commitForThisRound = seedInfo.value.commit;
      seedInfo.value = {
        commit: commitForThisRound,
        verifiedCommit: commitForThisRound,
        serverSeed: e.serverSeed,
        clientSeeds: e.clientSeeds,
        salt: e.salt,
        // 本地重算承诺哈希：与开局前公布的一致 → 证明服务器未事后更换种子
        verified:
          commitForThisRound === '' ? undefined : sha256Hex(e.serverSeed) === commitForThisRound,
      };
      break;
    }
    case 'skill-pay': {
      const line = describe(e, memberName);
      if (line) pushToast(line); // 顶部提示，5 秒后自动消失
      if (!skillBuffer.includes(e.skill)) skillBuffer.push(e.skill);
      break;
    }
    case 'passed':
      pendingDiscard.value = null;
      break;
    case 'scores':
      scores.value = e.scores;
      break;
    case 'agaru': {
      const yakuman = e.han >= 13;
      if (yakuman) sfx.yakuman();
      else sfx.win();
      const delta = deltaOf(e.payments);
      result.value = {
        type: 'agaru',
        title: `${memberName(e.winner)} ${e.kind === 'tsumo' ? '自摸' : '荣和'}`,
        detail: `${e.han} 番 ${e.fu} 符`,
        yaku: e.yaku,
        payments: e.payments.filter((p) => p.to >= 0),
        delta,
        skills: [...skillBuffer],
        skillDetails: e.skills ?? [],
        hand: e.hand,
        melds: e.melds,
        winTile: e.winTile,
        yakuman,
      };
      // 和牌技能也在顶部提示一次
      for (const sd of e.skills ?? []) {
        pushToast(`【${sd.skill}】${memberName(e.winner)} ${sd.han > 0 ? '+' : ''}${sd.han} 番`);
      }
      animateDelta(delta);
      pendingDiscard.value = null;
      skillBuffer = [];
      break;
    }
    case 'ryukyoku': {
      sfx.ryukyoku();
      const kindNames: Record<string, string> = {
        kyuushu: '九种九牌',
        suufon: '四风连打',
        suukantsu: '四杠散了',
        suuchariichi: '四家立直',
        howanpai: '荒牌流局',
      };
      const delta = deltaOf(e.payments);
      result.value = {
        type: 'ryukyoku',
        title: kindNames[e.kind ?? 'howanpai'] ?? '流局',
        detail: '',
        yaku: [],
        payments: e.payments.filter((p) => p.to >= 0),
        delta,
        skills: [...skillBuffer],
        skillDetails: [],
        tenpai: e.tenpai,
        yakuman: false,
      };
      animateDelta(delta);
      pendingDiscard.value = null;
      skillBuffer = [];
      break;
    }
    case 'gameEnded':
      ended.value = true;
      reason.value = e.reason === 'tobi' ? '飞人终局' : e.reason === 'ryukyoku' ? '荒牌流局' : '和了终局';
      scores.value = e.scores;
      break;
  }
}

function handleMsg(msg: ServerMsg): void {
  switch (msg.t) {
    case 'welcome':
      mySeat.value = msg.seat;
      joinedRoom = msg.roomId; // 记录成功入座的房间，供断线复座
      status.value = msg.started ? '对局中' : '等待入座…';
      pushLog(
        msg.created
          ? `🏠 已创建房间 ${msg.roomId}（你是房主）`
          : msg.rejoined
            ? `✅ 断线重连，恢复座位 ${msg.seat + 1}`
            : `入座 ${msg.seat + 1} 位`,
      );
      net.send({ t: 'snapshot', seq: ++net.seq });
      break;
    case 'room':
      roomMembers.value = msg.members;
      hostSeat.value = msg.hostSeat;
      roomStarted.value = msg.started;
      break;
    case 'rooms':
      rooms.value = msg.rooms;
      break;
    case 'seedCommit':
      seedInfo.value = { commit: msg.commit };
      sendClientSeed(); // 承诺已锁定 → 贡献本方随机数
      break;
    case 'matching':
      matching.value = msg.waiting;
      status.value =
        msg.waiting >= 4 ? '匹配成功，进入对局…' : `正在匹配…（${msg.waiting}/4 名真人）`;
      break;
    case 'events':
      for (const e of msg.effects) handleEffect(e);
      break;
    case 'snapshot': {
      const st = msg.state;
      const me = mySeat.value ?? 0;
      hand.value = st.players[me]?.hand ?? [];
      scores.value = st.players.map((p) => p.score);
      handCounts.value = st.players.map((p) => p.hand.length);
      discards.value = st.players.map((p) => [...p.discards]);
      melds.value = st.players.map((p) => [...p.openMelds]);
      riichiFlags.value = st.players.map((p) => p.log.riichi);
      currentSeat.value = st.current;
      riichiSticks.value = st.riichiSticks;
      dealer.value = st.dealer;
      doraIndicators.value = st.doraIndicators.slice(0, st.doraCount ?? 0);
      wallCount.value = st.wall?.length ?? 0;
      [roundText.value, honbaText.value] = roundLabel(st.round);
      roomStarted.value = true;
      break;
    }
    case 'error':
      if (msg.code === 'wrong-password') {
        joinedRoom = '';
        status.value = '房间密码错误';
      } else if (msg.code === 'room-exists') {
        status.value = '该房间名已被占用，请换一个名字';
      } else if (msg.code === 'join-failed') {
        joinedRoom = '';
        status.value = '加入失败（房间可能已开局或已满）';
      }
      pushLog(`错误：${msg.code}`);
      break;
    case 'pong':
      break;
  }
}

// ---- 回放 ----

/** 创建房间（并作为房主进入） */
function createRoom(): void {
  if (!connected.value) {
    status.value = '请先点「连接」';
    return;
  }
  const room = newRoomId.value.trim();
  if (!room) {
    status.value = '请填写房间名';
    return;
  }
  status.value = '创建房间中…';
  net.send({
    t: 'create',
    payload: {
      roomId: room,
      name: name.value,
      generalId: generalId.value,
      password: newPassword.value,
      rules: { kiriageMangan: kiriageMangan.value },
    },
  });
}

/** 按房间号加入 */
function joinById(room: string, pwd?: string): void {
  if (!connected.value) {
    status.value = '请先点「连接」';
    return;
  }
  const id = room.trim();
  if (!id) {
    status.value = '请填写房间名';
    return;
  }
  joinRoomId.value = id;
  status.value = '加入房间中…';
  sendJoin(id, pwd ?? joinPassword.value);
}

/** 点击列表某房的「加入」 */
function pickRoom(r: { id: string; locked: boolean; started: boolean }): void {
  if (r.locked) {
    joinRoomId.value = r.id;
    status.value = `「${r.id}」需要密码，请填写密码后点「加入」`;
    return;
  }
  joinPassword.value = '';
  joinById(r.id, '');
}

/** 本局定牌信息（牌局公正性：承诺 → 局后公开 → 本地校验） */
const seedInfo = ref<{
  commit: string;
  /** 本局定牌时被冻结的指纹（下一局的承诺会覆盖 commit，故单独记录） */
  verifiedCommit?: string;
  serverSeed?: string;
  clientSeeds?: string[];
  salt?: string;
  verified?: boolean;
}>({ commit: '' });
const showSeedDetail = ref(false);

/** 生成本局贡献的随机数（16 字节 → hex） */
function makeClientSeed(): string {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 收到服务器种子承诺后立即贡献本方随机数（服务器此时已锁定种子，无法挑对我们不利的牌） */
function sendClientSeed(): void {
  if (!connected.value) return;
  net.send({ t: 'clientSeed', seed: makeClientSeed() });
}

/** 正在匹配：等待的真人数量（0 = 未在匹配） */
const matching = ref(0);

function startMatch(): void {
  if (!connected.value) {
    status.value = '请先点「连接」';
    return;
  }
  net.send({ t: 'match', name: name.value, generalId: generalId.value });
  status.value = '正在匹配…';
}

function cancelMatch(): void {
  net.send({ t: 'cancelMatch' });
  matching.value = 0;
  status.value = '已取消匹配';
}

/** 查询房间列表（需要已连接） */
function refreshRooms(): void {
  if (!connected.value) {
    status.value = '请先点「连接」';
    return;
  }
  net.send({ t: 'rooms' });
  status.value = '已刷新房间列表';
}

function act(action: Action): void {
  net.send({ t: 'act', action, seq: ++net.seq });
}

/** 按钮文案 */
function optionLabel(a: Action): string {
  switch (a.type) {
    case 'tsumo':
      return '自摸';
    case 'ron':
      return `荣和 ${tileName(a.tile)}`;
    case 'chii':
      return `吃 ${a.tiles.map(tileName).join('')}`;
    case 'pon':
      return `碰 ${tileName(a.tile)}`;
    case 'kan':
      return `杠 ${tileName(a.tile)}`;
    case 'ankan':
      return `暗杠 ${tileName(a.tile)}`;
    case 'kakan':
      return `加杠 ${tileName(a.tile)}`;
    case 'kyuushu':
      return '九种九牌';
    case 'pass':
      return '过';
    default:
      return a.type;
  }
}

/** 执行服务器下发的可选动作（摸牌/打牌不出现在按钮里） */
function doOption(a: Action): void {
  if (a.type === 'draw' || a.type === 'discard') return;
  act(a);
  myOptions.value = [];
}

/** 自己要显示的操作按钮（排除"打牌/摸牌"这两类由点手牌与自动摸牌处理） */
const visibleOptions = computed(() =>
  myOptions.value.filter((a) => a.type !== 'discard' && a.type !== 'draw'),
);

/** 立直模式：点「立直」后，点哪张手牌就带立直打出 */
const riichiMode = ref(false);

/** 当前能否立直（门清、未立直、14 张、且存在打出后即听牌的牌） */
const canRiichiNow = computed(() => {
  const me = mySeat.value;
  if (me == null || ended.value) return false;
  const h = shown.value.hands[me] ?? [];
  if (h.length !== 14) return false;
  if (shown.value.riichi[me]) return false;
  if ((shown.value.melds[me] ?? []).length > 0) return false;
  return h.some((_, i) => calcTenpai(h.filter((_, j) => j !== i)).length > 0);
});

function discardTile(t: Tile): void {
  if (ended.value) return;
  act({ type: 'discard', tile: t, riichi: riichiMode.value });
  riichiMode.value = false;
}

function ron(): void {
  const pd = pendingDiscard.value;
  if (pd == null || mySeat.value == null) return;
  act({ type: 'ron', player: mySeat.value, tile: pd.tile, from: pd.player });
  pendingDiscard.value = null;
}

function pass(): void {
  act({ type: 'pass' });
  pendingDiscard.value = null;
}

watch(soundOn, (v) => {
  sfx.enabled = v;
});

/** 移动端：请求全屏并锁定横屏（不支持则用 CSS 兜底旋转） */
async function enterFullscreenLandscape(): Promise<void> {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } })
      .orientation;
    if (orientation?.lock) await orientation.lock('landscape');
  } catch {
    /* 忽略：不支持时由 CSS 强制横屏 */
  }
}

/** 从后台返回前台：修复「退到后台一段时间后卡死」 */
function handleVisibility(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (!connected.value) {
    connectOnly(); // 断线则重连（凭 token 自动复座）
    return;
  }
  net.send({ t: 'snapshot', seq: ++net.seq }); // 已连接则补拉状态与可选项
}

function onResize(): void {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
}
let tickTimer: ReturnType<typeof setInterval> | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', handleVisibility);
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 250);
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', handleVisibility);
  }
  if (tickTimer) clearInterval(tickTimer);
  net.close();
});
</script>

<template>
  <div class="app">
    <!-- 顶部提示：技能触发等，5 秒后自动消失 -->
    <div class="toasts">
      <span v-for="t in toasts" :key="t.id" class="toast">{{ t.text }}</span>
    </div>
    <h1>三国麻雀</h1>

    <!-- 未连接 -->
    <!-- 未连接：玩家设置 + 连接 -->
    <template v-if="!connected">
      <div class="panel">
        <input v-model="name" placeholder="昵称" />
        <label class="opt"><input v-model="kiriageMangan" type="checkbox" />切上满贯（建房规则）</label>
        <button class="join" @click="connectOnly">连接</button>
        <span class="status">{{ status }}</span>
      </div>
      <p class="hint">连接后可进入房间大厅：创建房间或加入已有房间</p>
    </template>

    <!-- 已连接但未入座：房间大厅 -->
    <template v-else-if="mySeat === null">
      <div class="lobby">
        <p class="lobby-head">
          快速匹配（仅真人 · 不补 AI）
          <template v-if="matching > 0">
            <span class="matching">匹配中… {{ matching }}/4</span>
            <button class="mini" @click="cancelMatch">取消匹配</button>
          </template>
          <button v-else class="join" @click="startMatch">快速匹配</button>
        </p>

        <p class="lobby-head">
          房间大厅（{{ rooms.length }}）
          <button class="mini" @click="refreshRooms">刷新</button>
        </p>
        <p v-if="rooms.length === 0" class="hint">还没有房间 —— 在下面创建一个开始吧</p>
        <ul class="room-list">
          <li v-for="r in rooms" :key="r.id">
            <span class="room-name">{{ r.locked ? '🔒 ' : '' }}{{ r.id }}</span>
            <span class="room-meta">
              {{ r.humans }} 人 + {{ r.ais }} AI · {{ r.started ? '进行中' : '待开局' }}
            </span>
            <button class="mini" @click="pickRoom(r)">加入</button>
          </li>
        </ul>

        <div class="lobby-forms">
          <div class="form">
            <h3>创建房间</h3>
            <input v-model="newRoomId" placeholder="房间名" />
            <input v-model="newPassword" type="password" placeholder="密码（可空）" />
            <button class="join" @click="createRoom">创建并进入</button>
          </div>
          <div class="form">
            <h3>加入房间</h3>
            <input v-model="joinRoomId" placeholder="房间名" />
            <input v-model="joinPassword" type="password" placeholder="密码（无则留空）" />
            <button @click="joinById(joinRoomId)">加入</button>
          </div>
        </div>
        <p class="hint">{{ status }}</p>
      </div>
    </template>

    <!-- 已连接 -->
    <template v-else>
      <div v-if="!roomStarted" class="lobby">
        <p>入座情况（{{ roomMembers.filter((m) => !m.isAI).length }} 真人 + {{ roomMembers.filter((m) => m.isAI).length }} AI）</p>
        <p class="members">
          <span v-for="m in roomMembers" :key="m.seat" :class="{ me: m.seat === mySeat }">
            {{ m.seat + 1 }}位 {{ m.name }}{{ m.isAI ? '（AI）' : '' }} · {{ generalNameOf(m.seat) }}「{{ skillNameOf(m.seat) }}」
          </span>
        </p>
        <div class="general-pick">
          <p>选择你的武将（点击切换，开局后锁定）</p>
          <div class="general-grid">
            <button
              v-for="g in ALL_GENERALS"
              :key="g.id"
              class="general-card"
              :class="{ active: myGeneralId === g.id }"
              @click="pickGeneral(g.id)"
            >
              <b>{{ g.name }}</b>
              <i>「{{ g.skills[0]?.name }}」</i>
              <small>{{ g.desc }}</small>
            </button>
          </div>
        </div>

        <div v-if="isHost" class="controls">
          <button @click="net.send({ t: 'addAI' })">补入 AI</button>
          <button @click="net.send({ t: 'start' })">开局（空位以 AI 补足）</button>
        </div>
      </div>

      <!-- 牌桌 -->
      <div v-else class="table">
        <!-- 左上角：宝牌指示牌 + 场供 -->
        <div class="corner">
          <span class="corner-label">宝牌</span>
          <span class="corner-tiles">
            <TileSprite v-for="(t, i) in doraIndicators" :key="i" :tile="t" :size="26" />
          </span>
          <span class="corner-sep" />
          <span class="corner-label">供托</span>
          <span class="corner-val">{{ shown.riichiSticks * 1000 }}</span>
          <span class="corner-sep" />
          <span class="corner-label">场供</span>
          <span class="corner-val">{{ honba * 300 }}</span>
          <span v-if="honba > 0" class="corner-sub">{{ honba }} 本场</span>
        </div>

        <!-- 对家：横排，整体居中 -->
        <section class="seat top" :class="{ turn: shown.current === seats.top }">
          <div class="row melds">
            <span v-for="(m, i) in shown.melds[seats.top]" :key="i" class="meld-group">
              <TileSprite
                v-for="(t, j) in m.tiles"
                :key="j"
                :tile="t"
                :rotated="isCalled(m, j)"
                :size="18"
              />
            </span>
          </div>
          <div class="row backs">
            <TileSprite v-for="i in shown.handCounts[seats.top]" :key="i" back :size="18" />
          </div>
          <div class="seat-tag" @click="inspectSeat = seats.top">
            <em class="wind">{{ windOf(seats.top) }}</em>{{ memberName(seats.top) }}<em class="gen">{{ generalNameOf(seats.top) }}</em><span
              v-if="shown.riichi[seats.top]"
              class="riichi"
            >
              立直</span
            >
          </div>
        </section>

        <!-- 上家：竖排（牌旋转 90°） -->
        <section class="seat left" :class="{ turn: shown.current === seats.left }">
          <div class="v-stack">
            <span class="v-melds">
              <TileSprite
                v-for="(m, i) in shown.melds[seats.left]"
                :key="i"
                :tile="m.tiles[0]"
                :rotated="true"
                :size="18"
              />
            </span>
            <span class="v-backs">
              <i v-for="i in shown.handCounts[seats.left]" :key="i" class="back-v" />
            </span>
            <span class="seat-tag v-tag" @click="inspectSeat = seats.left">
              <em class="wind">{{ windOf(seats.left) }}</em>{{ memberName(seats.left) }}<em class="gen">{{ generalNameOf(seats.left) }}</em><span
                v-if="shown.riichi[seats.left]"
                class="riichi"
              >
                立直</span
              >
            </span>
          </div>
        </section>

        <!-- 中央：方块（点数 + 风位）四周环绕牌河 -->
        <section class="center">
          <div class="river-top">
            <TileSprite
              v-for="(t, i) in shown.discards[seats.top]"
              :key="i"
              :tile="t"
              :rotated="shown.riichiDiscardIdx[seats.top] === i"
              :size="18"
              dim
            />
          </div>
          <div class="river-mid">
            <div class="river-left">
              <TileSprite
                v-for="(t, i) in shown.discards[seats.left]"
                :key="i"
                :tile="t"
                :rotated="shown.riichiDiscardIdx[seats.left] !== i"
                :size="18"
                dim
              />
            </div>
            <div class="core">
              <span class="core-cell">
                <em class="w">{{ windOf(seats.top) }}</em>{{ shown.scores[seats.top] }}
              </span>
              <span class="core-row">
                <span class="core-cell">
                  <em class="w">{{ windOf(seats.left) }}</em>{{ shown.scores[seats.left] }}
                </span>
                <span class="core-center">
                  <b>{{ shown.roundText }}</b>
                  <i>剩 {{ wallCount }}</i>
                </span>
                <span class="core-cell">
                  <em class="w">{{ windOf(seats.right) }}</em>{{ shown.scores[seats.right] }}
                </span>
              </span>
              <span class="core-cell me">
                <em class="w">{{ windOf(seats.self) }}</em>{{ shown.scores[seats.self] }}
              </span>
            </div>
            <div class="river-right">
              <TileSprite
                v-for="(t, i) in shown.discards[seats.right]"
                :key="i"
                :tile="t"
                :rotated="shown.riichiDiscardIdx[seats.right] !== i"
                :size="18"
                dim
              />
            </div>
          </div>
          <div class="river-bottom">
            <TileSprite
              v-for="(t, i) in shown.discards[seats.self]"
              :key="i"
              :tile="t"
              :rotated="shown.riichiDiscardIdx[seats.self] === i"
              :size="18"
              dim
            />
          </div>
        </section>

        <!-- 下家：竖排 -->
        <section class="seat right" :class="{ turn: shown.current === seats.right }">
          <div class="v-stack">
            <span class="seat-tag v-tag" @click="inspectSeat = seats.right">
              <em class="wind">{{ windOf(seats.right) }}</em>{{ memberName(seats.right) }}<em class="gen">{{ generalNameOf(seats.right) }}</em><span
                v-if="shown.riichi[seats.right]"
                class="riichi"
              >
                立直</span
              >
            </span>
            <span class="v-backs">
              <i v-for="i in shown.handCounts[seats.right]" :key="i" class="back-v" />
            </span>
            <span class="v-melds">
              <TileSprite
                v-for="(m, i) in shown.melds[seats.right]"
                :key="i"
                :tile="m.tiles[0]"
                :rotated="true"
                :size="18"
              />
            </span>
          </div>
        </section>

        <!-- 上层：自己的手牌层（副露 + 手牌 + 倒计时，与下方牌河分层） -->
        <section class="seat self" :class="{ turn: shown.current === seats.self }">
          <div class="controls">
            <button
              v-if="canRiichiNow"
              class="riichi"
              :class="{ active: riichiMode }"
              @click="riichiMode = !riichiMode"
            >
              {{ riichiMode ? '立直：请点手牌' : '立直' }}
            </button>
            <button
              v-for="(a, i) in visibleOptions"
              :key="i"
              :class="{ ron: a.type === 'ron', strong: a.type === 'tsumo' }"
              @click="doOption(a)"
            >
              {{ optionLabel(a) }}
            </button>
          </div>
          <div class="hand-layer">
            <span v-if="shown.melds[seats.self].length > 0" class="hand-melds">
              <span v-for="(m, i) in shown.melds[seats.self]" :key="i" class="meld-group">
                <TileSprite
                  v-for="(t, j) in m.tiles"
                  :key="j"
                  :tile="t"
                  :rotated="isCalled(m, j)"
                  :size="24"
                />
              </span>
            </span>
            <span class="hand-tiles">
              <TileSprite
                v-for="(t, i) in handCore"
                :key="i"
                :tile="t"
                :size="handTileSize"
                @click="discardTile(t)"
              />
              <TileSprite
                v-if="shown.lastDrawn != null"
                class="just-drawn"
                :tile="shown.lastDrawn"
                :size="handTileSize"
                @click="discardTile(shown.lastDrawn)"
              />
            </span>
            <span v-if="remainSec !== null" class="timer" :class="{ urgent: inExtraTime }">
              {{ remainSec }}s
            </span>
          </div>
        </section>
      </div>

      <p v-if="ended" class="ended">—— {{ reason }} ——</p>

    </template>

    <!-- 武将详情（点击座位名查看） -->
    <div v-if="inspectSeat !== null" class="modal-mask" @click.self="inspectSeat = null">
      <div class="info-card">
        <div class="info-title">
          {{ memberName(inspectSeat) }} · {{ generalOf(inspectSeat)?.name }}
        </div>
        <div v-for="(sk, i) in generalOf(inspectSeat)?.skills ?? []" :key="i" class="info-skill">
          <b>「{{ sk.name }}」</b><span>{{ sk.desc }}</span>
        </div>
        <div class="info-note">阵营：{{ factionName(generalOf(inspectSeat)?.faction) }}</div>
        <button class="scroll-btn" @click="inspectSeat = null">关 闭</button>
      </div>
    </div>

    <!-- 结算面板（卷轴） -->
    <div v-if="result" class="modal-mask" @click.self="result = null">
      <div class="scroll" :class="{ yakuman: result.yakuman }">
        <div class="scroll-title">
          {{ result.title }}
          <span v-if="result.yakuman" class="seal">役满</span>
        </div>
        <div class="scroll-body">
          <template v-if="result.type === 'agaru'">
            <div class="yaku-line">
              <span v-for="(y, i) in result.yaku" :key="i" class="yaku-tag">{{ y }}</span>
            </div>
            <div class="detail-line">{{ result.detail }}</div>
            <div v-if="result.hand?.length" class="shape-line">
              <span class="shape-label">牌型（和牌张以朱砂框标出）</span>
              <span class="shape-tiles">
                <TileSprite
                  v-for="(t, i) in sortTiles(result.hand)"
                  :key="i"
                  :tile="t"
                  :size="26"
                  :class="{ 'win-tile': i === winTileMark }"
                />
                <span v-for="(m, i) in result.melds ?? []" :key="'m' + i" class="shape-meld">
                  <TileSprite v-for="(t, j) in m.tiles" :key="j" :tile="t" :size="26" />
                </span>
              </span>
            </div>
          </template>
          <template v-else>
            <div class="tenpai-line">
              <span v-for="(t, i) in result.tenpai ?? []" :key="i" :class="{ ten: t }">
                {{ memberName(i) }} {{ t ? '听牌' : '未听' }}
              </span>
            </div>
          </template>

          <div v-if="seedInfo.verifiedCommit || seedInfo.commit" class="seed-card">
            <div class="seed-head">
              <span class="seed-label">牌局指纹</span>
              <code class="seed-val">{{ (seedInfo.verifiedCommit ?? seedInfo.commit).slice(0, 16) }}…</code>
              <span v-if="seedInfo.verified === true" class="seed-ok">✅ 公正性已验证</span>
              <span v-else-if="seedInfo.verified === false" class="seed-bad">❌ 校验失败</span>
              <button
                v-if="seedInfo.serverSeed"
                class="mini"
                @click="showSeedDetail = !showSeedDetail"
              >
                {{ showSeedDetail ? '收起' : '详情' }}
              </button>
            </div>
            <div v-if="showSeedDetail" class="seed-detail">
              <div>服务器种子：<code>{{ seedInfo.serverSeed }}</code></div>
              <div>玩家随机数：<code>{{ (seedInfo.clientSeeds ?? []).join(' ') }}</code></div>
              <div>盐：<code>{{ seedInfo.salt }}</code></div>
              <div class="seed-note">
                验证方式：sha256(服务器种子) 应等于开局前公布的指纹；牌序由「种子:盐」经 SHA-256
                计数器流唯一确定，局后可自行复算。
              </div>
            </div>
          </div>
          <table v-if="result.payments.length" class="pay-table">
            <tr v-for="(p, i) in result.payments" :key="i">
              <td>{{ p.from >= 0 ? memberName(p.from) + " → " + memberName(p.to) : "立直棒 → " + memberName(p.to) }}</td>
              <td class="num">{{ p.amount }}</td>
            </tr>
          </table>

          <div class="delta-line">
            <span v-for="(d, i) in animDelta" :key="i" :class="{ up: d > 0, down: d < 0 }">
              {{ memberName(i) }} {{ d > 0 ? '+' : '' }}{{ d }}
            </span>
          </div>

          <div v-if="result.skillDetails.length || result.skills.length" class="skills-line">
            技能：
            <span v-if="result.skillDetails.length" class="skill-detail">
              <span v-for="(sd, i) in result.skillDetails" :key="i" class="skill-chip">
                {{ sd.skill }} <b>{{ sd.han > 0 ? '+' : '' }}{{ sd.han }} 番</b>
                <template v-if="sd.fu !== 0">
                  <b>{{ sd.fu > 0 ? '+' : '' }}{{ sd.fu }} 符</b>
                </template>
              </span>
            </span>
            <span v-else>{{ result.skills.join('、') }}</span>
          </div>
        </div>
        <button class="scroll-btn" @click="result = null">收 卷</button>
      </div>
    </div>
  </div>
</template>
