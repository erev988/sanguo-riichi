import type { ClientMsg, ServerMsg } from '@sanguo/shared';

/**
 * WebSocket 客户端封装：
 * - 断线自动重连（指数退避，最多间隔 8s）
 * - 每次（重）连接成功都会触发 onOpen，调用方可据此重发 join（带 token 恢复座位）
 */
export class Net {
  private ws?: WebSocket;
  private url = '';
  private retries = 0;
  private closedByUser = false;
  seq = 0;

  /** 每次（重）连接成功 */
  onOpen?: () => void;
  onClose?: () => void;
  onMsg?: (msg: ServerMsg) => void;
  /** 正在重连（attempt 从 1 开始） */
  onReconnecting?: (attempt: number, delayMs: number) => void;

  connect(url: string): void {
    this.url = url;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.retries = 0;
      this.onOpen?.();
    };
    this.ws.onclose = () => {
      this.onClose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    };
    this.ws.onmessage = (e) => {
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
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, delay);
  }

  send(msg: ClientMsg): void {
    this.ws?.send(JSON.stringify(msg));
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }
}
