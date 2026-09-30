/** What the front door says when joining or founding an expedition fails, in the Society's voice but with the real reason in it. */
export function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const m = raw.trim();
  if (!m) return "The Society regrets to inform you of an error. Please try again.";
  if (/failed to fetch|network|econn|websocket|socket|timed? ?out|unreachable|refused|offline|load failed|\b(4|5)0[0-9]\b/i.test(m) && !/code|expedition|full|not found|no such/i.test(m)) {
    return "The telegraph line is down: the game server could not be reached. Check your connection, then try again.";
  }
  return m.length > 160 ? `${m.slice(0, 157)}...` : m;
}

/** The lines the working card shows one after another while it waits: the step, and a gentle word if the reply is slow. */
export const WORKING_STEPS: readonly { after: number; text: string }[] = [
  { after: 0, text: "Posting the telegram..." },
  { after: 3.5, text: "Awaiting the Society's reply..." },
  { after: 9, text: "The Society is slow to reply. Servants are being sent for." },
  { after: 20, text: "Still waiting. The line may be down; you may go back and try again." },
];

/** The step to show after `seconds` of waiting, unless `override` (a named stage such as "Surveying the territory") is set. */
export function stepAt(seconds: number, override?: string): string {
  if (override) return override;
  let text = WORKING_STEPS[0]!.text;
  for (const s of WORKING_STEPS) if (seconds >= s.after) text = s.text;
  return text;
}
