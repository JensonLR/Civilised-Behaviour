import { isValidJoinCode, parseCampaign, parsePowers, parseSettlements, type AchievementId, type PlatformAdapter, type PresenceState, type RegionId } from "@cb/shared";
import { evaluateAchievements } from "./shared.ts";

/**
 * Everything the game tells the storefront, in one place (D-036, package D), so `Game` has three one-line calls and nothing else to know:
 *   `link.campaign(campaignJson, powersJson, settlementsJson)`  when the campaign revision moves: unlocks each NEWLY earned achievement (once per session per id; the storefront's own
 *                                                              unlock is idempotent too);
 *   `link.presence(state)`                                       when region, party or day changes: forwards only a CHANGED state;
 *   `new PlatformLink(adapter, join)`                            subscribes to invites: a friend's click arrives as a VALID join code and becomes `join(code)`, nothing else.
 * The adapter is a no-op on the web, so nothing here needs to branch on the platform.
 */
export class PlatformLink {
  private readonly held = new Set<AchievementId>();
  private lastPresence = "";
  private readonly off: () => void;

  constructor(private readonly adapter: PlatformAdapter, join: (code: string) => void) {
    this.off = adapter.onInvite((r) => {
      // The adapter promises a valid code; this is the second check at the door.
      if (r && isValidJoinCode(r.joinCode)) join(r.joinCode);
    });
    void adapter.init().catch(() => undefined);
  }

  /** Marks ids the storefront already holds (from a previous session) so they are not unlocked again. Optional. */
  hold(ids: readonly AchievementId[]): void {
    for (const id of ids) this.held.add(id);
  }

  /** Returns the ids newly unlocked by this call (for tests and toasts). Never throws: a malformed save earns nothing. */
  campaign(campaignJson: string, powersJson: string, settlementsJson: string): AchievementId[] {
    const c = parseCampaign(campaignJson);
    const p = parsePowers(powersJson);
    const s = parseSettlements(settlementsJson);
    if (!c || !p || !s) return [];
    const fresh = evaluateAchievements(c, p, s, [...this.held]);
    for (const id of fresh) {
      this.held.add(id);
      this.adapter.unlock(id);
    }
    return fresh;
  }

  presence(state: { where: PresenceState["where"]; region?: RegionId; party: number; day: number; joinCode?: string }): void {
    const key = `${state.where}|${state.region ?? ""}|${state.party}|${state.day}|${state.joinCode ?? ""}`;
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    this.adapter.setPresence({ where: state.where, region: state.region, party: state.party, day: state.day, joinCode: state.joinCode && isValidJoinCode(state.joinCode) ? state.joinCode : undefined });
  }

  dispose(): void {
    this.off();
    this.adapter.shutdown();
  }
}
