import {
  FLAG, MINOR_IDS, answerAudience, applyAudience, audiencesAt, hash3, leverageOf, openAudience, isNpcKey,
  type Audience as AudienceDef, type CampaignState, type ParleyView, type PlayersView, type PowersState, type Leverage,
} from "@cb/shared";

/**
 * Audiences at HQ (D-035): the powers' hooks, played over the existing parley sheet. The rules are shared and pure (shared/audiences.ts); this class is the
 * thin host-injected validation around them (like Travel.ts and Scenario.ts): who may open one (a standing human, at the map room, for a power that is really
 * asking), who may answer, one at a time per power, rate-limited, and nothing trusted from the wire but a power id and an option index. Anything else is ignored.
 */

export interface AudienceHost {
  campaign(): CampaignState;
  powers(): PowersState;
  /** True when the sender's ROW stands at the map table or the dock. */
  atMapRoom(sid: string): boolean;
  send(sid: string, type: string, msg: unknown): void;
  /** The audience ended: the new campaign (purse) and powers. The room publishes both, saves, and tells the rest. */
  commit(c: CampaignState, p: PowersState): void;
  /** The players (humans only) and a millisecond clock for the rate limit. */
  players: PlayersView;
  nowMs(): number;
  seed: number;
}

/** Minimum gap between `audienceOpen` messages from one sender. */
export const AUDIENCE_GAP_MS = 1200;

interface Run { a: AudienceDef; view: ParleyView; seed: number }

export class Audience {
  private readonly runs = new Map<string, Run>();
  private readonly lastOpen = new Map<string, number>();

  constructor(private readonly host: AudienceHost) {}

  private standing(sid: string): boolean {
    if (isNpcKey(sid)) return false;
    const p = this.host.players.get(sid);
    return !!p && !p.npc && p.connected && (p.flags & FLAG.DOWNED) === 0;
  }

  private leverage(c: CampaignState): Leverage {
    let armed = 0;
    this.host.players.forEach((p, id) => {
      if (!isNpcKey(id) && !p.npc && p.weapons !== 0) armed++;
    });
    return leverageOf(c, { armed, garrisonAlive: 0, garrisonTotal: 0, partyWounded: 0 });
  }

  /** `audienceOpen`: `power` is hostile. It must name a minor power that is, today, among the (at most two) pending audiences. */
  open(sid: string, power: unknown): void {
    if (typeof power !== "string" || !(MINOR_IDS as readonly string[]).includes(power)) return;
    if (!this.standing(sid) || !this.host.atMapRoom(sid) || this.runs.has(sid)) return;
    const now = this.host.nowMs();
    if (now - (this.lastOpen.get(sid) ?? -Infinity) < AUDIENCE_GAP_MS) return;
    this.lastOpen.set(sid, now);
    const c = this.host.campaign(), p = this.host.powers();
    const a = audiencesAt(c, p).find((x) => x.power === power);
    if (!a) return;
    for (const r of this.runs.values()) if (r.a.power === a.power) return; // one conversation per power at a time
    const seed = hash3(this.host.seed, c.day, c.expeditions, a.power.length * 131 + a.power.charCodeAt(0));
    const view = openAudience(c, p, this.leverage(c), a, seed);
    this.runs.set(sid, { a, view, seed });
    this.host.send(sid, "parley", { view });
  }

  /** `parleyPick` while an audience is open for this sender. Returns true when it was an audience's to take (the room then skips the scenario's parley). */
  onPick(sid: string, option: unknown): boolean {
    const run = this.runs.get(sid);
    if (!run) return false;
    if (typeof option !== "number" || !Number.isInteger(option) || option < 0 || option > 8) return true;
    if (!this.standing(sid) || !this.host.atMapRoom(sid)) {
      this.close(sid, "You wander off mid-sentence. They note the time.");
      return true;
    }
    const c = this.host.campaign(), p = this.host.powers();
    const step = answerAudience(c, p, this.leverage(c), run.a, run.view, option, run.seed);
    if (step.view) {
      run.view = step.view;
      this.host.send(sid, "parley", { view: step.view });
      return true;
    }
    this.runs.delete(sid);
    const r = applyAudience(c, p, run.a, step.done);
    this.host.commit(r.c, r.p);
    this.host.send(sid, "parley", { closed: true, line: step.line });
    return true;
  }

  /** `parleyClose`: leaving the table is not a refusal (nothing is recorded). Returns true when an audience was open. */
  onClose(sid: string): boolean {
    if (!this.runs.has(sid)) return false;
    this.close(sid, "You excuse yourself. Nobody holds it against you, yet.");
    return true;
  }

  onLeave(sid: string): void {
    this.runs.delete(sid);
    this.lastOpen.delete(sid);
  }

  /** Is an audience open for this sender (the room's `parleyPick` router asks). */
  has(sid: string): boolean {
    return this.runs.has(sid);
  }

  private close(sid: string, line: string): void {
    if (!this.runs.delete(sid)) return;
    this.host.send(sid, "parley", { closed: true, line });
  }
}
