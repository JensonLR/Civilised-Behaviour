import { ACHIEVEMENTS, connectString, isAchievementId, isRegionId, isValidJoinCode, presenceText, type AchievementId, type InviteRequest, type PlatformAdapter, type PresenceState } from "../shared.ts";

/**
 * A stand-in for Steamworks, selected by `CB_STEAM=stub` (D-036, package D). It proves the whole seam end to end with NO App ID, NO Steam client and NO network: it records every call in
 * a bounded ring, logs them, keeps the achievements unlocked this run, composes the rich-presence line the real one would send, and `simulateInvite(code)` plays the part of a friend
 * clicking "Join Game" (it reaches `onInvite` ONLY with a valid join code). It holds no credential of any kind and never makes a request.
 * This is the deliberate stand-in the seam is proved with, not an unfinished piece of the game; the real adapter is a later slice (docs/STEAM_RELEASE.md).
 */
export type StubCall =
  | { op: "init" } | { op: "unlock"; id: AchievementId; fresh: boolean } | { op: "presence"; text: string; connect: string | undefined }
  | { op: "invite"; joinCode: string } | { op: "invite-refused" } | { op: "shutdown" };

export const RING = 200;

export class StubSteam implements PlatformAdapter {
  readonly kind = "steam-stub" as const;
  readonly available = true;
  private readonly ring: StubCall[] = [];
  private readonly unlocked = new Set<AchievementId>();
  private listeners = new Set<(r: InviteRequest) => void>();
  private text: string | undefined;
  private connect: string | undefined;
  private started = false;

  constructor(private readonly log: (line: string) => void = (l) => console.log(`[steam-stub] ${l}`)) {}

  private record(c: StubCall): void {
    this.ring.push(c);
    if (this.ring.length > RING) this.ring.shift();
  }

  async init(): Promise<boolean> {
    this.started = true;
    this.record({ op: "init" });
    this.log("init (no Steam client: stub)");
    return true;
  }

  /** Idempotent: the second unlock of an id changes nothing and logs nothing. An unknown id is ignored. */
  unlock(id: AchievementId): void {
    if (!isAchievementId(id)) return;
    const fresh = !this.unlocked.has(id);
    this.unlocked.add(id);
    this.record({ op: "unlock", id, fresh });
    if (fresh) this.log(`achievement unlocked: ${id}`);
  }

  setPresence(p: PresenceState): void {
    const party = Math.max(1, Math.min(4, Math.floor(Number.isFinite(p?.party) ? p.party : 1)));
    const day = Math.max(0, Math.min(9999, Math.floor(Number.isFinite(p?.day) ? p.day : 0)));
    const clean: PresenceState = { where: p.where, region: isRegionId(p.region) ? p.region : undefined, party, day, joinCode: isValidJoinCode(p.joinCode) ? p.joinCode : undefined };
    this.text = presenceText(clean);
    this.connect = clean.joinCode ? connectString(clean.joinCode) : undefined;
    this.record({ op: "presence", text: this.text, connect: this.connect });
    this.log(`presence: ${this.text}${this.connect ? " [joinable]" : ""}`);
  }

  onInvite(cb: (r: InviteRequest) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** A friend's click. Returns whether it was delivered: only a valid join code is. */
  simulateInvite(code: unknown): boolean {
    if (!isValidJoinCode(code)) {
      this.record({ op: "invite-refused" });
      return false;
    }
    this.record({ op: "invite", joinCode: code });
    this.log(`invite accepted -> join ${code}`);
    for (const l of [...this.listeners]) l({ joinCode: code });
    return true;
  }

  shutdown(): void {
    this.record({ op: "shutdown" });
    this.listeners = new Set();
    this.started = false;
    this.log("shutdown");
  }

  // ---- inspection (tests, the dev console) ----
  get calls(): readonly StubCall[] {
    return this.ring;
  }
  achievements(): AchievementId[] {
    return ACHIEVEMENTS.filter((a) => this.unlocked.has(a));
  }
  presenceLine(): string | undefined {
    return this.text;
  }
  connectLine(): string | undefined {
    return this.connect;
  }
  get running(): boolean {
    return this.started;
  }
}
