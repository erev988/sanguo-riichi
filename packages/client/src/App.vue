<script setup lang="ts">
import {
  ALL_GENERALS,
  replayGame,
  tileName,
  type Action,
  type GameEffect,
  type Meld,
  type ReplayData,
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
const roomId = ref('room1');
const password = ref('');
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
/** 视口尺寸（手牌自适应缩放，保证一整条且不撑破布局） */
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
const replayFrames = ref<Frame[]>([]);
const replayIdx = ref(0);
const replayActive = ref(false);
const replayPlaying = ref(false);
const replaySpeed = ref(2);
const replayInfo = ref('');
let replayTimer: ReturnType<typeof setInterval> | null = null;

const currentGeneral = computed(() => ALL_GENERALS.find((g) => g.id === generalId.value));
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

const replayFrame = computed<Frame | null>(() => replayFrames.value[replayIdx.value] ?? null);
const shown = computed<Frame>(() => (replayActive.value ? (replayFrame.value ?? liveFrame.value) : liveFrame.value));

/** 手牌主体（不含刚摸的牌），并按牌面排序（万→饼→索→字；赤 5 归入 5 的位置） */
const handCore = computed(() => {
  const h = shown.value.hands[mySeat.value ?? 0] ?? [];
  const body = shown.value.lastDrawn != null ? h.slice(0, -1) : h;
  const norm = (t: Tile): number => (t === 0 ? 5 : t === 10 ? 15 : t === 20 ? 25 : t);
  return [...body].sort((a, b) => norm(a) - norm(b));
});

/** 手牌牌高：同时受视口宽/高约束，保证 13/14 张一整条且不撑破牌桌 */
const handTileSize = computed(() => {
  const n = (handCore.value.length ?? 13) + 1;
  const byWidth = Math.floor((vw.value - 56) / Math.max(13, n));
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
    case 'skill-pay':
      if (!skillBuffer.includes(e.skill)) skillBuffer.push(e.skill);
      break;
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
        payments: e.payments.filter((p) => p.from >= 0 && p.to >= 0),
        delta,
        skills: [...skillBuffer],
        yakuman,
      };
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
        payments: e.payments.filter((p) => p.from >= 0 && p.to >= 0),
        delta,
        skills: [...skillBuffer],
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
      pushLog(msg.rejoined ? `✅ 断线重连，恢复座位 ${msg.seat + 1}` : `入座 ${msg.seat + 1} 位`);
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
    case 'replay':
      if (msg.replay) loadReplay(msg.replay);
      else pushLog('（本房暂无录像）');
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
        status.value = '房间密码错误，请重新入座';
      } else if (msg.code === 'join-failed') {
        joinedRoom = '';
        status.value = '入座失败（房间可能已开局或已满）';
      }
      pushLog(`错误：${msg.code}`);
      break;
    case 'pong':
      break;
  }
}

// ---- 回放 ----
function loadReplay(data: ReplayData): void {
  const frames: Frame[] = [];
  let acc: string[] = [];
  const nameOf = (s: number): string => data.seats[s]?.name ?? `P${s + 1}`;
  let dora: Tile[] = [];
  let wallN = 0;
  replayGame(data, (state, effects) => {
    for (const e of effects) {
      const line = describe(e, nameOf);
      if (line) {
        acc = [line, ...acc].slice(0, 200);
      }
      if (e.type === 'dora') dora = e.indicators;
      if (e.type === 'wall') wallN = e.count;
    }
    const [rt, ht] = roundLabel(state.round);
    frames.push({
      roundText: rt,
      honbaText: ht,
      scores: state.players.map((p) => p.score),
      hands: state.players.map((p) => [...p.hand]),
      handCounts: state.players.map((p) => p.hand.length),
      discards: state.players.map((p) => [...p.discards]),
      melds: state.players.map((p) => [...p.openMelds]),
      riichi: state.players.map((p) => p.log.riichi),
      riichiDiscardIdx: {},
      current: state.current,
      riichiSticks: state.riichiSticks,
      logs: acc,
      lastDrawn: null,
    });
  });
  if (frames.length === 0) {
    pushLog('录像为空');
    return;
  }
  replayFrames.value = frames;
  replayIdx.value = 0;
  replayActive.value = true;
  replayInfo.value = `房间 ${data.roomId} · ${frames.length} 步 · ${new Date(data.createdAt).toLocaleString()}`;
  pushLog(`📽 载入录像：${data.rounds.length} 局 / ${frames.length} 步`);
}

function setReplayIdx(i: number): void {
  replayIdx.value = Math.max(0, Math.min(replayFrames.value.length - 1, i));
}

function replayToggle(): void {
  replayPlaying.value = !replayPlaying.value;
}

function stopReplay(): void {
  replayPlaying.value = false;
  replayActive.value = false;
  replayFrames.value = [];
  replayIdx.value = 0;
}

// 自动播放
watch([replayPlaying, replaySpeed], () => {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
  if (!replayPlaying.value) return;
  const interval = Math.max(60, 900 / replaySpeed.value);
  replayTimer = setInterval(() => {
    if (replayIdx.value >= replayFrames.value.length - 1) {
      replayPlaying.value = false;
      return;
    }
    replayIdx.value += 1;
  }, interval);
});

/** 连接（只建立 WS，不入座） */
function connectOnly(): void {
  void enterFullscreenLandscape(); // 移动端：自动进入全屏并锁横屏
  net.onOpen = () => {
    connected.value = true;
    if (joinedRoom) {
      status.value = '重连中，恢复座位…';
      sendJoin(joinedRoom); // 断线后自动复座（token 免密码）
    } else {
      status.value = '已连接';
      net.send({ t: 'rooms' }); // 连上后顺手拉一次房间列表
    }
  };
  net.onClose = () => {
    connected.value = false;
    status.value = '连接断开，正在重连…';
  };
  net.onReconnecting = (attempt, delayMs) => {
    status.value = `连接断开，${Math.round(delayMs / 1000)}s 后重连（第 ${attempt} 次）…`;
  };
  net.onMsg = handleMsg;
  const wsUrl =
    (import.meta.env.VITE_WS_URL as string | undefined) ??
    `ws://${location.hostname || 'localhost'}:8787`;
  net.connect(wsUrl);
  status.value = '连接中…';
}

function sendJoin(room: string): void {
  net.send({
    t: 'join',
    payload: {
      name: name.value,
      roomId: room,
      generalId: generalId.value,
      rules: { kiriageMangan: kiriageMangan.value },
      token: token.value,
      password: password.value,
    },
  });
}

/** 入座（连接 + 房间号 + 密码都齐了才发） */
function joinRoom(): void {
  if (!connected.value) {
    status.value = '请先点「连接」';
    return;
  }
  const room = roomId.value.trim();
  if (!room) {
    status.value = '请填写房间号';
    return;
  }
  status.value = '入座中…';
  sendJoin(room);
}

/** 刷新房间列表（需要已连接） */
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

function discardTile(t: Tile): void {
  if (ended.value || replayActive.value) return;
  act({ type: 'discard', tile: t });
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

function onResize(): void {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
}
let tickTimer: ReturnType<typeof setInterval> | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', onResize);
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 250);
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  if (tickTimer) clearInterval(tickTimer);
  if (replayTimer) clearInterval(replayTimer);
  net.close();
});
</script>

<template>
  <div class="app">
    <h1>三国麻雀</h1>

    <!-- 未连接 -->
    <template v-if="!connected">
      <div class="panel">
        <input v-model="name" placeholder="昵称" />
        <input v-model="roomId" placeholder="房间号" />
        <input v-model="password" type="password" placeholder="房间密码（可空）" />
        <select v-model="generalId">
          <option v-for="g in ALL_GENERALS" :key="g.id" :value="g.id">{{ g.name }}（{{ g.desc }}）</option>
        </select>
        <label class="opt"><input v-model="kiriageMangan" type="checkbox" />切上满贯</label>
      </div>
      <div class="panel">
        <button @click="connectOnly" :disabled="connected">
          {{ connected ? '已连接' : '连接' }}
        </button>
        <button @click="refreshRooms" :disabled="!connected">刷新列表</button>
        <button class="join" @click="joinRoom" :disabled="!connected">入座</button>
        <span class="status">{{ status }}</span>
      </div>

      <div class="lobby">
        <p>房间一览</p>
        <p v-if="rooms.length === 0" class="hint">（暂无房间，连上后点「刷新列表」）</p>
        <p class="members">
          <span v-for="r in rooms" :key="r.id" class="room-item" @click="roomId = r.id">
            {{ r.locked ? '🔒 ' : '' }}{{ r.id }} · {{ r.humans }} 人 + {{ r.ais }} AI ·
            {{ r.started ? '进行中' : '待开局' }}
          </span>
        </p>
        <p class="hint">点击房间名可填入房间号；🔒 表示需要密码（房主建房时设置的密码即为该房密码）</p>
      </div>
    </template>

    <!-- 已连接 -->
    <template v-else>
      <div class="topbar">
        <span class="round">{{ shown.roundText }} {{ shown.honbaText }}</span>
        <span class="tools">
          <label class="opt"><input v-model="soundOn" type="checkbox" />音效</label>
          <button class="mini" @click="net.send({ t: 'replay' })">看录像</button>
        </span>
        <span>供托 {{ shown.riichiSticks }} ｜ {{ currentGeneral?.name }}「{{ currentGeneral?.skills[0]?.name }}」</span>
      </div>

      <!-- 回放控制条 -->
      <div v-if="replayActive" class="replay-bar">
        <span class="replay-info">📽 {{ replayInfo }}</span>
        <span class="replay-steps">第 {{ replayIdx + 1 }} / {{ replayFrames.length }} 步</span>
        <span class="controls">
          <button class="mini" @click="setReplayIdx(0)">⏮ 开头</button>
          <button class="mini" @click="setReplayIdx(replayIdx - 1)">◀ 上一步</button>
          <button class="mini" @click="replayToggle()">{{ replayPlaying ? '⏸ 暂停' : '▶ 播放' }}</button>
          <button class="mini" @click="setReplayIdx(replayIdx + 1)">下一步 ▶</button>
          <button class="mini" @click="setReplayIdx(replayFrames.length - 1)">末尾 ⏭</button>
          <select v-model.number="replaySpeed">
            <option :value="0.5">0.5×</option>
            <option :value="1">1×</option>
            <option :value="2">2×</option>
            <option :value="4">4×</option>
          </select>
          <button class="mini" @click="stopReplay()">退出回放</button>
        </span>
      </div>

      <div v-if="!roomStarted" class="lobby">
        <p>入座情况（{{ roomMembers.filter((m) => !m.isAI).length }} 真人 + {{ roomMembers.filter((m) => m.isAI).length }} AI）</p>
        <p class="members">
          <span v-for="m in roomMembers" :key="m.seat" :class="{ me: m.seat === mySeat }">
            {{ m.seat + 1 }}位 {{ m.name }}{{ m.isAI ? '（AI）' : '' }} · {{ generalNameOf(m.seat) }}「{{ skillNameOf(m.seat) }}」
          </span>
        </p>
        <div v-if="isHost" class="controls">
          <button @click="net.send({ t: 'addAI' })">补入 AI</button>
          <button @click="net.send({ t: 'start' })">开局（空位以 AI 补足）</button>
        </div>
      </div>

      <!-- 牌桌 -->
      <div v-else class="table">
        <section class="seat top" :class="{ turn: shown.current === seats.top }">
          <header>
            <span class="who"><em class="wind">{{ windOf(seats.top) }}</em>{{ memberName(seats.top) }}<em class="general">「{{ generalNameOf(seats.top) }}·{{ skillNameOf(seats.top) }}」</em><span v-if="shown.riichi[seats.top]" class="riichi"> 立直</span></span>
            <span class="score">{{ shown.scores[seats.top] }}</span>
          </header>
          <div class="row backs">
            <TileSprite v-for="i in shown.handCounts[seats.top]" :key="i" back :size="18" />
          </div>
          <div class="row melds">
            <span v-for="(m, i) in shown.melds[seats.top]" :key="i" class="meld-group">
              <TileSprite v-for="(t, j) in m.tiles" :key="j" :tile="t" :rotated="isCalled(m, j)" :size="20" />
            </span>
          </div>
        </section>

        <section class="seat left" :class="{ turn: shown.current === seats.left }">
          <header>
            <span class="who"><em class="wind">{{ windOf(seats.left) }}</em>{{ memberName(seats.left) }}<em class="general">「{{ generalNameOf(seats.left) }}·{{ skillNameOf(seats.left) }}」</em><span v-if="shown.riichi[seats.left]" class="riichi"> 立直</span></span>
            <span class="score">{{ shown.scores[seats.left] }}</span>
          </header>
          <div class="row backs">
            <TileSprite v-for="i in shown.handCounts[seats.left]" :key="i" back :size="18" />
          </div>
          <div class="row melds">
            <span v-for="(m, i) in shown.melds[seats.left]" :key="i" class="meld-group">
              <TileSprite v-for="(t, j) in m.tiles" :key="j" :tile="t" :rotated="isCalled(m, j)" :size="20" />
            </span>
          </div>
        </section>

        <section class="center">
          <div class="ring">
            <div class="ring-row">
              <TileSprite
                v-for="(t, i) in shown.discards[seats.top]"
                :key="i"
                :tile="t"
                :rotated="shown.riichiDiscardIdx[seats.top] === i"
                :size="18"
                dim
              />
            </div>
            <div class="ring-mid">
              <div class="ring-col">
                <TileSprite
                  v-for="(t, i) in shown.discards[seats.left]"
                  :key="i"
                  :tile="t"
                  :rotated="shown.riichiDiscardIdx[seats.left] === i"
                  :size="17"
                  dim
                />
              </div>
              <div class="field">
                <span class="big">{{ shown.roundText }}</span>
                <span class="wind-row">
                  <span v-for="s in [seats.self, seats.right, seats.top, seats.left]" :key="s" class="wind-chip">
                    {{ windOf(s) }}<em v-if="isDealer(s)">庄</em>
                  </span>
                </span>
                <span class="dora-row">
                  <span class="label">宝牌</span>
                  <TileSprite v-for="(t, i) in doraIndicators" :key="i" :tile="t" :size="22" />
                </span>
                <span>剩 {{ wallCount }} 张</span>
              </div>
              <div class="ring-col">
                <TileSprite
                  v-for="(t, i) in shown.discards[seats.right]"
                  :key="i"
                  :tile="t"
                  :rotated="shown.riichiDiscardIdx[seats.right] === i"
                  :size="17"
                  dim
                />
              </div>
            </div>
            <div class="ring-row">
              <TileSprite
                v-for="(t, i) in shown.discards[seats.self]"
                :key="i"
                :tile="t"
                :rotated="shown.riichiDiscardIdx[seats.self] === i"
                :size="18"
                dim
              />
            </div>
          </div>
        </section>

        <section class="seat right" :class="{ turn: shown.current === seats.right }">
          <header>
            <span class="who"><em class="wind">{{ windOf(seats.right) }}</em>{{ memberName(seats.right) }}<em class="general">「{{ generalNameOf(seats.right) }}·{{ skillNameOf(seats.right) }}」</em><span v-if="shown.riichi[seats.right]" class="riichi"> 立直</span></span>
            <span class="score">{{ shown.scores[seats.right] }}</span>
          </header>
          <div class="row backs">
            <TileSprite v-for="i in shown.handCounts[seats.right]" :key="i" back :size="18" />
          </div>
          <div class="row melds">
            <span v-for="(m, i) in shown.melds[seats.right]" :key="i" class="meld-group">
              <TileSprite v-for="(t, j) in m.tiles" :key="j" :tile="t" :rotated="isCalled(m, j)" :size="20" />
            </span>
          </div>
        </section>

        <section class="seat self" :class="{ turn: shown.current === seats.self }">
          <header>
            <span class="who"><em class="wind">{{ windOf(seats.self) }}</em>你 · {{ currentGeneral?.name }}<em class="general">「{{ currentGeneral?.skills[0]?.name }}」</em><span v-if="shown.riichi[seats.self]" class="riichi"> 立直</span></span>
            <span class="score">
              <span v-if="remainSec !== null && !replayActive" class="timer" :class="{ urgent: inExtraTime }">
                {{ remainSec }}s{{ inExtraTime ? '（补时）' : '' }}
              </span>
              {{ shown.scores[seats.self] }}
            </span>
          </header>
          <div class="row melds">
            <span v-for="(m, i) in shown.melds[seats.self]" :key="i" class="meld-group">
              <TileSprite v-for="(t, j) in m.tiles" :key="j" :tile="t" :rotated="isCalled(m, j)" :size="28" />
            </span>
          </div>
          <div class="row hand">
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
          </div>
          <div v-if="!replayActive" class="controls">
            <button
              v-for="(a, i) in myOptions"
              :key="i"
              :class="{ ron: a.type === 'ron', strong: a.type === 'tsumo' }"
              @click="doOption(a)"
            >
              {{ optionLabel(a) }}
            </button>
          </div>
        </section>
      </div>

      <p v-if="ended && !replayActive" class="ended">—— {{ reason }} ——</p>

      <div class="log">
        <p v-for="(l, i) in shown.logs" :key="i">{{ l }}</p>
      </div>
    </template>

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
          </template>
          <template v-else>
            <div class="tenpai-line">
              <span v-for="(t, i) in result.tenpai ?? []" :key="i" :class="{ ten: t }">
                {{ memberName(i) }} {{ t ? '听牌' : '未听' }}
              </span>
            </div>
          </template>

          <table v-if="result.payments.length" class="pay-table">
            <tr v-for="(p, i) in result.payments" :key="i">
              <td>{{ memberName(p.from) }} → {{ memberName(p.to) }}</td>
              <td class="num">{{ p.amount }}</td>
            </tr>
          </table>

          <div class="delta-line">
            <span v-for="(d, i) in animDelta" :key="i" :class="{ up: d > 0, down: d < 0 }">
              {{ memberName(i) }} {{ d > 0 ? '+' : '' }}{{ d }}
            </span>
          </div>

          <div v-if="result.skills.length" class="skills-line">技能：{{ result.skills.join('、') }}</div>
        </div>
        <button class="scroll-btn" @click="result = null">收 卷</button>
      </div>
    </div>
  </div>
</template>
