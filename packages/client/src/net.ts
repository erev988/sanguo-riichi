import type { ClientMsg, ServerMsg } from '@sanguo/shared';

/**
 * WebSocket 客户端封装：
 * - 断线自动重连（指数退避，最多间隔 8s）
 * - **socket 排他**：任何时刻只保留一个活连接（旧连接彻底解绑后再建新的），
 *   否则多个活 socket 共用同一 token 会互相顶座、无限互踢（切后台/回前台最常见）
 * - **心跳**：定期 ping，让半开连接（移动端切后台）能被及时发现并触发重连
 * - 每次（重）连接成功都会触发 onOpen，调用方可据此重发 join（带 token 恢复座位）
 */
export class Net {
  private ws?: WebSocket;
  private url = '';
  private retries = 0;
  private closedByUser = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  seq = 0;

  /** 每次（重）连接成功 */
  onOpen?: () => void;
  onClose?: () => void;
  onMsg?: (msg: ServerMsg) => void;
  /** 正在重连（attempt 从 1 开始） */
  onReconnecting?: (attempt: number, delayMs: number) => void;

  /** 当前是否处于已连接状态 */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string): void {
    this.url = url;
    this.closedByUser = false;
    this.retries = 0;
    this.open();
  }

  private open(): void {
    // ★ 排他：先彻底解绑并关闭旧 socket，并取消排队中的重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const prev = this.ws;
    if (prev) {
      prev.onopen = null;
      prev.onclose = null;
      prev.onmessage = null;
      prev.onerror = null;
      try {
        prev.close();
      } catch {
        /* ignore */
      }
      this.ws = undefined;
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return; // 已被新连接取代，忽略迟到回调
      this.retries = 0;
      this.startHeartbeat();
      this.onOpen?.();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // ★ 旧 socket 的 close 不得触发重连（否则互踢）
      this.stopHeartbeat();
      this.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      try {
        this.onMsg?.(JSON.parse(e.data as string) as ServerMsg);
      } catch {
        /* 忽略畸形消息 */
      }
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.retries, 8000);
    this.retries++;
    this.onReconnecting?.(this.retries, delay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  /** 心跳：20s 一次 ping（服务端回 pong），半开连接由此暴露 */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'ping' });
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  send(msg: ClientMsg): void {
    // readyState 守卫：CONNECTING 时 send 会抛异常，CLOSED 时会静默丢消息
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
