import { createRequire } from "node:module";

/**
 * Counts WebSocket frames on the wire for the soak harness (D-036). Both ends live in one process, so the two prototypes are patched: the SERVER's `ws` sockets
 * (`_isServer`, the frames the room sends = DOWN) and the bots' native `WebSocket` (the frames a client sends = UP). Counting only inside `measure(true)`.
 * Frames are counted at `send`, before the kernel: payload bytes, no TCP/IP or WebSocket header overhead (add ~6-10 bytes per frame for the latter).
 */
export class WireCounter {
  downBytes = 0;
  downFrames = 0;
  upBytes = 0;
  upFrames = 0;
  private on = false;
  private restore: (() => void)[] = [];

  measure(on: boolean): void {
    this.on = on;
  }

  reset(): void {
    this.downBytes = this.downFrames = this.upBytes = this.upFrames = 0;
  }

  install(): void {
    if (this.restore.length) return;
    const require = createRequire(import.meta.url);
    const WS = (require("ws") as { WebSocket: { prototype: { send: (...a: unknown[]) => unknown } } }).WebSocket;
    const serverSend = WS.prototype.send;
    const self = this;
    WS.prototype.send = function (this: { _isServer?: boolean }, data: unknown, ...rest: unknown[]) {
      if (self.on && this._isServer) {
        self.downFrames++;
        self.downBytes += sizeOf(data);
      }
      return serverSend.call(this, data, ...rest);
    };
    this.restore.push(() => (WS.prototype.send = serverSend));
    const Native = (globalThis as { WebSocket?: { prototype: { send: (...a: unknown[]) => unknown } } }).WebSocket;
    if (Native) {
      const clientSend = Native.prototype.send;
      Native.prototype.send = function (this: unknown, data: unknown, ...rest: unknown[]) {
        if (self.on) {
          self.upFrames++;
          self.upBytes += sizeOf(data);
        }
        return clientSend.call(this, data, ...rest);
      };
      this.restore.push(() => (Native.prototype.send = clientSend));
    }
  }

  uninstall(): void {
    for (const r of this.restore.reverse()) r();
    this.restore = [];
  }
}

function sizeOf(data: unknown): number {
  if (typeof data === "string") return Buffer.byteLength(data);
  const d = data as { byteLength?: number; size?: number };
  return d.byteLength ?? d.size ?? 0;
}
