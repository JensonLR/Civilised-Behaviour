import type { Room } from "@colyseus/sdk";
import type { RegionId } from "@cb/shared";
import type { Bot } from "./Bot.ts";

/** The travel fields of the room state (WorldState gains them in the integration step; read structurally so this compiles either way). */
interface TravelFields {
  region: string;
  travelPhase: number;
  travelTo: string;
  travelReady: number;
}

const fields = (room: Room): TravelFields => room.state as unknown as TravelFields;

async function until(what: string, test: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (!test()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

export interface SailOptions {
  /** Hold `regionReady` back this long after arriving (a slow client building the new world). */
  buildMs?: number;
  /** Do not propose: join the vote someone else opened. */
  join?: boolean;
  /** Give up after this long (default 40 s: the sailing is ~6 s, the arrival window 30 s). */
  timeoutMs?: number;
}

/**
 * Sails a bot to `to` the way the client does: propose (or join the open vote), say yes, wait for the new region to come up, build it (here: wait
 * `buildMs`), send `regionReady`, wait for the room to return to idle. Resolves when everyone is ashore.
 */
export async function sail(bot: Bot, to: RegionId, opts: SailOptions = {}): Promise<void> {
  const room = bot.room;
  const limit = opts.timeoutMs ?? 40_000;
  if (!opts.join) room.send("travelPropose", { to });
  await until("the vote to open", () => fields(room).travelPhase >= 1 || fields(room).region === to, 5_000);
  if (fields(room).travelPhase === 1) room.send("travelReady", { ready: true });
  await until(`the room to arrive in ${to}`, () => fields(room).region === to && fields(room).travelPhase === 3, limit);
  if (opts.buildMs) await new Promise((r) => setTimeout(r, opts.buildMs));
  room.send("regionReady", { region: to });
  await until("everyone to come ashore", () => fields(room).travelPhase === 0, limit);
}
