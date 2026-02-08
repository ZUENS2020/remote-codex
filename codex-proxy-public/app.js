const log = document.getElementById("log");
const statusEl = document.getElementById("status");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");

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
    statusEl.textContent = msg.status;
    return;
  }
  if (msg.type === "stderr") {
    appendLine(`stderr: ${msg.text}`, "stderr");
    return;
  }
  if (msg.type === "tx") {
    appendLine(`>> ${msg.text}`, "tx");
    return;
  }
  if (msg.type === "event") {
    appendLine(`[event] ${JSON.stringify(msg.payload)}`, "event");
    return;
  }
  if (msg.type === "text") {
    appendLine(msg.text, "text");
    return;
  }
};

ws.onclose = () => {
  statusEl.textContent = "disconnected";
};

sendBtn.onclick = () => {
  const text = inputEl.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: "send", text }));
  inputEl.value = "";
};

clearBtn.onclick = () => {
  log.innerHTML = "";
};

inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});
