import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const reactions = new Set(["normal", "joy", "surprised", "troubled", "explain"]);
const mouthShapes = new Set(["closed", "smallOpen", "wideOpen"]);
let sharedReaction = "normal";
let sharedMouthShape = "closed";
let sharedAudioLevel = 0;
let updatedAt = Date.now();
let sharedSettings = {
  avatarSize: 620,
  avatarX: 0,
  avatarY: 0,
  outlineEnabled: true,
  outlineWidth: 3,
  canvasAspectRatio: "9:16",
  backgroundMode: "transparent",
  backgroundColor: "#111827",
  backgroundImage: undefined as string | undefined,
  lifeEnabled: true,
  blinkEnabled: true,
  motionEnabled: true,
  lifeIntensity: "standard",
  normalBlinkImage: undefined as string | undefined,
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

function reactionPayload() {
  return JSON.stringify({
    reaction: sharedReaction,
    mouthShape: sharedMouthShape,
    audioLevel: sharedAudioLevel,
    updatedAt,
    settings: sharedSettings,
  });
}

function broadcastReaction() {
  const message = `data: ${reactionPayload()}\n\n`;
  clients.forEach((client) => client.write(message));
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "reaction-standee-local-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split("?")[0];
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
            res.write(`data: ${reactionPayload()}\n\n`);
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
              if (parsed.settings) {
                sharedSettings = {
                  ...sharedSettings,
                  ...parsed.settings,
                };
              }
              updatedAt = Date.now();
              broadcastReaction();
              res.end(reactionPayload());
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
