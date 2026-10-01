import { DESKTOP_CHANNELS, isAchievementId, isRegionId, isValidJoinCode, type DesktopChannel, type DesktopInfo, type PlatformAdapter, type PresenceState } from "./shared.ts";
import { isAppUrl } from "./security.ts";

/**
 * The main process's whole IPC surface (D-036, package D). Handlers exist ONLY for the request channels in `DESKTOP_CHANNELS` (the seventh, `platform:invite`, is main -> renderer and has no
 * handler), every one refuses a sender frame that is not the app's own page (`app://game`), and every argument is validated and REBUILT from known fields (nothing the renderer sends is
 * ever passed on as it came). A refused or invalid call returns a neutral value and never throws.
 */
export const REQUEST_CHANNELS = ["app:info", "platform:init", "platform:unlock", "platform:presence", "shell:wishlist", "app:quit"] as const satisfies readonly DesktopChannel[];
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export interface IpcEventLike { senderFrame?: { url?: string; parent?: unknown } | null }
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

/** True only for the top-level page of the app protocol. */
export const isAppSender = (e: IpcEventLike | undefined): boolean => {
  const f = e?.senderFrame;
  return !!f && typeof f.url === "string" && isAppUrl(f.url) && (f.parent === null || f.parent === undefined);
};

const WHERE: readonly PresenceState["where"][] = ["menu", "hq", "sailing", "region"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

/** A presence request, validated and rebuilt, or undefined. */
export function parsePresence(v: unknown): PresenceState | undefined {
  if (!isObj(v)) return undefined;
  const where = WHERE.find((w) => w === v.where);
  const party = intIn(v.party, 1, 4);
  const day = intIn(v.day, 0, 9999);
  if (!where || party === undefined || day === undefined) return undefined;
  const out: PresenceState = { where, party, day };
  if (v.region !== undefined) {
    if (!isRegionId(v.region)) return undefined;
    out.region = v.region;
  }
  if (v.joinCode !== undefined) {
    if (!isValidJoinCode(v.joinCode)) return undefined;
    out.joinCode = v.joinCode;
  }
  return out;
}

export interface IpcDeps {
  info: () => DesktopInfo;
  platform: PlatformAdapter;
  /** The configured https wish-list page, or undefined. The renderer can never supply a URL. */
  wishlist: string | undefined;
  openExternal(url: string): void;
  quit(): void;
  log?(line: string): void;
}

export function registerIpc(ipc: IpcMainLike, d: IpcDeps): () => void {
  const refuse = (ch: string): void => d.log?.(`refused ${ch} from a frame that is not the app page`);
  const on = <T>(ch: RequestChannel, fallback: T, fn: (...args: unknown[]) => T | Promise<T>): void => {
    if (!(DESKTOP_CHANNELS as readonly string[]).includes(ch)) throw new Error(`unlisted channel ${ch}`);
    ipc.handle(ch, async (e, ...args) => {
      if (!isAppSender(e)) {
        refuse(ch);
        return fallback;
      }
      try {
        return await fn(...args);
      } catch {
        return fallback;
      }
    });
  };
  on("app:info", undefined as DesktopInfo | undefined, () => ({ ...d.info() }));
  on("platform:init", false, async () => (await d.platform.init()) === true);
  on("platform:unlock", false, (id) => {
    if (!isAchievementId(id)) return false;
    d.platform.unlock(id);
    return true;
  });
  on("platform:presence", false, (raw) => {
    const p = parsePresence(raw);
    if (!p) return false;
    d.platform.setPresence(p);
    return true;
  });
  on("shell:wishlist", false, () => {
    // no argument is read: the URL is the build's configuration, https only
    if (!d.wishlist) return false;
    d.openExternal(d.wishlist);
    return true;
  });
  on("app:quit", false, () => {
    d.quit();
    return true;
  });
  return () => {
    for (const ch of REQUEST_CHANNELS) ipc.removeHandler(ch);
  };
}
