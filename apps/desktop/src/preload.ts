import { contextBridge, ipcRenderer } from "electron";
// Deep imports on purpose: the preload must stay tiny, and `@cb/shared`'s index would pull the whole game into the sandbox.
import { isRegionId } from "../../../packages/shared/src/campaignTypes.ts";
import { createNoopPlatform, isAchievementId, type DesktopBridge, type DesktopChannel, type DesktopInfo, type InviteRequest, type PlatformAdapter, type PresenceState } from "../../../packages/shared/src/platform.ts";
import { isValidJoinCode } from "../../../packages/shared/src/protocol.ts";
import { INFO_ARG } from "./constants.ts";

/**
 * The preload (D-036, package D): builds `window.cbDesktop`, EXACTLY the `DesktopBridge` of the shared contract and nothing else. No `ipcRenderer`, no `require`, no generic invoke, no
 * channel name the page can choose: each method here maps to one fixed channel and sends only validated primitives. The preload runs in the sandbox and is bundled to one file
 * (scripts/build.mjs); it reaches `electron` only for `contextBridge` and `ipcRenderer`.
 */
export interface IpcRendererLike {
  invoke(channel: DesktopChannel, ...args: unknown[]): Promise<unknown>;
  on(channel: DesktopChannel, listener: (e: unknown, payload: unknown) => void): unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseInfo(argv: readonly string[]): DesktopInfo {
  const fallback: DesktopInfo = { version: "0.0.0", platform: "linux", packaged: false, steam: "web", updates: "off" };
  const raw = argv.find((a) => a.startsWith(INFO_ARG));
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw.slice(INFO_ARG.length));
    if (!isObj(v)) return fallback;
    return {
      version: typeof v.version === "string" ? v.version.slice(0, 32) : fallback.version,
      platform: v.platform === "win32" || v.platform === "darwin" || v.platform === "linux" ? v.platform : "linux",
      packaged: v.packaged === true,
      steam: v.steam === "steam-stub" || v.steam === "steam" ? v.steam : "web",
      updates: v.updates === "on" ? "on" : "off",
    };
  } catch {
    return fallback;
  }
}

export function buildBridge(ipc: IpcRendererLike, argv: readonly string[]): DesktopBridge {
  const info = Object.freeze(parseInfo(argv));
  const queue: string[] = [];
  let sub: ((r: InviteRequest) => void) | undefined;
  // Invites can arrive before the page subscribes (a launch argument): hold at most four, deliver on subscribe. Only a valid join code is ever kept.
  ipc.on("platform:invite", (_e, payload) => {
    const code = isObj(payload) && isValidJoinCode(payload.joinCode) ? payload.joinCode : undefined;
    if (!code) return;
    if (sub) sub({ joinCode: code });
    else if (queue.length < 4) queue.push(code);
  });
  const ignore = (): void => undefined;
  const live = info.steam !== "web";
  const noop = createNoopPlatform();
  const platform: PlatformAdapter = {
    kind: info.steam,
    available: live,
    init: async () => (live ? (await ipc.invoke("platform:init").catch(() => false)) === true : false),
    unlock: (id) => {
      if (live && isAchievementId(id)) void ipc.invoke("platform:unlock", id).catch(ignore);
    },
    setPresence: (p: PresenceState) => {
      if (!live || !isObj(p)) return;
      const out: Record<string, unknown> = { where: p.where, party: p.party, day: p.day };
      if (isRegionId(p.region)) out.region = p.region;
      if (isValidJoinCode(p.joinCode)) out.joinCode = p.joinCode;
      void ipc.invoke("platform:presence", out).catch(ignore);
    },
    onInvite: live
      ? (cb) => {
          sub = cb;
          for (const code of queue.splice(0)) cb({ joinCode: code });
          return () => {
            if (sub === cb) sub = undefined;
          };
        }
      : noop.onInvite,
    shutdown: ignore,
  };
  return {
    info,
    platform,
    openWishlist: () => void ipc.invoke("shell:wishlist").catch(ignore),
    quit: () => void ipc.invoke("app:quit").catch(ignore),
  };
}

contextBridge.exposeInMainWorld("cbDesktop", buildBridge(ipcRenderer as unknown as IpcRendererLike, process.argv));
