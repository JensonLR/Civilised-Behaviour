import { BUTTON, FLAG, NPC_SIDE, WEAPON, regionMountSpots, type RegionId } from "@cb/shared";
import { aimAt, type Behaviour, type BotFrame } from "../Bot.ts";

/**
 * What a soak bot does (D-036, package Q): a loop of PATROL, SKIRMISH and RIDE that walks, shoots and rides through the same input path a player uses, so the rooms
 * carry what four people cost: movement every tick, combat against the garrison, a mount's extra step. Positions are never teleported (a teleport reads as a netcode
 * correction): the bots WALK to where the next phase happens. Pure function of the bot's own tick, its slot and what it can see (no Math.random: hash-free, deterministic).
 *
 *   t in cycle   0..15 s   patrol: a circuit round where the bot arrived
 *               15..45 s   skirmish (fights only): walk to the south bank, shoot the nearest hostile row (rifle); without a fight, keep patrolling
 *               45..65 s   ride: walk to the first horse, mount (INTERACT), gallop in circles, dismount at the end of the phase
 */
export const CYCLE_S = 65;
const PATROL_END = 15;
const SKIRMISH_END = 45;
const HZ = 30;
const WALK_TO = 1.6;

export interface SoakBotOptions {
  region: RegionId;
  /** Bot slot in its room (staggers the cycle and the firing line). */
  index: number;
  /** Phase 1 shoots the garrison (Kessar); false = a town room, which only patrols and rides. */
  fights: boolean;
  /** Called on the first tick of the skirmish (the harness sends `give:all` to the room). */
  onSkirmish?: () => void;
}

/** Live counters the harness reads (what the bots really did: a soak that only stood still would pass every budget). */
export interface SoakActivity {
  shotsHeld: number;
  mountedTicks: number;
  walkedM: number;
}

export function soakBehaviour(o: SoakBotOptions, activity: SoakActivity): Behaviour {
  let home: { x: number; z: number } | undefined;
  let lastPhase = -1;
  let lastX = NaN;
  let lastZ = NaN;
  const horse = regionMountSpots(o.region).horses[o.index % 2]!;
  const offsetS = o.index * 9;
  const lane = (o.index - 1.5) * 4.5;

  const toward = (x: number, z: number, tx: number, tz: number, run: boolean): BotFrame => {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz);
    return { moveF: d < WALK_TO ? 0 : 1, moveR: 0, yaw: Math.atan2(-dx, -dz), buttons: run && d > 6 ? BUTTON.SPRINT : 0 };
  };

  return (tick, self, bot): BotFrame => {
    const me = bot.predicted;
    if (!me || tick < 45) return { moveF: 0, moveR: 0, yaw: 0, buttons: 0 }; // (the spawn snap settles first)
    home ??= { x: me.x, z: me.z };
    if (Number.isFinite(lastX)) activity.walkedM += Math.hypot(me.x - lastX, me.z - lastZ);
    lastX = me.x;
    lastZ = me.z;
    const t = (tick / HZ + offsetS) % CYCLE_S;
    const mounted = (self.flags & FLAG.MOUNTED) !== 0;
    if (mounted) activity.mountedTicks++;
    const phase = t < PATROL_END ? 0 : t < SKIRMISH_END ? (o.fights ? 1 : 0) : 2;
    if (phase !== lastPhase) {
      lastPhase = phase;
      if (phase === 1) o.onSkirmish?.();
    }
    const pulse = tick % 20 === 0 ? BUTTON.INTERACT : 0; // (a rising edge a second and a half apart: mount or dismount)

    if (phase === 2) {
      if (!mounted) {
        const f = toward(me.x, me.z, horse.x, horse.z, true);
        return Math.hypot(horse.x - me.x, horse.z - me.z) < 2.4 ? { ...f, buttons: pulse } : f;
      }
      // gallop a wide circle round the stable, dismount in the last two seconds
      if (t > CYCLE_S - 2) return { moveF: 0, moveR: 0, yaw: 0, buttons: pulse };
      return { moveF: 1, moveR: 0, yaw: (tick / HZ) * 0.5, buttons: BUTTON.SPRINT };
    }
    if (mounted) return { moveF: 0, moveR: 0, yaw: 0, buttons: pulse }; // phase moved on while still riding: get down

    if (phase === 1) {
      // the firing line: south bank of the river, one lane per bot, then shoot whichever hostile row is nearest
      const lineZ = 40;
      const hostile = nearestHostile(bot, me.x, me.z);
      if (hostile && Math.hypot(hostile.x - me.x, hostile.z - me.z) < 62 && Math.abs(me.z - lineZ) < 6) {
        const a = aimAt(me, { x: hostile.x, y: hostile.y + 1.14, z: hostile.z });
        activity.shotsHeld++;
        return { moveF: 0, moveR: Math.sin(tick / 22 + o.index) > 0 ? 0.6 : -0.6, yaw: a.aimYaw, aimYaw: a.aimYaw, aimElev: a.aimElev, buttons: BUTTON.AIM | (tick % 14 === 0 ? BUTTON.FIRE : 0), weapon: WEAPON.RIFLE }; // (a trigger pull is a rising edge: the gun's own ready time and reload pace it)
      }
      return { ...toward(me.x, me.z, home.x + lane, lineZ, true), weapon: WEAPON.RIFLE };
    }

    // patrol: a circuit of radius 10 round the arrival point, chased a few metres ahead
    const a = tick / HZ * 0.4 + o.index * 1.6;
    return toward(me.x, me.z, home.x + Math.cos(a) * 10, home.z + Math.sin(a) * 10, false);
  };
}

/** The nearest row that is not on the party's side, as THIS client draws it (the interpolated position a human would aim at). */
function nearestHostile(bot: Parameters<Behaviour>[2], x: number, z: number): { x: number; y: number; z: number } | undefined {
  let best: { x: number; y: number; z: number } | undefined;
  let bestD = Infinity;
  bot.room.state.players.forEach((p, id) => {
    if (id === bot.room.sessionId || !p.npc || (p.flags & FLAG.DOWNED) !== 0) return;
    const side = NPC_SIDE[p.npc];
    if (side === "party" || side === "neutral") return;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= bestD) return;
    bestD = d;
    best = bot.rendered(p);
  });
  return best;
}
