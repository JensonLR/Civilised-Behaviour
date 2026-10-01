// The real entry (bundled to dist/main.cjs): hands Electron's own modules to the testable lifecycle. Nothing else lives here.
import { dirname, join } from "node:path";
import * as electron from "electron";
import { startDesktop, type ElectronLike } from "./main.ts";

const dist = __dirname;
const clientRoot = electron.app.isPackaged ? join(process.resourcesPath, "client") : join(dirname(dist), "..", "client", "dist-desktop");
void startDesktop(electron as unknown as ElectronLike, { env: process.env, argv: process.argv, platform: process.platform, dist, clientRoot });
