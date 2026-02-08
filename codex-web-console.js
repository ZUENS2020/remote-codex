const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const { spawn, execFileSync } = require("child_process");
const WebSocket = require("ws");

const CONFIG_PATH = path.join(__dirname, "codex-web-console.config.json");

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.port) cfg.port = 8800;
  if (!cfg.publicDir) cfg.publicDir = path.join(__dirname, "codex-web-console-public");
  if (cfg.authToken === undefined) cfg.authToken = "";
  if (!cfg.codexPath) cfg.codexPath = "auto";
  if (!Array.isArray(cfg.codexArgs)) cfg.codexArgs = ["app-server", "--analytics-default-enabled"];
  if (!cfg.cwd) cfg.cwd = process.cwd();
  if (!cfg.logFile) cfg.logFile = "";
  if (cfg.autoReplyUnsupportedRequests === undefined) cfg.autoReplyUnsupportedRequests = true;
  if (!cfg.originator) cfg.originator = "codex_vscode";
  if (!cfg.rustLog) cfg.rustLog = "warn";
  if (!cfg.clientInfo) {
    cfg.clientInfo = { name: "codex_vscode", title: "Codex Extension", version: "0.4.71" };
  }
  return cfg;
}

const config = loadConfig();

const clients = new Set();
let child = null;
let stdoutBuffer = "";
let logStream = null;
let rpcId = 2;
const pending = new Map();
const pendingById = new Map();
let persistedAtomState = {};
let initialized = false;
const outboundQueue = [];
const INIT_ID = "1";

function logLine(line) {
  if (!config.logFile) return;
  if (!logStream) logStream = fs.createWriteStream(config.logFile, { flags: "a" });
  logStream.write(line + "\n");
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendToWebview(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "to-webview", message }));
}

function broadcastToWebviews(message) {
  const payload = JSON.stringify({ type: "to-webview", message });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function resolveSpawnCommand() {
  const exe = resolveCodexExecutable(config.codexPath);
  const isWin = process.platform === "win32";
  const lower = exe.toLowerCase();
  const isCmd = lower.endsWith(".cmd") || lower.endsWith(".bat");
  if (isWin && isCmd) {
    const needsQuote = exe.includes(" ");
    const cmdTarget = needsQuote ? `"${exe}"` : exe;
    return { command: "cmd.exe", argsPrefix: ["/d", "/s", "/c", cmdTarget] };
  }
  return { command: exe, argsPrefix: [] };
}

function findNpmBinary() {
  const isWin = process.platform === "win32";
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const nodeDir = path.dirname(process.execPath);
  if (isWin) {
    const npmCmd = path.join(nodeDir, "npm.cmd");
    if (fs.existsSync(npmCmd)) return npmCmd;
    const npmExe = path.join(nodeDir, "npm.exe");
    if (fs.existsSync(npmExe)) return npmExe;
  } else {
    const npmBin = path.join(nodeDir, "npm");
    if (fs.existsSync(npmBin)) return npmBin;
  }
  return "npm";
}

function runCommand(command, args) {
  try {
    const isWin = process.platform === "win32";
    const lower = command.toLowerCase();
    const isCmd = isWin && (lower.endsWith(".cmd") || lower.endsWith(".bat"));
    if (isCmd) {
      const quoted = [command, ...args].map((p) => {
        if (!p) return "";
        return p.includes(" ") ? `"${p}"` : p;
      }).join(" ");
      return execFileSync("cmd.exe", ["/d", "/s", "/c", quoted], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 2000
      }).trim();
    }
    return execFileSync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2000
    }).trim();
  } catch {
    return "";
  }
}

function resolveCodexExecutable(requested) {
  const trimmed = typeof requested === "string" ? requested.trim() : "";
  const lowered = trimmed.toLowerCase();
  const explicit = trimmed && lowered !== "auto" && lowered !== "codex";
  if (explicit) return trimmed;
  const fallback = trimmed || "codex";

  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;

  const isWin = process.platform === "win32";
  if (isWin) {
    const candidates = [];
    if (process.env.APPDATA) {
      candidates.push(path.join(process.env.APPDATA, "npm", "codex.cmd"));
      candidates.push(path.join(process.env.APPDATA, "npm", "codex.exe"));
    }
    if (process.env.USERPROFILE) {
      candidates.push(path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "codex.cmd"));
      candidates.push(path.join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "codex.exe"));
    }
    if (process.env.ProgramFiles) {
      candidates.push(path.join(process.env.ProgramFiles, "nodejs", "codex.cmd"));
      candidates.push(path.join(process.env.ProgramFiles, "nodejs", "codex.exe"));
    }
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  }

  const npmBin = findNpmBinary();
  const npmGlobalBin = runCommand(npmBin, ["bin", "-g"]);
  if (npmGlobalBin) {
    const binCandidates = [];
    if (process.platform === "win32") {
      binCandidates.push(path.join(npmGlobalBin, "codex.cmd"));
      binCandidates.push(path.join(npmGlobalBin, "codex.exe"));
    } else {
      binCandidates.push(path.join(npmGlobalBin, "codex"));
    }
    for (const candidate of binCandidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  }

  const npmPrefix = runCommand(npmBin, ["prefix", "-g"]) || process.env.NPM_CONFIG_PREFIX || "";
  if (npmPrefix) {
    const prefixCandidates = [];
    if (process.platform === "win32") {
      prefixCandidates.push(path.join(npmPrefix, "codex.cmd"));
      prefixCandidates.push(path.join(npmPrefix, "codex.exe"));
    } else {
      prefixCandidates.push(path.join(npmPrefix, "bin", "codex"));
    }
    for (const candidate of prefixCandidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  }

  return fallback || "codex";
}

function writeRpc(message) {
  if (!child || child.stdin.destroyed) return;
  const line = JSON.stringify(message) + "\n";
  child.stdin.write(line);
}

function sendRpc(message) {
  if (!initialized && message.method !== "initialize") {
    outboundQueue.push(message);
    return;
  }
  writeRpc(message);
}

function sendRequest(method, params) {
  const id = String(rpcId++);
  const msg = { id, method, params };
  sendRpc(msg);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }
    }, 30000);
  });
}

function sendNotification(method, params) {
  sendRpc({ method, params });
}

function handleIncomingMessage(msg) {
  if (msg && Object.prototype.hasOwnProperty.call(msg, "id") && typeof msg.method === "string") {
    // Incoming request from app-server to client
    broadcastToWebviews({ type: "mcp-request", request: { id: msg.id, method: msg.method, params: msg.params } });
    return;
  }

  if (msg && Object.prototype.hasOwnProperty.call(msg, "id")) {
    const id = String(msg.id);
    const handler = pending.get(id);
    let deliveredToWebview = false;
    if (handler) {
      pending.delete(id);
      if (msg.error) handler.reject(msg.error);
      else handler.resolve(msg.result);
    }

    if (pendingById.has(id)) {
      const ws = pendingById.get(id);
      pendingById.delete(id);
      sendToWebview(ws, { type: "mcp-response", message: { id: msg.id, result: msg.result, error: msg.error } });
      deliveredToWebview = true;
    }

    if (id === INIT_ID) {
      if (msg.error) {
        broadcast({ type: "status", status: "init_failed", error: msg.error });
        broadcastToWebviews({ type: "codex-app-server-fatal-error", errorMessage: "Initialize failed", cliErrorMessage: JSON.stringify(msg.error) });
      } else {
        initialized = true;
        while (outboundQueue.length > 0) {
          const next = outboundQueue.shift();
          writeRpc(next);
        }
        broadcast({ type: "status", status: "initialized" });
      }
    }

    if (!handler && !deliveredToWebview) {
      // Best-effort broadcast for unknown responses
      broadcastToWebviews({ type: "mcp-response", message: { id: msg.id, result: msg.result, error: msg.error } });
    }
    return;
  }

  if (msg && typeof msg.method === "string") {
    broadcastToWebviews({ type: "mcp-notification", method: msg.method, params: msg.params });
    return;
  }

  broadcast({ type: "rpc_message", message: msg });
}

function parseLinesAndHandle(chunk) {
  stdoutBuffer += chunk;
  const parts = stdoutBuffer.split(/\r\n|\n|\r/);
  stdoutBuffer = parts.pop() || "";
  for (const line of parts) {
    if (!line) continue;
    let parsed = null;
    try { parsed = JSON.parse(line); } catch {}
    if (parsed) {
      handleIncomingMessage(parsed);
    } else {
      broadcast({ type: "stdout", text: line });
    }
    logLine(line);
  }
}

function startChild() {
  const { command, argsPrefix } = resolveSpawnCommand();
  initialized = false;
  outboundQueue.length = 0;
  pendingById.clear();
  const env = { ...process.env };
  if (config.originator) env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = config.originator;
  if (config.rustLog && !env.RUST_LOG) env.RUST_LOG = config.rustLog;
  child = spawn(command, argsPrefix.concat(config.codexArgs), {
    stdio: ["pipe", "pipe", "pipe"],
    env,
    cwd: config.cwd,
    windowsHide: true
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    parseLinesAndHandle(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    broadcast({ type: "stderr", text });
  });

  child.on("exit", (code, signal) => {
    broadcast({ type: "status", status: "exit", code, signal });
    if (logStream) logStream.end();
  });

  child.on("error", (err) => {
    broadcast({ type: "status", status: "error", error: err.message });
  });

  // Initialize session
  sendRpc({
    id: INIT_ID,
    method: "initialize",
    params: {
      clientInfo: config.clientInfo,
      capabilities: { experimentalApi: true }
    }
  });
}

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
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".json": "application/json",
      ".map": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf"
    };
    const type = typeMap[ext] || "application/octet-stream";
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

const fetchControllers = new Map();

function sendPersistedAtomState(ws) {
  sendToWebview(ws, { type: "persisted-atom-sync", state: persistedAtomState });
}

async function handleFetch(ws, request) {
  const controller = new AbortController();
  fetchControllers.set(request.requestId, controller);
  try {
    const headers = request.headers || {};
    let body = request.body;
    const base64HeaderKey = Object.keys(headers).find((k) => k.toLowerCase() === "x-codex-base64");
    if (base64HeaderKey && headers[base64HeaderKey] === "1" && typeof body === "string") {
      try { body = Buffer.from(body, "base64"); } catch {}
    }
    const res = await fetch(request.url, {
      method: request.method || "GET",
      headers,
      body,
      signal: controller.signal
    });
    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    const contentType = res.headers.get("content-type") || "";
    let bodyJsonString = "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      bodyJsonString = JSON.stringify(json);
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      bodyJsonString = JSON.stringify({ base64: buf.toString("base64"), contentType });
    }
    sendToWebview(ws, {
      type: "fetch-response",
      responseType: "success",
      requestId: request.requestId,
      status: res.status,
      headers: resHeaders,
      bodyJsonString
    });
  } catch (err) {
    sendToWebview(ws, {
      type: "fetch-response",
      responseType: "error",
      requestId: request.requestId,
      status: 500,
      error: err?.message || String(err)
    });
  } finally {
    fetchControllers.delete(request.requestId);
  }
}

async function handleFetchStream(ws, request) {
  const controller = new AbortController();
  fetchControllers.set(request.requestId, controller);
  try {
    const headers = request.headers || {};
    const res = await fetch(request.url, {
      method: request.method || "GET",
      headers,
      body: request.body || undefined,
      signal: controller.signal
    });
    if (!res.body) {
      sendToWebview(ws, { type: "fetch-stream-error", requestId: request.requestId, error: "No response body" });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = null;
    let dataLines = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const data = dataLines.join("\n");
          if (data || eventName) {
            sendToWebview(ws, {
              type: "fetch-stream-event",
              requestId: request.requestId,
              event: eventName || "message",
              data
            });
          }
          eventName = null;
          dataLines = [];
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    if (dataLines.length > 0 || eventName) {
      sendToWebview(ws, {
        type: "fetch-stream-event",
        requestId: request.requestId,
        event: eventName || "message",
        data: dataLines.join("\n")
      });
    }
    sendToWebview(ws, { type: "fetch-stream-complete", requestId: request.requestId });
  } catch (err) {
    sendToWebview(ws, { type: "fetch-stream-error", requestId: request.requestId, error: err?.message || String(err) });
  } finally {
    fetchControllers.delete(request.requestId);
  }
}

function handleWebviewMessage(ws, msg) {
  if (!msg || typeof msg.type !== "string") return;
  switch (msg.type) {
    case "ready": {
      sendToWebview(ws, { type: "chat-font-settings", chatFontSize: null, chatCodeFontSize: null });
      sendToWebview(ws, { type: "custom-prompts-updated", prompts: [] });
      sendPersistedAtomState(ws);
      break;
    }
    case "persisted-atom-sync-request": {
      sendPersistedAtomState(ws);
      break;
    }
    case "persisted-atom-update": {
      const { key, value, deleted } = msg;
      if (deleted) delete persistedAtomState[key];
      else persistedAtomState[key] = value;
      broadcastToWebviews({ type: "persisted-atom-updated", key, value: deleted ? null : value, deleted: !!deleted });
      break;
    }
    case "persisted-atom-reset": {
      persistedAtomState = {};
      broadcastToWebviews({ type: "persisted-atom-sync", state: persistedAtomState });
      break;
    }
    case "mcp-request": {
      const req = msg.request;
      if (!req) break;
      const id = String(req.id);
      pendingById.set(id, ws);
      sendRpc({ id: req.id, method: req.method, params: req.params });
      break;
    }
    case "mcp-notification": {
      const req = msg.request;
      if (!req) break;
      sendNotification(req.method, req.params);
      break;
    }
    case "mcp-response": {
      const res = msg.response || msg.message;
      if (!res) break;
      sendRpc({ id: res.id, result: res.result, error: res.error });
      break;
    }
    case "fetch": {
      handleFetch(ws, msg);
      break;
    }
    case "cancel-fetch": {
      const ctrl = fetchControllers.get(msg.requestId);
      if (ctrl) ctrl.abort();
      fetchControllers.delete(msg.requestId);
      break;
    }
    case "fetch-stream": {
      handleFetchStream(ws, msg);
      break;
    }
    case "cancel-fetch-stream": {
      const ctrl = fetchControllers.get(msg.requestId);
      if (ctrl) ctrl.abort();
      fetchControllers.delete(msg.requestId);
      break;
    }
    default:
      break;
  }
}

wss.on("connection", (ws, req) => {
  if (config.authToken) {
    const q = url.parse(req.url, true).query;
    if (q.token !== config.authToken) { ws.close(1008, "Unauthorized"); return; }
  }

  clients.add(ws);
  ws.send(JSON.stringify({ type: "status", status: "connected" }));

  ws.on("message", async (msg) => {
    let data = null;
    try { data = JSON.parse(msg.toString()); } catch { return; }

    try {
      if (data.type === "from-webview") {
        handleWebviewMessage(ws, data.message);
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err?.message || String(err) }));
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(config.port, () => {
  process.stderr.write(`codex-web-console http://localhost:${config.port}\n`);
});

startChild();
