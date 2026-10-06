import {
  ALL_GENERALS,
  advanceRound,
  aiPlan,
  canRon,
  createGame,
  generalById,
  resolveRules,
  step,
  type Action,
  type GameEffect,
  type GameState,
  type ReplayData,
  type ReplayRound,
  type RoundInfo,
  type Rules,
  type SeatConfig,
  type SeatInfo,
  type Skill,
} from '@sanguo/core';
import { WebSocket } from 'ws';

interface RoomMember {
  seat: number;
  name: string;
  generalId: string;
  isAI: boolean;
  ws?: WebSocket;
}

/**
 * 房间：权威服务器对局容器。
 * - 只跑一份 core 引擎，客户端只发命令、收广播（防作弊、可回放）
 * - 人数不够时自动用 AI 补位（“手动增加 AI”按钮在 M5 UI 加，逻辑相同）
 * - 断线：快照重连（M2 做完整补偿）
 */
export class Room {
  readonly id: string;
  private members = new Map<number, RoomMember>(); // seat → member
  private sockets = new Map<WebSocket, number>(); // ws → seat
  private state?: GameState;
  /** 本房规则（首个加入者=房主 指定） */
  rules: Rules = resolveRules();
  /** 房主座位（首个加入的真人） */
  hostSeat = -1;
  /** 会话标识 → 座位（断线重连凭此恢复原座位） */
  private tokens = new Map<string, number>();
  // ---- 录像：记录动作序列即可完整重放（引擎为纯函数） ----
  private meta?: { seats: SeatConfig[]; rules: Rules; seed: number };
  private rounds: ReplayRound[] = [];
  private currentActions: { seat: number; action: Action }[] = [];
  private roundStart?: { round: RoundInfo; dealer: number };
  private aiTimer?: ReturnType<typeof setTimeout>;
  private ronTimer?: ReturnType<typeof setTimeout>;
  private nextTimer?: ReturnType<typeof setTimeout>;
  private started = false;

  constructor(
    id: string,
    private seed: number,
    /** 真人起房人数：达到即开局，其余空位自动补 AI */
    private minPlayers = 2,
  ) {
    this.id = id;
  }

  /**
   * 真人加入 / 断线重连。
   * - 带 token 且命中已有座位 → 恢复原座位（取消 AI 托管）
   * - 否则作为新玩家占空位（游戏已开始则拒绝）
   * 开局条件：满 4 人自动开局，或房主发 start（空位补 AI）。
   */
  join(
    ws: WebSocket,
    name: string,
    generalId: string,
    rules?: Partial<Rules>,
    token?: string,
  ): { seat: number; started: boolean; rejoined: boolean } {
    // 断线重连：token 命中 → 恢复原座位
    if (token) {
      const seat = this.tokens.get(token);
      if (seat != null) {
        const m = this.members.get(seat);
        if (m) {
          if (m.ws) {
            try {
              m.ws.close(); // 踢掉旧连接
            } catch {
              /* ignore */
            }
          }
          m.ws = ws;
          m.isAI = false; // 取消 AI 托管
          this.sockets.set(ws, seat);
          this.broadcastRoom();
          this.scheduleAI();
          return { seat, started: this.started, rejoined: true };
        }
      }
    }

    if (this.started) throw new Error('游戏已开始');
    if (this.hostSeat < 0) {
      this.hostSeat = this.firstFreeSeat();
      this.rules = resolveRules(rules); // 房主规则
    }
    const general = generalById(generalId) ?? ALL_GENERALS[0];
    const seat = this.firstFreeSeat();
    if (seat < 0) throw new Error('房间已满');

    this.members.set(seat, { seat, name, generalId: general.id, isAI: false, ws });
    this.sockets.set(ws, seat);
    if (token) this.tokens.set(token, seat);
    this.broadcastRoom();
    if (this.members.size >= 4) this.startInternal();
    return { seat, started: this.started, rejoined: false };
  }

  /** 房间摘要（供房间列表） */
  info(): { id: string; humans: number; ais: number; started: boolean } {
    const members = [...this.members.values()];
    return {
      id: this.id,
      humans: members.filter((m) => !m.isAI).length,
      ais: members.filter((m) => m.isAI).length,
      started: this.started,
    };
  }

  /** 房主：用当前人数开局（剩余空位自动补 AI） */
  requestStart(bySeat: number): boolean {
    if (this.started || bySeat !== this.hostSeat || this.members.size === 0) return false;
    this.startInternal();
    return true;
  }

  /** 房主：添加一个 AI 占位 */
  addAI(bySeat: number): boolean {
    if (this.started || bySeat !== this.hostSeat) return false;
    const seat = this.firstFreeSeat();
    if (seat < 0) return false;
    this.members.set(seat, {
      seat,
      name: `AI-${seat + 1}`,
      generalId: ALL_GENERALS[seat % ALL_GENERALS.length].id,
      isAI: true,
    });
    this.broadcastRoom();
    if (this.members.size >= 4) this.startInternal();
    return true;
  }

  disconnect(ws: WebSocket): void {
    const seat = this.sockets.get(ws);
    if (seat == null) return;
    this.sockets.delete(ws);
    const m = this.members.get(seat);
    if (m) {
      m.ws = undefined;
      if (this.started) m.isAI = true; // 断线后由 AI 托管
    }
    this.scheduleAI();
  }

  handle(ws: WebSocket, msg: { t?: string; action?: Action; seq?: number }): void {
    const seat = this.sockets.get(ws);
    if (seat == null) return;
    switch (msg.t) {
      case 'act':
        if (msg.action) this.act(seat, msg.action);
        break;
      case 'snapshot':
        this.sendSnapshot(seat);
        break;
      case 'start':
        this.requestStart(seat);
        break;
      case 'addAI':
        this.addAI(seat);
        break;
      case 'replay': {
        ws.send(JSON.stringify({ t: 'replay', replay: this.replay() }));
        break;
      }
    }
  }

  /** 广播房间成员状态（大厅显示人数/AI 数/开始按钮） */
  private broadcastRoom(): void {
    const members = [...this.members.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((m) => ({ seat: m.seat, name: m.name, isAI: m.isAI, generalId: m.generalId }));
    const info = JSON.stringify({ t: 'room', members, hostSeat: this.hostSeat, started: this.started });
    for (const m of this.members.values()) m.ws?.send(info);
  }

  act(seat: number, action: Action): void {
    if (!this.state || this.state.phase !== 'playing') return;
    const byPlayer =
      action.type === 'chii' ||
      action.type === 'pon' ||
      action.type === 'kan' ||
      action.type === 'ankan' ||
      action.type === 'kakan' ||
      action.type === 'ron';
    // 响应窗口（有打出的牌/被杠的牌）期间，只接受响应类动作，禁止抢跑摸打
    const inResponseWindow = !!(this.state.lastDiscard || this.state.pendingKakan);
    const isResponseAction =
      action.type === 'ron' ||
      action.type === 'pass' ||
      action.type === 'chii' ||
      action.type === 'pon' ||
      action.type === 'kan' ||
      action.type === 'kakan' ||
      action.type === 'ankan';
    if (inResponseWindow && !isResponseAction) return;
    if (byPlayer) {
      // 副露/荣和：声明者必须是动作发起人（防冒名）
      if ((action as { player: number }).player !== seat) return;
    } else if (action.type !== 'pass' && this.state.current !== seat) {
      return; // 未轮到的座位不能行动（pass 由服务器内部触发）
    }
    const res = step(this.state, action, { skillsOf: (s) => this.skillsOf(s) });
    if (!res.error) {
      // 只有被引擎接受的动作才录进回放
      this.currentActions.push({ seat, action });
    }
    this.state = res.state;
    this.broadcast(res.effects);
    if (res.state.phase === 'ended') {
      this.stopAI();
      this.scheduleNextRound();
    } else if (res.state.lastDiscard || res.state.pendingKakan) {
      this.scheduleResponse();
    } else {
      this.scheduleAI();
    }
  }

  // ---------- 私有 ----------

  private firstFreeSeat(): number {
    for (let seat = 0; seat < 4; seat++) {
      if (!this.members.has(seat)) return seat;
    }
    return -1;
  }

  private skillsOf(seat: number): Skill[] {
    const m = this.members.get(seat);
    return m ? (generalById(m.generalId)?.skills ?? []) : [];
  }

  private seatInfos(): SeatInfo[] {
    return [...this.members.keys()]
      .sort((a, b) => a - b)
      .map((seat) => {
        const m = this.members.get(seat)!;
        return {
          seat,
          name: m.name,
          generalId: m.generalId,
          isAI: m.isAI,
          score: this.state?.players[seat]?.score ?? 0,
        };
      });
  }

  private startInternal(): void {
    if (this.started) return;
    this.started = true;
    // 补 AI 位
    for (let seat = 0; seat < 4; seat++) {
      if (!this.members.has(seat)) {
        this.members.set(seat, {
          seat,
          name: `AI-${seat + 1}`,
          generalId: ALL_GENERALS[seat % ALL_GENERALS.length].id,
          isAI: true,
        });
      }
    }
    const configs: SeatConfig[] = [0, 1, 2, 3].map((seat) => {
      const m = this.members.get(seat)!;
      return { name: m.name, generalId: m.generalId, isAI: m.isAI };
    });
    this.state = createGame(configs, { seed: this.seed, rules: this.rules });
    // 录像：记录开局元信息与首局起点
    this.meta = { seats: configs, rules: this.rules, seed: this.seed };
    this.rounds = [];
    this.currentActions = [];
    this.roundStart = { round: this.state.round, dealer: this.state.dealer };
    this.broadcastRoom(); // 通知全房间：已开局（含成员/AI 情况）

    const effects: GameEffect[] = [
      { type: 'gameStarted', round: this.state.round, seats: this.seatInfos() },
    ];
    for (const p of this.state.players) {
      effects.push({ type: 'hand', player: p.seat, tiles: [...p.hand], targetSeat: p.seat });
    }
    this.broadcast(effects);
    this.scheduleAI();
  }

  /** 按 targetSeat 过滤 + 单播/广播；私有信息（手牌）绝不发给其他座位 */
  private broadcast(effects: GameEffect[]): void {
    if (!this.state) return;
    for (const effect of effects) {
      const targets: RoomMember[] =
        'targetSeat' in effect && effect.targetSeat != null
          ? this.members.has(effect.targetSeat)
            ? [this.members.get(effect.targetSeat)!]
            : []
          : [...this.members.values()];
      for (const m of targets) {
        if (!m.ws) continue;
        m.ws.send(
          JSON.stringify({
            t: 'events',
            effects: [effect],
            revision: this.state.version,
          }),
        );
      }
    }
  }

  /** 快照：把自己手牌以外的牌全部打码（断线重连用） */
  private sendSnapshot(seat: number): void {
    if (!this.state) return;
    const s = structuredClone(this.state) as GameState;
    for (const p of s.players) {
      if (p.seat !== seat) p.hand = p.hand.map(() => -1);
    }
    s.wall = [];
    const m = this.members.get(seat);
    m?.ws?.send(JSON.stringify({ t: 'snapshot', state: s }));
  }

  private scheduleAI(): void {
    if (!this.state || this.state.phase !== 'playing') return;
    const seat = this.state.current;
    const m = this.members.get(seat);
    if (m?.isAI) {
      clearTimeout(this.aiTimer);
      this.aiTimer = setTimeout(() => {
        if (!this.state || this.state.phase !== 'playing') return;
        for (const action of aiPlan(this.state, seat)) {
          if (!this.state || this.state.phase !== 'playing') break;
          this.act(seat, action);
        }
      }, 200);
    }
  }

  /** 响应窗口：AI 抢先荣和，否则延迟关闭窗口（有真人可和时等更久，给玩家操作时间） */
  private scheduleResponse(): void {
    clearTimeout(this.ronTimer);
    if (!this.state) return;
    const src = this.state.pendingKakan ?? this.state.lastDiscard;
    if (!src) return;
    let humanCanRon = false;
    for (const [seat, m] of this.members) {
      const ok = canRon(this.state, seat, src.tile, src.player).ok;
      if (!ok) continue;
      if (m.isAI) {
        this.act(seat, { type: 'ron', player: seat, tile: src.tile, from: src.player });
        return;
      }
      humanCanRon = true;
    }
    const delay = humanCanRon ? 5000 : 400; // 真人可和：留 5 秒操作时间
    const passSeat = this.state.current;
    this.ronTimer = setTimeout(() => {
      if (!this.state) return;
      if (this.state.lastDiscard || this.state.pendingKakan) this.act(passSeat, { type: 'pass' });
    }, delay);
  }

  /** 一局结束后自动开新局（连庄/进庄）；整场结束则不动作 */
  private scheduleNextRound(): void {
    // 归档本局录像
    if (this.roundStart && this.currentActions.length > 0) {
      this.rounds.push({ ...this.roundStart, actions: [...this.currentActions] });
    }
    this.currentActions = [];
    clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      if (!this.state) return;
      const next = advanceRound(this.state);
      if (next === this.state) return; // 整场结束
      this.state = next;
      this.roundStart = { round: next.round, dealer: next.dealer };
      const effects: GameEffect[] = [
        { type: 'gameStarted', round: next.round, seats: this.seatInfos() },
      ];
      for (const p of next.players) {
        effects.push({ type: 'hand', player: p.seat, tiles: [...p.hand], targetSeat: p.seat });
      }
      this.broadcast(effects);
      this.scheduleAI();
    }, 2000);
  }

  /** 获取回放数据（含已结束的局与进行中的局） */
  replay(): ReplayData | null {
    if (!this.meta) return null;
    const rounds = [...this.rounds];
    if (this.roundStart && this.currentActions.length > 0) {
      rounds.push({ ...this.roundStart, actions: [...this.currentActions] });
    }
    return {
      id: `${this.id}-${Date.now()}`,
      roomId: this.id,
      createdAt: Date.now(),
      ...this.meta,
      rounds,
    };
  }

  private stopAI(): void {
    clearTimeout(this.aiTimer);
    clearTimeout(this.ronTimer);
  }
}
