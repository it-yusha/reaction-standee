const path = require("node:path");
const fs = require("node:fs/promises");
const http = require("node:http");
const { app, BrowserWindow, Menu, shell } = require("electron");

const isDev = process.argv.includes("--dev") || Boolean(process.env.VITE_DEV_SERVER_URL);
const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173/record";
const projectRoot = path.join(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const assetStoreDir = path.join(projectRoot, ".reaction-standee", "assets");
const settingsStorePath = path.join(projectRoot, ".reaction-standee", "settings.json");

let mainWindow;
let localServer;

function assetFilename(key) {
  return `${Buffer.from(key, "utf8").toString("base64url")}.txt`;
}

function assetPath(key) {
  return path.join(assetStoreDir, assetFilename(key));
}

async function ensureAssetStore() {
  await fs.mkdir(path.dirname(settingsStorePath), { recursive: true });
  await fs.mkdir(assetStoreDir, { recursive: true });
}

async function readAssetMap() {
  await ensureAssetStore();
  const entries = await fs.readdir(assetStoreDir).catch(() => []);
  const assets = {};
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function canReachUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve((response.statusCode || 500) < 500);
    });
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

function proxyDevServerRequest(req, res) {
  const targetUrl = new URL(req.url || "/", "http://127.0.0.1:5173");
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: 5173,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers: {
        ...req.headers,
        host: "127.0.0.1:5173",
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    sendJson(res, 502, { error: "Dev server is not available" });
  });

  req.pipe(proxyReq);
}

async function handleAssetRequest(req, res, pathname) {
  const prefix = "/api/assets";
  const key = pathname === prefix || pathname === `${prefix}/` ? "" : decodeURIComponent(pathname.slice(`${prefix}/`.length));

  try {
    if (!key && req.method === "GET") {
      sendJson(res, 200, { assets: await readAssetMap() });
      return;
    }

    if (key && req.method === "GET") {
      const dataUrl = await fs.readFile(assetPath(key), "utf8").catch(() => "");
      if (!dataUrl) {
        sendJson(res, 404, { error: "Asset not found" });
        return;
      }
      sendJson(res, 200, { key, dataUrl });
      return;
    }

    if (key && (req.method === "PUT" || req.method === "POST")) {
      const payload = JSON.parse((await readBody(req)) || "{}");
      if (!payload.dataUrl?.startsWith("data:")) {
        sendJson(res, 400, { error: "Invalid dataUrl" });
        return;
      }
      await ensureAssetStore();
      await fs.writeFile(assetPath(key), payload.dataUrl, "utf8");
      sendJson(res, 200, { ok: true });
      return;
    }

    if (key && req.method === "DELETE") {
      await fs.rm(assetPath(key), { force: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!key && req.method === "DELETE") {
      await fs.rm(assetStoreDir, { recursive: true, force: true });
      await ensureAssetStore();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch {
    sendJson(res, 500, { error: "Asset API error" });
  }
}

async function readSharedSettingsFile() {
  try {
    const raw = await fs.readFile(settingsStorePath, "utf8");
    const payload = JSON.parse(raw);
    if (!payload.settings || typeof payload.settings !== "object") return {};
    const stat = await fs.stat(settingsStorePath).catch(() => undefined);
    return {
      settings: payload.settings,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : stat?.mtimeMs,
    };
  } catch {
    return {};
  }
}

async function handleSettingsRequest(req, res) {
  try {
    if (req.method === "GET") {
      sendJson(res, 200, await readSharedSettingsFile());
      return;
    }

    if (req.method !== "PUT" && req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const payload = JSON.parse((await readBody(req)) || "{}");
    if (!payload.settings || typeof payload.settings !== "object") {
      sendJson(res, 400, { error: "Invalid settings" });
      return;
    }

    await fs.mkdir(path.dirname(settingsStorePath), { recursive: true });
    const nextPayload = { settings: payload.settings, updatedAt: Date.now() };
    await fs.writeFile(settingsStorePath, JSON.stringify(nextPayload, null, 2), "utf8");
    sendJson(res, 200, { ok: true, updatedAt: nextPayload.updatedAt });
  } catch {
    sendJson(res, 500, { error: "Settings API error" });
  }
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function handleStaticRequest(req, res, pathname) {
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(distDir, safePath));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    const indexHtml = await fs.readFile(path.join(distDir, "index.html"));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(indexHtml);
  }
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (
        url.pathname === "/api/reaction" ||
        url.pathname === "/api/reaction/" ||
        url.pathname === "/api/reaction/events" ||
        url.pathname === "/api/reaction/events/"
      ) {
        proxyDevServerRequest(req, res);
        return;
      }

      if (url.pathname === "/api/settings" || url.pathname === "/api/settings/") {
        void handleSettingsRequest(req, res);
        return;
      }

      if (url.pathname === "/api/assets" || url.pathname === "/api/assets/" || url.pathname.startsWith("/api/assets/")) {
        void handleAssetRequest(req, res, url.pathname);
        return;
      }
      void handleStaticRequest(req, res, url.pathname);
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      localServer = server;
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Local server failed to start"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/?route=record`);
    });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 960,
    useContentSize: true,
    minWidth: 360,
    minHeight: 640,
    resizable: false,
    backgroundColor: "#090d14",
    title: "Reaction Standee",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setAspectRatio(9 / 16);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev || (await canReachUrl(devServerUrl))) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    const url = await startLocalServer();
    void mainWindow.loadURL(url);
  }
}

function createMenu() {
  const template = [
    {
      label: "Reaction Standee",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  createMenu();
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (localServer) {
    localServer.close();
    localServer = undefined;
  }
  if (process.platform !== "darwin") app.quit();
});
