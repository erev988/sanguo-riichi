import { ClientMsgSchema, PROTOCOL_VERSION } from '@sanguo/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { Room } from './room';

// ============================================================================
// 权威服务器：只做房间管理 + 消息路由，规则判定全部在 core 引擎里
// ============================================================================

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
const rooms = new Map<string, Room>();

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
    const roomId = `match-${Date.now().toString(36)}`;
    const room = new Room(roomId, `${randomBytes(32).toString('hex')}:${randomBytes(16).toString('hex')}`);
    rooms.set(roomId, room);
    group.forEach((w) => {
      try {
        // 第 4 个人入座即触发开局（4 名真人，不补 AI）
        const { seat, started, token } = room.join(w.ws, w.name, w.generalId);
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
  }
  broadcastMatching();
}

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    try {
      // zod 运行时校验（防篡改/畸形消息）
      const parsed = ClientMsgSchema.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) {
        ws.send(JSON.stringify({ t: 'error', code: 'bad-message' }));
        return;
      }
      const msg = parsed.data;

      if (msg.t === 'join') {        const { roomId, name, generalId, rules, token, password } = msg.payload;
        let room = rooms.get(roomId);
        if (!room) {
          room = new Room(roomId, `${randomBytes(32).toString('hex')}:${randomBytes(16).toString('hex')}`);
          rooms.set(roomId, room);
        }
        try {
          const { seat, started, rejoined, token: newToken } = room.join(ws, name, generalId, rules, token, password);
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
        ws.send(JSON.stringify({ t: 'rooms', rooms: [...rooms.values()].map((r) => r.info()) }));
      } else if (msg.t === 'match') {
        enqueueMatch(ws, (msg as { name: string }).name, (msg as { generalId: string }).generalId);
      } else if (msg.t === 'clientSeed') {
        for (const room of rooms.values()) room.handleClientSeed(ws, (msg as { seed: string }).seed);
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
    for (const room of rooms.values()) room.disconnect(ws);
  });
});

console.log(`[sanguo-server] ws listening on ws://0.0.0.0:${PORT}`);
