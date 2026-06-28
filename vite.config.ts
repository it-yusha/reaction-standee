import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

const reactions = new Set(["normal", "joy", "surprised", "troubled", "explain"]);
const mouthShapes = new Set(["closed", "smallOpen", "wideOpen"]);
let sharedReaction = "normal";
let sharedMouthShape = "closed";
let sharedAudioLevel = 0;
let sharedCameraFollow = { x: 0, y: 0, visible: false };
let updatedAt = Date.now();
let settingsUpdatedAt = Date.now();
let sharedSettings = {
  avatarSize: 620,
  avatarX: 0,
  avatarY: 80,
  outlineEnabled: true,
  outlineWidth: 3,
  outlineQuality: "standard",
  adjustmentGuidesEnabled: true,
  canvasAspectRatio: "9:16",
  backgroundMode: "transparent",
  backgroundColor: "#111827",
  backgroundImage: undefined as string | undefined,
  lifeEnabled: true,
  blinkEnabled: true,
  motionEnabled: true,
  lifeV2Enabled: true,
  speechMotionEnabled: true,
  idleMotionEnabled: true,
  gazeEnabled: true,
  cameraFollowEnabled: true,
  lifeMotionStrength: 50,
  cameraFollowStrength: 35,
  lifeIntensity: "standard",
  normalBlinkImage: undefined as string | undefined,
  eyeImages: {} as Partial<Record<"lookLeft" | "lookRight", string>>,
  blinkCrop: {
    x: 34,
    y: 19,
    width: 28,
    height: 12,
  },
  lipSyncEnabled: false,
  audioInputEnabled: false,
  mouthThreshold: 28,
  mouthCrop: {
    x: 43,
    y: 35,
    width: 15,
    height: 9,
  },
  mouthImages: {} as Partial<Record<"smallOpen" | "wideOpen", string>>,
};
const clients = new Set<{
  write: (chunk: string) => void;
  end: () => void;
}>();
const assetStoreDir = path.resolve(process.cwd(), ".reaction-standee", "assets");
const settingsStorePath = path.resolve(process.cwd(), ".reaction-standee", "settings.json");

async function ensureLocalStore() {
  await fs.mkdir(path.dirname(settingsStorePath), { recursive: true });
}

function assetFilename(key: string) {
  return `${Buffer.from(key, "utf8").toString("base64url")}.txt`;
}

function assetPath(key: string) {
  return path.join(assetStoreDir, assetFilename(key));
}

async function ensureAssetStore() {
  await ensureLocalStore();
  await fs.mkdir(assetStoreDir, { recursive: true });
}

async function readAssetMap() {
  await ensureAssetStore();
  const entries = await fs.readdir(assetStoreDir).catch(() => []);
  const assets: Record<string, string> = {};
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".txt"))
      .map(async (entry) => {
        try {
          const key = Buffer.from(entry.replace(/\.txt$/, ""), "base64url").toString("utf8");
          const dataUrl = await fs.readFile(path.join(assetStoreDir, entry), "utf8");
          if (dataUrl) assets[key] = dataUrl;
        } catch {
          // Ignore broken asset entries.
        }
      }),
  );
  return assets;
}

async function readJsonBody(req: { on: (event: string, callback: (chunk?: Buffer) => void) => void }) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk?.toString() ?? "";
    });
    req.on("end", () => resolve(body));
    req.on("error", () => reject(new Error("Request body error")));
  });
}

async function handleAssetRequest(req: any, res: any, pathname: string) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const prefix = "/api/assets";
  const keyPart = pathname === prefix || pathname === `${prefix}/` ? "" : decodeURIComponent(pathname.slice(`${prefix}/`.length));

  try {
    if (!keyPart && req.method === "GET") {
      res.end(JSON.stringify({ assets: await readAssetMap() }));
      return;
    }

    if (keyPart && req.method === "GET") {
      const dataUrl = await fs.readFile(assetPath(keyPart), "utf8").catch(() => "");
      if (!dataUrl) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Asset not found" }));
        return;
      }
      res.end(JSON.stringify({ key: keyPart, dataUrl }));
      return;
    }

    if (keyPart && (req.method === "PUT" || req.method === "POST")) {
      const body = await readJsonBody(req);
      const parsed = JSON.parse(body || "{}") as { dataUrl?: string };
      if (!parsed.dataUrl?.startsWith("data:")) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid dataUrl" }));
        return;
      }
      await ensureAssetStore();
      await fs.writeFile(assetPath(keyPart), parsed.dataUrl, "utf8");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (keyPart && req.method === "DELETE") {
      await fs.rm(assetPath(keyPart), { force: true });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (!keyPart && req.method === "DELETE") {
      await fs.rm(assetStoreDir, { recursive: true, force: true });
      await ensureAssetStore();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Asset API error" }));
  }
}

async function readSharedSettingsFile() {
  try {
    const raw = await fs.readFile(settingsStorePath, "utf8");
    const parsed = JSON.parse(raw) as { settings?: unknown; updatedAt?: unknown };
    if (!parsed.settings || typeof parsed.settings !== "object") return {};
    const stat = await fs.stat(settingsStorePath).catch(() => undefined);
    return {
      settings: parsed.settings,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : stat?.mtimeMs,
    };
  } catch {
    return {};
  }
}

async function handleSettingsRequest(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      res.end(JSON.stringify(await readSharedSettingsFile()));
      return;
    }

    if (req.method !== "PUT" && req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const body = await readJsonBody(req);
    const parsed = JSON.parse(body || "{}") as { settings?: unknown };
    if (!parsed.settings || typeof parsed.settings !== "object") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid settings" }));
      return;
    }

    await ensureLocalStore();
    const payload = { settings: parsed.settings, updatedAt: Date.now() };
    await fs.writeFile(settingsStorePath, JSON.stringify(payload, null, 2), "utf8");
    res.end(JSON.stringify({ ok: true, updatedAt: payload.updatedAt }));
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Settings API error" }));
  }
}

function reactionPayload({ includeSettings = true } = {}) {
  const payload: {
    reaction: string;
    mouthShape: string;
    audioLevel: number;
    cameraFollow: typeof sharedCameraFollow;
    updatedAt: number;
    settingsUpdatedAt: number;
    settings?: typeof sharedSettings;
  } = {
    reaction: sharedReaction,
    mouthShape: sharedMouthShape,
    audioLevel: sharedAudioLevel,
    cameraFollow: sharedCameraFollow,
    updatedAt,
    settingsUpdatedAt,
  };
  if (includeSettings) {
    payload.settings = sharedSettings;
  }
  return JSON.stringify(payload);
}

function broadcastReaction() {
  const message = `data: ${reactionPayload({ includeSettings: false })}\n\n`;
  clients.forEach((client) => client.write(message));
}

const isGitHubPagesBuild = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  base: isGitHubPagesBuild ? "/reaction-standee/" : "/",
  plugins: [
    react(),
    {
      name: "reaction-standee-local-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split("?")[0];
          if (pathname === "/api/settings" || pathname === "/api/settings/") {
            void handleSettingsRequest(req, res);
            return;
          }

          if (pathname === "/api/assets" || pathname === "/api/assets/" || pathname?.startsWith("/api/assets/")) {
            void handleAssetRequest(req, res, pathname);
            return;
          }

          if (
            pathname !== "/api/reaction" &&
            pathname !== "/api/reaction/" &&
            pathname !== "/api/reaction/events" &&
            pathname !== "/api/reaction/events/"
          ) {
            next();
            return;
          }

          if (pathname === "/api/reaction/events" || pathname === "/api/reaction/events/") {
            res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("Connection", "keep-alive");
            res.write(`data: ${reactionPayload({ includeSettings: false })}\n\n`);
            clients.add(res);
            req.on("close", () => {
              clients.delete(res);
              res.end();
            });
            return;
          }

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");

          if (req.method === "GET") {
            res.end(reactionPayload());
            return;
          }

          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }

          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body) as {
                reaction?: string;
                mouthShape?: string;
                audioLevel?: number;
                cameraFollow?: { x?: number; y?: number; visible?: boolean };
                settings?: Partial<typeof sharedSettings>;
              };
              if (!parsed.reaction || !reactions.has(parsed.reaction)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Invalid reaction" }));
                return;
              }
              sharedReaction = parsed.reaction;
              sharedMouthShape = parsed.mouthShape && mouthShapes.has(parsed.mouthShape) ? parsed.mouthShape : "closed";
              sharedAudioLevel = typeof parsed.audioLevel === "number" ? parsed.audioLevel : 0;
              if (
                parsed.cameraFollow &&
                typeof parsed.cameraFollow.x === "number" &&
                typeof parsed.cameraFollow.y === "number" &&
                typeof parsed.cameraFollow.visible === "boolean"
              ) {
                sharedCameraFollow = {
                  x: parsed.cameraFollow.x,
                  y: parsed.cameraFollow.y,
                  visible: parsed.cameraFollow.visible,
                };
              }
              if (parsed.settings) {
                sharedSettings = {
                  ...sharedSettings,
                  ...parsed.settings,
                };
                settingsUpdatedAt = Date.now();
              }
              updatedAt = Date.now();
              broadcastReaction();
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, updatedAt }));
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
        });
      },
    },
  ],
});
