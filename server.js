const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const WebSocket = require("ws");
const pty = require("node-pty");

const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.port) cfg.port = 8787;
  if (!cfg.launchMode) cfg.launchMode = "direct";
  if (!cfg.direct) cfg.direct = { command: "codex", args: [] };
  if (!cfg.managed) cfg.managed = { commandTemplate: "codex --mode {mode}", extraArgs: [] };
  if (!cfg.approve) cfg.approve = { allow: "y\n", deny: "n\n" };
  if (cfg.authToken === undefined) cfg.authToken = "";
  return cfg;
}

let config = loadConfig();
let currentMode = "chat";
let proc = null;
let procReady = false;
let buffer = "";

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(input) {
  return input.replace(ANSI_REGEX, "");
}

const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function spawnCodex(modeOverride) {
  const mode = modeOverride || currentMode;
  if (proc) {
    try { proc.kill(); } catch {}
    proc = null;
  }

  let command = config.direct.command;
  let args = Array.isArray(config.direct.args) ? config.direct.args.slice() : [];

  if (config.launchMode === "managed") {
    const template = config.managed.commandTemplate || "codex --mode {mode}";
    const commandLine = template.replace("{mode}", mode);
    const parts = commandLine.split(" ").filter(Boolean);
    command = parts[0];
    args = parts.slice(1);
    if (Array.isArray(config.managed.extraArgs)) args = args.concat(config.managed.extraArgs);
  }

  proc = pty.spawn(command, args, {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env
  });

  procReady = true;
  broadcast({ type: "status", status: "started", mode });

  proc.onData((data) => {
    buffer += data;
    const parts = buffer.split(/\r\n|\n|\r/);
    buffer = parts.pop() || "";
    for (const rawLine of parts) {
      const line = stripAnsi(rawLine);
      if (!line) continue;
      let parsed = null;
      try { parsed = JSON.parse(line); } catch {}
      if (parsed) {
        broadcast({ type: "event", event: parsed.type || parsed.event || "data", payload: parsed });
      } else {
        broadcast({ type: "text", text: line });
      }
    }
  });

  proc.onExit(({ exitCode, signal }) => {
    procReady = false;
    broadcast({ type: "status", status: "stopped", exitCode, signal });
  });
}

function ensureStarted() {
  if (!procReady) spawnCodex();
}

function handleInput(text) {
  if (!procReady || !proc) return;
  const out = text.endsWith("\n") ? text : text + "\n";
  proc.write(out);
}

function handleApprove(decision) {
  if (!procReady || !proc) return;
  const out = decision === "allow" ? config.approve.allow : config.approve.deny;
  proc.write(out);
}

function setMode(mode) {
  currentMode = mode;
  if (config.launchMode === "managed") {
    spawnCodex(mode);
  } else {
    broadcast({ type: "status", status: "mode-changed", mode, note: "direct mode does not restart codex" });
  }
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const filePath = path.join(__dirname, "public", pathname);
  if (!filePath.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : "application/javascript";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (config.authToken) {
    const q = url.parse(req.url, true).query;
    if (q.token !== config.authToken) { res.writeHead(401); res.end("Unauthorized"); return; }
  }

  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Method not allowed");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  if (config.authToken) {
    const q = url.parse(req.url, true).query;
    if (q.token !== config.authToken) { ws.close(1008, "Unauthorized"); return; }
  }

  clients.add(ws);
  ws.send(JSON.stringify({ type: "status", status: "connected", mode: currentMode }));
  ensureStarted();

  ws.on("message", (msg) => {
    let data = null;
    try { data = JSON.parse(msg.toString()); } catch { return; }
    if (data.type === "input") handleInput(data.text || "");
    if (data.type === "approve") handleApprove(data.decision);
    if (data.type === "mode") setMode(data.value || "chat");
    if (data.type === "restart") spawnCodex(currentMode);
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(config.port, () => {
  console.log(`Gateway running on http://localhost:${config.port}`);
  console.log(`Launch mode: ${config.launchMode}`);
});
