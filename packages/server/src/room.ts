import {
  ALL_GENERALS,
  advanceRound,
  aiPlan,
  canRon,
  createGame,
  generalById,
  legalActions,
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
  /** 房间密码（房主设置；空串表示无密码） */
  private password = '';
  // ---- 录像：记录动作序列即可完整重放（引擎为纯函数） ----
  private meta?: { seats: SeatConfig[]; rules: Rules; seed: number };
  private rounds: ReplayRound[] = [];
  private currentActions: { seat: number; action: Action }[] = [];
  private roundStart?: { round: RoundInfo; dealer: number };
  private aiTimer?: ReturnType<typeof setTimeout>;
  private drawTimer?: ReturnType<typeof setTimeout>;
  private thinkTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** 各座位当前决策点的计时截止时间（用于防止点击按钮重置计时） */
  private thinkDeadline = new Map<number, number>();
  /** 本局内已超时过的座位：之后思考时限改为 10s（新局重置） */
  private timedOutPlayers = new Set<number>();
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
    password?: string,
  ): { seat: number; started: boolean; rejoined: boolean } {
    // 断线重连：token 命中 → 恢复原座位（免密码）
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

    if (this.started) throw new Error('started');
    if (this.hostSeat >= 0 && this.password && password !== this.password) {
      throw new Error('wrong-password'); // 房间密码不匹配
    }
    if (this.hostSeat < 0) {
      this.hostSeat = this.firstFreeSeat();
      this.rules = resolveRules(rules); // 房主规则
      this.password = password ?? ''; // 房主设置密码
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
  info(): { id: string; humans: number; ais: number; started: boolean; locked: boolean } {
    const members = [...this.members.values()];
    return {
      id: this.id,
      humans: members.filter((m) => !m.isAI).length,
      ais: members.filter((m) => m.isAI).length,
      started: this.started,
      locked: this.password.length > 0,
    };
  }

  /** 房主：用当前人数开局（剩余空位自动补 AI） */
  requestStart(bySeat: number): boolean {
    if (this.started || bySeat !== this.hostSeat || this.members.size === 0) return false;
    this.startInternal();
    return true;
  }

  /** 匹配成功后由服务器直接开局（无需房主点击） */
  startNow(): void {
    if (!this.started) this.startInternal();
  }

  /** 未开局时更换武将（入座后在大厅选将） */
  setGeneral(seat: number, generalId: string): boolean {
    if (this.started) return false;
    const m = this.members.get(seat);
    const g = generalById(generalId);
    if (!m || !g) return false;
    m.generalId = g.id;
    this.broadcastRoom();
    return true;
  }

  /** 房主：添加一个 AI 占位（武将随机） */  addAI(bySeat: number): boolean {
    if (this.started || bySeat !== this.hostSeat) return false;
    const seat = this.firstFreeSeat();
    if (seat < 0) return false;
    this.members.set(seat, {
      seat,
      name: `AI-${seat + 1}`,
      generalId: ALL_GENERALS[Math.floor(Math.random() * ALL_GENERALS.length)].id,
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
      case 'pickGeneral': {
        const gid = (msg as { generalId?: string }).generalId;
        if (gid) this.setGeneral(seat, gid);
        break;
      }
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
    this.broadcastOptions(); // 下发各座位当前可选动作（吃/碰/杠/荣和/自摸…）
  }

  /** 单播给某座位（私有信息） */
  private sendTo(seat: number, effect: GameEffect): void {
    const m = this.members.get(seat);
    m?.ws?.send(
      JSON.stringify({ t: 'events', effects: [effect], revision: this.state?.version ?? 0 }),
    );
  }

  /**
   * 思考时限：默认 25s + 10s 补时（35s）；一旦该玩家超时过，本局内之后只用 10s。
   * 同一决策点内不因点击而重置（防刷时间）。
   */
  private startThinkTimer(seat: number): void {
    const now = Date.now();
    const existing = this.thinkDeadline.get(seat);
    if (existing != null && existing > now) return; // 该决策点已在计时 → 保持剩余时间
    this.clearThinkTimer(seat);
    const TOTAL = this.timedOutPlayers.has(seat) ? 10_000 : 35_000;
    const deadline = now + TOTAL;
    this.thinkDeadline.set(seat, deadline);
    this.sendTo(seat, { type: 'timer', seat, ms: TOTAL, total: TOTAL, targetSeat: seat });
    const t = setTimeout(() => {
      this.thinkTimers.delete(seat);
      this.thinkDeadline.delete(seat);
      this.timedOutPlayers.add(seat); // 记下：该玩家已超时，之后只用 10s
      if (!this.state || this.state.phase !== 'playing') return;
      const st = this.state;
      if (st.lastDiscard || st.pendingKakan) {
        this.act(seat, { type: 'pass' }); // 响应窗口：自动过
      } else if (st.current === seat && st.awaiting === 'discard') {
        const p = st.players[seat];
        const tile = p.hand[p.hand.length - 1]; // 自动摸切（打出刚摸的牌）
        if (tile != null) this.act(seat, { type: 'discard', tile });
      }
    }, TOTAL);
    this.thinkTimers.set(seat, t);
  }

  private clearThinkTimer(seat?: number): void {
    if (seat == null) {
      for (const t of this.thinkTimers.values()) clearTimeout(t);
      this.thinkTimers.clear();
      this.thinkDeadline.clear();
      return;
    }
    const t = this.thinkTimers.get(seat);
    if (t) clearTimeout(t);
    this.thinkTimers.delete(seat);
    this.thinkDeadline.delete(seat);
  }

  /** 给每位真人单播其当前可执行动作（AI 不需要）；需要决策的座位起思考计时 */
  private broadcastOptions(): void {
    if (!this.state || this.state.phase !== 'playing') return;
    const st = this.state;
    const all = legalActions(st);
    const discarder = st.lastDiscard?.player ?? st.pendingKakan?.player ?? -1;
    const hasWindow = !!(st.lastDiscard || st.pendingKakan);
    for (let seat = 0; seat < 4; seat++) {
      const m = this.members.get(seat);
      if (!m || m.isAI) continue;
      const acts = all.filter((a) => {
        // 打牌由"点手牌"完成、摸牌自动 —— 不下发这两类
        if (a.type === 'discard' || a.type === 'draw') return false;
        // 「过」属于响应窗口内的所有非打牌者（否则碰/吃的人收不到"过"）
        if (a.type === 'pass') return hasWindow && seat !== discarder;
        const p = (a as { player?: number }).player;
        if (p != null) return p === seat; // 副露/荣和：声明者自己
        return seat === st.current; // 自摸/九种九牌：当前行动者
      });
      if (acts.length > 0) {
        m.ws?.send(
          JSON.stringify({
            t: 'events',
            effects: [{ type: 'options', actions: acts, targetSeat: seat }],
            revision: st.version,
          }),
        );
      }
      // 需要决策（有按钮）或需要打牌 → 起思考计时
      const needsThink =
        acts.length > 0 ||
        (st.awaiting === 'discard' && st.current === seat && !st.lastDiscard && !st.pendingKakan);
      if (needsThink) this.startThinkTimer(seat);
      else this.clearThinkTimer(seat);
    }
  }

  /** 真人自动摸牌（留一点时间给「九种九牌」等操作） */
  private maybeAutoDraw(seat: number): void {
    if (!this.state || this.state.awaiting !== 'draw') return;
    if (this.state.lastDiscard || this.state.pendingKakan) return;
    clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => {
      if (!this.state || this.state.phase !== 'playing') return;
      if (this.state.awaiting !== 'draw' || this.state.current !== seat) return;
      if (this.state.lastDiscard || this.state.pendingKakan) return;
      this.act(seat, { type: 'draw' });
    }, 450);
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
    // 补 AI 位（武将随机分配）
    for (let seat = 0; seat < 4; seat++) {
      if (!this.members.has(seat)) {
        this.members.set(seat, {
          seat,
          name: `AI-${seat + 1}`,
          generalId: ALL_GENERALS[Math.floor(Math.random() * ALL_GENERALS.length)].id,
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
    this.timedOutPlayers.clear(); // 新局：重置超时标记
    this.broadcastRoom(); // 通知全房间：已开局（含成员/AI 情况）

    const effects: GameEffect[] = [
      { type: 'gameStarted', round: this.state.round, dealer: this.state.dealer, seats: this.seatInfos() },
      { type: 'dora', indicators: this.state.doraIndicators.slice(0, this.state.doraCount) },
      { type: 'wall', count: this.state.wall.length },
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
    // 牌山打码为占位（保留张数信息，不泄露内容）
    s.wall = s.wall.map(() => -1);
    s.rinshanWall = s.rinshanWall.map(() => -1);
    const m = this.members.get(seat);
    m?.ws?.send(JSON.stringify({ t: 'snapshot', state: s }));
    // 快照之后补发当前可选项（断线重连/从后台返回时不会错过 options 广播）
    this.broadcastOptions();
  }

  private scheduleAI(): void {
    if (!this.state || this.state.phase !== 'playing') return;
    const seat = this.state.current;
    const m = this.members.get(seat);
    if (!m) return;
    if (!m.isAI) {
      this.maybeAutoDraw(seat); // 真人：自动摸牌
      return;
    }
    if (m.isAI) {
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

  /** 响应窗口：AI 抢先荣和；真人若可"实质动作"则等其思考时限（35s），否则短暂延时关闭 */
  private scheduleResponse(): void {
    clearTimeout(this.ronTimer);
    if (!this.state) return;
    const st = this.state;
    const src = st.pendingKakan ?? st.lastDiscard;
    if (!src) return;

    let humanCanAct = false;
    for (const [seat, m] of this.members) {
      if (m.isAI) {
        if (canRon(st, seat, src.tile, src.player).ok) {
          this.act(seat, { type: 'ron', player: seat, tile: src.tile, from: src.player });
          return; // AI 抢和
        }
        continue;
      }
      // 真人：是否有"实质动作"（吃/碰/杠/荣和）——有则等满思考时限（按钮一直可点）
      const real = legalActions(st).some((a) => {
        const p = (a as { player?: number }).player;
        if (p !== seat) return false;
        return a.type === 'chii' || a.type === 'pon' || a.type === 'kan' || a.type === 'ron';
      });
      if (real) humanCanAct = true;
    }
    if (humanCanAct) return; // 交给 thinkTimer（超时自动"过"）

    // 无人可动作（只能过）→ 短暂延时后关闭窗口，避免每手都等 35 秒
    const passSeat = st.current;
    this.ronTimer = setTimeout(() => {
      if (!this.state) return;
      if (this.state.lastDiscard || this.state.pendingKakan) this.act(passSeat, { type: 'pass' });
    }, 400);
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
      this.timedOutPlayers.clear(); // 新局：重置超时标记
      const effects: GameEffect[] = [
        { type: 'gameStarted', round: next.round, dealer: next.dealer, seats: this.seatInfos() },
        { type: 'dora', indicators: next.doraIndicators.slice(0, next.doraCount) },
        { type: 'wall', count: next.wall.length },
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
    clearTimeout(this.drawTimer);
    this.clearThinkTimer();
  }
}
