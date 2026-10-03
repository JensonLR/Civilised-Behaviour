import type { SavedMsg } from "@cb/shared";

/**
 * Where the campaign's save stands, as the client knows it (D-039). The server saves the LEDGER (purse, days, outposts, hired hands, the powers) at every change and when the last
 * player leaves, and tells the party after each save (`saved`); nothing else is saved (where you stand and what lies on the ground are not: a resumed expedition begins at HQ). The
 * tracker turns those messages, and the pause sheet's own requests, into one status the HUD and the sheet draw. Pure but for one timer; never throws on a hostile message.
 */

export type SaveStatus =
  | { readonly kind: "unknown" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly at: number }
  /** This room keeps nothing (the demo, or no usable identity): never say "Saved". */
  | { readonly kind: "unkept" }
  /** The last attempt did not go through (`at`: the last good one, 0 if none). The next change tries again. */
  | { readonly kind: "failed"; readonly at: number };

/** What the player is told, honestly: what is saved and what is not. */
export const SAVE_NOTE = "The ledger (purse, days, outposts, hired hands, the powers' tempers) is saved at every change and when the last player leaves. Where you stand is not: a resumed expedition begins at HQ.";

/** `short` is the HUD's: the long reasons stay in the tooltip and on the pause sheet. */
export function saveLabel(s: SaveStatus, fmtTime: (at: number) => string = clock, short = false): string {
  switch (s.kind) {
    case "unknown":
      return "";
    case "saving":
      return "Saving...";
    case "saved":
      return s.at > 0 ? `Saved ${fmtTime(s.at)}` : ""; // (the room's first word, before any save: unknown, not "Saving...", which stood on the bar for good when no save followed)
    case "unkept":
      return short ? "Not saved" : "Not saved: this server keeps no files";
    case "failed":
      return short ? "Save failed" : "Not saved: the last attempt failed and will be retried";
  }
}

const clock = (at: number): string => {
  try {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

/** A `saved` message from the wire, checked: anything that is not the plain shape is ignored (undefined). */
export function parseSaved(m: unknown): SavedMsg | undefined {
  if (typeof m !== "object" || m === null) return undefined;
  const o = m as Record<string, unknown>;
  if (typeof o.kept !== "boolean" || typeof o.ok !== "boolean") return undefined;
  const at = typeof o.at === "number" && Number.isFinite(o.at) && o.at >= 0 ? o.at : 0;
  return { kept: o.kept, ok: o.ok, at, ...(o.asked === true ? { asked: true } : {}) };
}

export class SaveTracker {
  private status: SaveStatus = { kind: "unknown" };
  private readonly listeners = new Set<(s: SaveStatus) => void>();
  private waiting: { waiters: ((s: SaveStatus) => void)[]; timer: ReturnType<typeof setTimeout> } | undefined;

  get current(): SaveStatus {
    return this.status;
  }

  subscribe(fn: (s: SaveStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: SaveStatus): void {
    this.status = s;
    for (const fn of [...this.listeners]) fn(s);
  }

  /** The time of the last good save heard of (kept across "saving" and "failed"). */
  private good = 0;
  private lastGood(): number {
    return this.good;
  }

  /** A `saved` message arrived (from the room's own broadcast, a joiner's welcome or the answer to a request). */
  onSaved(raw: unknown): void {
    const m = parseSaved(raw);
    if (!m) return;
    if (m.kept && m.ok && m.at > 0) this.good = m.at;
    this.set(!m.kept ? { kind: "unkept" } : m.ok ? { kind: "saved", at: m.at } : { kind: "failed", at: m.at || this.lastGood() });
    if (m.asked) this.settle();
  }

  /**
   * Asks for a save now: `send` posts the request, the promise settles with the answer, or with `failed` when none comes in `timeoutMs` (a dropped line must not hold the player on
   * a sheet). One request at a time: a second call while one is out shares its answer and sends nothing.
   */
  request(send: () => void, timeoutMs = 6000): Promise<SaveStatus> {
    return new Promise<SaveStatus>((resolve) => {
      if (this.waiting) {
        this.waiting.waiters.push(resolve);
        return;
      }
      const timer = setTimeout(() => {
        this.set({ kind: "failed", at: this.lastGood() });
        this.settle();
      }, timeoutMs);
      this.waiting = { waiters: [resolve], timer };
      if (this.status.kind !== "unkept") this.set({ kind: "saving" });
      try {
        send();
      } catch {
        /* a closed socket: the timer settles it */
      }
    });
  }

  private settle(): void {
    const w = this.waiting;
    if (!w) return;
    this.waiting = undefined;
    clearTimeout(w.timer);
    for (const r of w.waiters) r(this.status);
  }
}
