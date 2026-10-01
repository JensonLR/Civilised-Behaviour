import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cfgUrl = new URL("../electron-builder.json", import.meta.url);
const cfg = JSON.parse(readFileSync(cfgUrl, "utf8")) as Record<string, any>;
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, any>;

const walk = (v: unknown, path: string[] = [], out: { path: string[]; value: unknown }[] = []): { path: string[]; value: unknown }[] => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k], out);
  else out.push({ path, value: v });
  return out;
};
const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};

describe("electron-builder.json", () => {
  const tgt = (list: unknown): string[] => (list as { target: string; arch: string[] }[]).flatMap((t) => t.arch.map((a) => `${t.target}:${a}`)).sort();
  it("targets: Windows NSIS x64, macOS dmg x64+arm64, Linux AppImage + deb", () => {
    expect(tgt(cfg.win.target)).toEqual(["nsis:x64"]);
    expect(tgt(cfg.mac.target)).toEqual(["dmg:arm64", "dmg:x64"]);
    expect(tgt(cfg.linux.target)).toEqual(["AppImage:x64", "deb:x64"]);
  });
  it("is UNSIGNED and unpublished: identity null, publish null, no signing or notarisation block", () => {
    expect(cfg.mac.identity).toBeNull();
    expect(cfg.publish).toBeNull();
    expect(cfg.mac.notarize).toBeUndefined();
    expect(cfg.win.sign).toBeUndefined();
    expect(cfg.win.certificateFile).toBeUndefined();
  });
  it("no key anywhere is shaped like a secret, and no value looks like a credential", () => {
    const bad = keysOf(cfg).filter((k) => /csc|cert|token|secret|passw|apikey|api_key|private|credential|signing|notariz|apple(id|team)|teamid|keychain|identity/i.test(k) && k !== "identity");
    expect(bad).toEqual([]);
    for (const { path, value } of walk(cfg)) {
      if (typeof value !== "string") continue;
      expect(value, path.join(".")).not.toMatch(/-----BEGIN|ghp_|gho_|AKIA[0-9A-Z]{12}|xox[bp]-|[A-Za-z0-9+/]{60,}={0,2}/);
    }
  });
  it("asar on, output is release/, files is a WHITELIST (no wildcards), the client is an extraResource, fuses lock the runtime down", () => {
    expect(cfg.asar).toBe(true);
    expect(cfg.directories.output).toBe("release");
    expect(cfg.files).toEqual(["dist/main.cjs", "dist/preload.cjs", "package.json"]);
    expect(cfg.files.some((f: string) => /\*/.test(f))).toBe(false);
    expect(cfg.extraResources).toEqual([{ from: "../client/dist-desktop", to: "client", filter: ["**/*", "!**/*.map"] }]);
    expect(cfg.electronFuses).toMatchObject({ runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true, grantFileProtocolExtraPrivileges: false });
  });
  it("the package points at the bundle and its scripts build the client, then the shell, then package", () => {
    expect(pkg.main).toBe("dist/main.cjs");
    expect(pkg.scripts.dist).toMatch(/build-client\.mjs.*build\.mjs.*electron-builder --config electron-builder\.json/);
    expect(pkg.scripts["dist:dir"]).toMatch(/electron-builder --dir/);
    expect(pkg.dependencies).toEqual({ "@cb/shared": "workspace:*" });
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["electron", "electron-builder", "esbuild"]);
  });
  it("release/ is git-ignored and the client's desktop output is too", () => {
    const ignore = readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
    expect(ignore).toMatch(/apps\/desktop\/release\//);
    expect(ignore).toMatch(/dist-desktop\//);
  });
});
