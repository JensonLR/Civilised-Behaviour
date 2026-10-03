import { createConnection, createServer, type Server, type Socket } from "node:net";

/**
 * A bad network between a bot and the server (release gate 13, "bad-network run"): a TCP relay that holds every chunk for a one-way delay plus seeded jitter, and now and then
 * stalls the whole stream (what a lost segment and its retransmit look like to the application above TCP: nothing is dropped, everything behind it waits). Byte order is kept
 * per direction (a chunk is never released before the one ahead of it), as TCP keeps it. Colyseus's `simulateLatency` only adds a fixed delay to server sends; this one has
 * jitter, stalls and both directions. Test tooling only: nothing in the game imports it.
 */
export interface BadNetOptions {
  /** One-way base delay per direction, ms. */
  delayMs: number;
  /** Uniform extra delay 0..jitterMs per chunk, ms. */
  jitterMs: number;
  /** Chance per chunk that the stream stalls behind it (a lost segment), 0..1. */
  stallP: number;
  /** How long a stall holds the stream, ms (about a retransmit timeout). */
  stallMs: number;
  seed: number;
}

export interface BadNet {
  port: number;
  stats(): { chunks: number; stalls: number; maxHoldMs: number };
  close(): Promise<void>;
}

/** mulberry32: a seeded uniform 0..1 (test tooling; the game's own randomness is `Rng`). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Release time for the next chunk of one direction: never before the one ahead of it (TCP's order), plus a stall behind it now and then. Pure apart from `rand`. */
export function releaseAt(now: number, last: number, o: BadNetOptions, rand: () => number): { at: number; stalled: boolean } {
  const stalled = o.stallP > 0 && rand() < o.stallP;
  const at = Math.max(last, now + o.delayMs + rand() * o.jitterMs + (stalled ? o.stallMs : 0));
  return { at, stalled };
}

export function startBadNet(listenPort: number, targetPort: number, o: BadNetOptions): Promise<BadNet> {
  const rand = rng(o.seed);
  let chunks = 0, stalls = 0, maxHoldMs = 0;
  const sockets = new Set<Socket>();
  const pipe = (from: Socket, to: Socket): void => {
    let last = 0;
    // ONE queue per direction, drained in order by one timer: a timer per chunk (the first cut) reordered chunks due within the same millisecond, because Node orders
    // timers only to the millisecond (CI caught "...008006007..."), and TCP never reorders
    const queue: { at: number; buf: Buffer }[] = [];
    let timer: NodeJS.Timeout | undefined;
    let closed = false;
    const drain = (): void => {
      timer = undefined;
      const now = Date.now();
      while (queue.length && queue[0]!.at <= now) {
        const q = queue.shift()!;
        if (!to.destroyed) to.write(q.buf);
      }
      if (queue.length) timer = setTimeout(drain, Math.max(1, Math.ceil(queue[0]!.at - now)));
      else if (closed) to.destroy();
    };
    from.on("data", (buf: Buffer) => {
      const now = Date.now();
      const r = releaseAt(now, last, o, rand);
      last = r.at;
      chunks++;
      if (r.stalled) stalls++;
      maxHoldMs = Math.max(maxHoldMs, r.at - now);
      queue.push({ at: r.at, buf });
      timer ??= setTimeout(drain, Math.max(1, Math.ceil(queue[0]!.at - now)));
    });
    from.on("close", () => {
      closed = true;
      if (!queue.length && !timer) to.destroy();
    });
    from.on("error", () => to.destroy());
  };
  const server: Server = createServer((client) => {
    const upstream = createConnection({ host: "127.0.0.1", port: targetPort });
    sockets.add(client).add(upstream);
    client.on("close", () => sockets.delete(client));
    upstream.on("close", () => sockets.delete(upstream));
    pipe(client, upstream);
    pipe(upstream, client);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => {
      resolve({
        port: (server.address() as { port: number }).port,   // (listenPort 0: the OS's pick)
        stats: () => ({ chunks, stalls, maxHoldMs: Math.round(maxHoldMs) }),
        close: () => new Promise<void>((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}
