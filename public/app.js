const log = document.getElementById("log");
const statusEl = document.getElementById("status");
const modeEl = document.getElementById("mode");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const restartBtn = document.getElementById("restart");
const approveBox = document.getElementById("approve");
const allowBtn = document.getElementById("allow");
const denyBtn = document.getElementById("deny");

function appendLine(text, cls) {
  const div = document.createElement("div");
  div.className = cls || "line";
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

const wsUrl = (() => {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${location.search}`;
})();

const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  statusEl.textContent = "connected";
};

ws.onmessage = (evt) => {
  const msg = JSON.parse(evt.data);
  if (msg.type === "status") {
    statusEl.textContent = `${msg.status}${msg.mode ? " / " + msg.mode : ""}`;
  }
  if (msg.type === "text") {
    appendLine(msg.text, "text");
  }
  if (msg.type === "event") {
    appendLine(`[${msg.event}] ${JSON.stringify(msg.payload)}`, "event");
    if (msg.event === "approve" || (msg.payload && msg.payload.type === "approve")) {
      approveBox.classList.remove("hidden");
    }
  }
};

ws.onclose = () => {
  statusEl.textContent = "disconnected";
};

sendBtn.onclick = () => {
  const text = inputEl.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "input", text }));
  appendLine(`> ${text}`, "input");
  inputEl.value = "";
};

restartBtn.onclick = () => {
  ws.send(JSON.stringify({ type: "restart" }));
};

modeEl.onchange = () => {
  ws.send(JSON.stringify({ type: "mode", value: modeEl.value }));
};

allowBtn.onclick = () => {
  ws.send(JSON.stringify({ type: "approve", decision: "allow" }));
  approveBox.classList.add("hidden");
};

denyBtn.onclick = () => {
  ws.send(JSON.stringify({ type: "approve", decision: "deny" }));
  approveBox.classList.add("hidden");
};

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});
