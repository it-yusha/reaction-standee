import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const reactions = new Set(["normal", "joy", "surprised", "troubled", "explain"]);
let sharedReaction = "normal";
let updatedAt = Date.now();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "reaction-standee-local-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split("?")[0];
          if (pathname !== "/api/reaction" && pathname !== "/api/reaction/") {
            next();
            return;
          }

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");

          if (req.method === "GET") {
            res.end(JSON.stringify({ reaction: sharedReaction, updatedAt }));
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
              const parsed = JSON.parse(body) as { reaction?: string };
              if (!parsed.reaction || !reactions.has(parsed.reaction)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Invalid reaction" }));
                return;
              }
              sharedReaction = parsed.reaction;
              updatedAt = Date.now();
              res.end(JSON.stringify({ reaction: sharedReaction, updatedAt }));
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
