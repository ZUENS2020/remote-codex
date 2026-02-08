const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const CONFIG_PATH = path.join(__dirname, "codex-proxy.config.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.port) cfg.port = 8799;
  if (!cfg.publicDir) cfg.publicDir = path.join(__dirname, "codex-proxy-public");
  if (cfg.authToken === undefined) cfg.authToken = "";
  if (!cfg.realCodexPath) cfg.realCodexPath = "codex";
  if (!cfg.logFile) cfg.logFile = "";
  return cfg;
}

const config = loadConfig();

const clients = new Set();
let child = null;
let stdoutBuffer = "";
let logStream = null;

function logLine(line) {
  if (!config.logFile) return;
  if (!logStream) {
    logStream = fs.createWriteStream(config.logFile, { flags: "a" });
  }
  logStream.write(line + "\n");
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function parseLinesAndBroadcast(chunk) {
  stdoutBuffer += chunk;
  const parts = stdoutBuffer.split(/\r\n|\n|\r/);
  stdoutBuffer = parts.pop() || "";
  for (const line of parts) {
    if (!line) continue;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch {}
    if (parsed) {
      broadcast({ type: "event", payload: parsed });
    } else {
      broadcast({ type: "text", text: line });
    }
    logLine(line);
  }
}

function resolveSpawnCommand() {
  const exe = config.realCodexPath || "codex";
  const isWin = process.platform === "win32";
  const lower = exe.toLowerCase();
  const isCmd = lower.endsWith(".cmd") || lower.endsWith(".bat");
  if (isWin && isCmd) {
    return { command: "cmd.exe", argsPrefix: ["/d", "/s", "/c", exe] };
  }
  return { command: exe, argsPrefix: [] };
}

function startChild() {
  const args = process.argv.slice(2);
  const { command, argsPrefix } = resolveSpawnCommand();
  child = spawn(command, argsPrefix.concat(args), {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stdout.write(text);
    parseLinesAndBroadcast(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    process.stderr.write(text);
    broadcast({ type: "stderr", text });
  });

  child.on("exit", (code, signal) => {
    broadcast({ type: "status", status: "exit", code, signal });
    if (logStream) logStream.end();
    process.exit(code ?? 1);
  });

  child.on("error", (err) => {
    broadcast({ type: "status", status: "error", error: err.message });
    process.stderr.write(String(err) + "\n");
  });
}

let stdinBuffer = "";
process.stdin.on("data", (chunk) => {
  if (!child) return;
  stdinBuffer += chunk.toString("utf8");
  const parts = stdinBuffer.split(/\r\n|\n|\r/);
  stdinBuffer = parts.pop() || "";
  for (const line of parts) {
    if (!line) continue;
    child.stdin.write(line + "\n");
    broadcast({ type: "tx", text: line });
  }
});

process.on("SIGINT", () => {
  if (child && !child.killed) child.kill("SIGINT");
  process.exit(0);
});

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname === "/" ? "index.html" : parsed.pathname;
  if (pathname.startsWith("/")) pathname = pathname.slice(1);
  const baseDir = path.resolve(config.publicDir);
  const filePath = path.resolve(path.join(baseDir, pathname));
  if (!filePath.startsWith(baseDir)) {
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
  ws.send(JSON.stringify({ type: "status", status: "connected" }));

  ws.on("message", (msg) => {
    let data = null;
    try { data = JSON.parse(msg.toString()); } catch { return; }
    if (data.type === "send" && typeof data.text === "string") {
      if (child && !child.stdin.destroyed) {
        const out = data.text.endsWith("\n") ? data.text : data.text + "\n";
        child.stdin.write(out);
      }
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(config.port, () => {
  process.stderr.write(`codex-proxy web ui http://localhost:${config.port}\n`);
});

startChild();
