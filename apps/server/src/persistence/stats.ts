/**
 * Counters the file store bumps when it repairs or refuses something. Plain numbers like `metrics` (the integrator adds them to
 * the `/metrics` snapshot; `metrics.ts` is not a persistence file). `saveFailures` stays in `metrics` and is bumped by the saver.
 */
export const persistenceStats = {
  /** A good older copy (.bak) was used because the primary file was missing or unreadable. */
  recoveries: 0,
  /** A damaged file was moved aside to `<id>.corrupt-<ts>.json`. */
  quarantined: 0,
  /** A file written by a newer build was refused (and left untouched). */
  refusedTooNew: 0,
  /** Corruption with no usable backup: the campaign could not be loaded. */
  dataLost: 0,
};

export type RecoveryAction = "restored_bak" | "quarantined" | "refused_too_new" | "data_lost";

export interface RecoveryReport {
  id: string;
  action: RecoveryAction;
  detail: string;
}
