import { ClientMsgSchema, PROTOCOL_VERSION } from '@sanguo/shared';
import { WebSocket, WebSocketServer } from 'ws';
import { Room } from './room';

// ============================================================================
// 权威服务器：只做房间管理 + 消息路由，规则判定全部在 core 引擎里
// ============================================================================

const PORT = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });
const rooms = new Map<string, Room>();

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

      if (msg.t === 'join') {
        const { roomId, name, generalId, rules, token, password } = msg.payload;
        let room = rooms.get(roomId);
        if (!room) {
          room = new Room(roomId, Math.floor(Math.random() * 2 ** 31));
          rooms.set(roomId, room);
        }
        try {
          const { seat, started, rejoined } = room.join(ws, name, generalId, rules, token, password);
          ws.send(
            JSON.stringify({
              t: 'welcome',
              roomId,
              seat,
              started,
              protocolVersion: PROTOCOL_VERSION,
              rules: room.rules, // 房间规则（房主指定，含切上满贯等）
              rejoined,
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
        const room = new Room(roomId, Math.floor(Math.random() * 2 ** 31));
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
    for (const room of rooms.values()) room.disconnect(ws);
  });
});

console.log(`[sanguo-server] ws listening on ws://0.0.0.0:${PORT}`);
