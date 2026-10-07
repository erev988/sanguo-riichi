import { ClientMsgSchema, PROTOCOL_VERSION } from '@sanguo/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { Room } from './room';

// ============================================================================
// 权威服务器：只做房间管理 + 消息路由，规则判定全部在 core 引擎里
// ============================================================================

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({
  port: PORT,
  host: '0.0.0.0',
  maxPayload: 64 * 1024, // 限制单帧 64KB（默认 100MB，巨型 JSON 可拖垮进程）
});
const rooms = new Map<string, Room>();
/** 连接 → 房间号绑定：act/snapshot/clientSeed 只在该房间执行
 *  （此前遍历所有房间调用，同一连接可同时作用于多个房间，pass 会在每个房间关窗） */
const connRoom = new Map<WebSocket, string>();

// ---------- 真人匹配队列（仅真人，不补 AI；凑满 4 人自动开局） ----------
interface Waiting {
  ws: WebSocket;
  name: string;
  generalId: string;
}
const matchQueue: Waiting[] = [];

function broadcastMatching(): void {
  const payload = JSON.stringify({ t: 'matching', waiting: matchQueue.length });
  for (const w of matchQueue) {
    try {
      w.ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

function dequeueMatch(ws: WebSocket): void {
  const i = matchQueue.findIndex((w) => w.ws === ws);
  if (i >= 0) matchQueue.splice(i, 1);
  // 回执：该连接已出队，但仍需知道当前队列状态（客户端据此恢复按钮）
  try {
    ws.send(JSON.stringify({ t: 'matching', waiting: matchQueue.length }));
  } catch {
    /* ignore */
  }
  broadcastMatching();
}

function enqueueMatch(ws: WebSocket, name: string, generalId: string): void {
  if (!matchQueue.some((w) => w.ws === ws)) matchQueue.push({ ws, name, generalId });
  broadcastMatching();
  tryMatch();
}

function tryMatch(): void {
  while (matchQueue.length >= 4) {
    const group = matchQueue.splice(0, 4);
    const roomId = `match-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const room = new Room(roomId, `${randomBytes(32).toString('hex')}:${randomBytes(16).toString('hex')}`);
    rooms.set(roomId, room);
    // ★ 先全部入座（不触发开局），统一发 welcome，最后再 startInternal
    //   否则第 4 人会先收到 gameStarted、后收到 welcome（座位未知，界面短暂错乱）
    group.forEach((w) => {
      try {
        const { seat, started, token } = room.join(
          w.ws, w.name, w.generalId, undefined, undefined, undefined, { deferStart: true },
        );
        connRoom.set(w.ws, roomId);
        w.ws.send(
          JSON.stringify({
            t: 'welcome',
            roomId,
            seat,
            started,
            protocolVersion: PROTOCOL_VERSION,
            rules: room.rules,
            token, // 服务器下发的会话令牌（复座用）
          }),
        );
      } catch {
        /* ignore */
      }
    });
    room.startNow(); // 4 名真人已入座 → 现在开局（消息顺序：welcome → gameStarted）
  }
  broadcastMatching();
}

// 房间回收：定期清理空房/全离线房（此前 rooms 只增不减，终局房永久驻留内存；
// 打错房名产生的空房也会在这里被收走）
setInterval(() => {
  for (const [id, room] of rooms) {
    if (room.canDispose()) rooms.delete(id);
  }
}, 60_000).unref();

wss.on('connection', (ws: WebSocket) => {
  // 简单限流：每条连接每秒最多 40 条消息（act/snapshot spam 会放大广播成本）
  let msgCount = 0;
  const rateTimer = setInterval(() => {
    msgCount = 0;
  }, 1000);
  rateTimer.unref?.();

  ws.on('message', (raw) => {
    if (++msgCount > 40) return; // 超限直接丢弃
    try {
      // zod 运行时校验（防篡改/畸形消息）
      const parsed = ClientMsgSchema.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) {
        ws.send(JSON.stringify({ t: 'error', code: 'bad-message' }));
        return;
      }
      const msg = parsed.data;

      if (msg.t === 'join') {
        const { roomId, name, generalId, rules, token, password } = msg.payload;
        let room = rooms.get(roomId);
        if (!room) {
          // 输入房号即开房（打错房名产生的空房由定期回收 + 列表过滤兜住）
          room = new Room(roomId, `${randomBytes(32).toString("hex")}:${randomBytes(16).toString("hex")}`);
          rooms.set(roomId, room);
        }
        try {
          const { seat, started, rejoined, token: newToken } = room.join(ws, name, generalId, rules, token, password);
          connRoom.set(ws, roomId);
          ws.send(
            JSON.stringify({
              t: 'welcome',
              roomId,
              seat,
              started,
              protocolVersion: PROTOCOL_VERSION,
              rules: room.rules, // 房间规则（房主指定，含切上满贯等）
              rejoined,
              token: newToken, // 复座后换发的令牌
            }),
          );
        } catch (e) {
          const code = (e as Error).message === 'wrong-password' ? 'wrong-password' : 'join-failed';
          ws.send(JSON.stringify({ t: 'error', code }));
        }
      } else if (msg.t === 'create') {
        const { roomId, name, generalId, password, rules } = msg.payload;
        if (rooms.has(roomId)) {
          ws.send(JSON.stringify({ t: 'error', code: 'room-exists' }));
          return;
        }
        const room = new Room(roomId, `${randomBytes(32).toString('hex')}:${randomBytes(16).toString('hex')}`);
        rooms.set(roomId, room);
        const { seat, started } = room.join(ws, name, generalId, rules, undefined, password);
        ws.send(
          JSON.stringify({
            t: 'welcome',
            roomId,
            seat,
            started,
            protocolVersion: PROTOCOL_VERSION,
            rules: room.rules,
            created: true,
          }),
        );
      } else if (msg.t === 'rooms') {
        // 只列出有人的房间（打错房名产生的空房不污染大厅）
        ws.send(
          JSON.stringify({
            t: 'rooms',
            rooms: [...rooms.values()]
              .filter((r) => {
                const i = r.info();
                return i.humans + i.ais > 0;
              })
              .map((r) => r.info()),
          }),
        );
      } else if (msg.t === 'match') {
        enqueueMatch(ws, (msg as { name: string }).name, (msg as { generalId: string }).generalId);
      } else if (msg.t === 'clientSeed') {
        const bound = connRoom.get(ws);
        const r = bound ? rooms.get(bound) : undefined;
        if (r) r.handleClientSeed(ws, (msg as { seed: string }).seed);
      } else if (msg.t === 'cancelMatch') {
        dequeueMatch(ws);
      } else if (msg.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong' }));
      } else {
        for (const room of rooms.values()) {
          room.handle(ws, msg);
        }
      }
    } catch {
      ws.send(JSON.stringify({ t: 'error', code: 'bad-message' }));
    }
  });

  ws.on('close', () => {
    dequeueMatch(ws); // 匹配中断线 → 出队
    const bound = connRoom.get(ws);
    connRoom.delete(ws);
    const r = bound ? rooms.get(bound) : undefined;
    if (r) r.disconnect(ws);
    else for (const room of rooms.values()) room.disconnect(ws); // 兜底
  });
});

console.log(`[sanguo-server] ws listening on ws://0.0.0.0:${PORT}`);
