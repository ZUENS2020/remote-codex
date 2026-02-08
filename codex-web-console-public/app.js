(() => {
  const el = (id) => document.getElementById(id);
  const dom = {
    connStatus: el("conn-status"),
    toggleLeft: el("toggle-left"),
    toggleRight: el("toggle-right"),
    backdrop: el("backdrop"),
    modeSelect: el("mode-select"),
    approvalSelect: el("approval-select"),
    applyMode: el("apply-mode"),
    openSessions: el("open-sessions"),
    closeSessions: el("close-sessions"),
    sessionModal: el("session-modal"),
    sessionSearch: el("session-search"),
    sessionList: el("session-list"),
    tabActive: el("tab-active"),
    tabArchived: el("tab-archived"),
    refreshSessions: el("refresh-sessions"),
    threadList: el("thread-list"),
    threadSearch: el("thread-search"),
    newThread: el("new-thread"),
    chatTitle: el("chat-title"),
    chatMeta: el("chat-meta"),
    chatBody: el("chat-body"),
    refreshThread: el("refresh-thread"),
    interruptTurn: el("interrupt-turn"),
    composerInput: el("composer-input"),
    sendMsg: el("send-msg"),
    clearChat: el("clear-chat"),
    approvalList: el("approval-list"),
    approvalCount: el("approval-count"),
    eventLog: el("event-log"),
    clearLog: el("clear-log")
  };

  const state = {
    ws: null,
    connected: false,
    nextId: 1,
    pending: new Map(),
    threads: [],
    localThreads: new Map(),
    activeThreadId: null,
    messagesByThread: new Map(),
    itemIndex: new Map(),
    approvals: [],
    activeTurnId: null,
    loadedThreads: new Set(),
    messageEls: new Map(),
    sessionsActive: [],
    sessionsArchived: [],
    sessionView: "active",
    approvalPolicy: dom.approvalSelect ? dom.approvalSelect.value : "on-request",
    mode: "full"
  };

  const LOCAL_THREADS_KEY = "codex-web-console-threads-v1";

  function loadLocalThreads() {
    try {
      const raw = localStorage.getItem(LOCAL_THREADS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      arr.forEach((t) => {
        if (t && t.id) state.localThreads.set(t.id, t);
      });
    } catch {}
  }

  function persistLocalThreads() {
    try {
      const arr = Array.from(state.localThreads.values());
      localStorage.setItem(LOCAL_THREADS_KEY, JSON.stringify(arr));
    } catch {}
  }

  function upsertLocalThread(thread, overrides = {}) {
    if (!thread || !thread.id) return;
    const existing = state.localThreads.get(thread.id) || { id: thread.id };
    const merged = {
      ...existing,
      ...thread,
      ...overrides
    };
    state.localThreads.set(thread.id, merged);
    persistLocalThreads();
  }

  function updateThreadPreview(threadId, text) {
    if (!threadId || !text) return;
    const preview = String(text).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!preview) return;
    upsertLocalThread({ id: threadId }, { preview, updatedAt: Math.floor(Date.now() / 1000) });
  }

  function getLocalThreadList(archived) {
    const items = Array.from(state.localThreads.values());
    return items.filter((t) => (archived ? !!t.archived : !t.archived));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderText(text) {
    if (!text) return "";
    const extracted = extractSystemBlocks(String(text));
    const parts = extracted.cleanText.split("```");
    const html = parts.map((part, idx) => {
      if (idx % 2 === 1) {
        const lines = part.replace(/^\n+|\n+$/g, "").split("\n");
        let lang = "";
        if (lines.length && /^[a-zA-Z0-9_-]+$/.test(lines[0].trim())) {
          lang = lines.shift().trim();
        }
        const code = escapeHtml(lines.join("\n"));
        const cls = lang ? ` class=\"lang-${lang}\"` : "";
        return `<pre><code${cls}>${code}</code></pre>`;
      }
      return renderMarkdown(part);
    });
    const systemHtml = extracted.systemBlocks.map((block, index) => {
      const title = block.title || `System info ${index + 1}`;
      return `<details class="system-block"><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(block.content)}</pre></details>`;
    }).join("");
    return html.join("") + systemHtml;
  }

  function extractSystemBlocks(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    const keep = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const match = line.match(/^\s*(system|developer|instructions|context|policy)\s*:\s*(.*)$/i);
      if (match) {
        const title = `${match[1].toUpperCase()}: ${match[2] ? match[2].trim().slice(0, 64) : "details"}`;
        const content = [];
        content.push(line);
        i += 1;
        while (i < lines.length && lines[i].trim() !== "") {
          content.push(lines[i]);
          i += 1;
        }
        blocks.push({ title, content: content.join("\n") });
        while (i < lines.length && lines[i].trim() === "") i += 1;
        continue;
      }
      keep.push(line);
      i += 1;
    }
    return { cleanText: keep.join("\n"), systemBlocks: blocks };
  }

  function renderMarkdown(block) {
    const lines = block.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const inline = (src) => {
      let s = escapeHtml(src);
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>");
      s = s.replace(/(https?:\/\/[^\s<]+)/g, "<a href=\"$1\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>");
      s = s.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
      return s;
    };

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      if (/^#{1,3}\s/.test(line)) {
        const level = line.match(/^#{1,3}/)[0].length;
        const content = line.slice(level).trim();
        out.push(`<h${level}>${inline(content)}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        out.push(`<blockquote>${inline(quoteLines.join("\n"))}</blockquote>`);
        continue;
      }

      if (/^(\*|-)\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^(\*|-)\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^(\*|-)\s+/, ""))}</li>`);
          i += 1;
        }
        out.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
          i += 1;
        }
        out.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>\s|(\*|-)\s+|\d+\.\s+)/.test(lines[i])) {
        para.push(lines[i]);
        i += 1;
      }
      out.push(`<p>${inline(para.join("<br>"))}</p>`);
    }

    return out.join("");
  }

  function logEvent(line, level = "info") {
    const item = document.createElement("div");
    item.className = "event";
    item.textContent = `[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} ${line}`;
    dom.eventLog.prepend(item);
    const max = 200;
    while (dom.eventLog.children.length > max) {
      dom.eventLog.removeChild(dom.eventLog.lastChild);
    }
  }

  function setStatus(text, ok) {
    dom.connStatus.textContent = text;
    dom.connStatus.style.color = ok ? "var(--accent)" : "var(--danger)";
    dom.connStatus.style.borderColor = ok ? "rgba(89, 211, 194, 0.4)" : "rgba(242, 109, 109, 0.4)";
    dom.connStatus.style.background = ok ? "rgba(89, 211, 194, 0.12)" : "rgba(242, 109, 109, 0.12)";
  }

  function sendWebviewMessage(message) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type: "from-webview", message }));
  }

  function mcpRequest(method, params, options = {}) {
    const id = String(state.nextId++);
    sendWebviewMessage({ type: "mcp-request", request: { id, method, params } });
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject, method });
      const timeoutMs = options.timeoutMs || 30000;
      setTimeout(() => {
        if (state.pending.has(id)) {
          state.pending.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, timeoutMs);
    });
  }

  function mcpNotify(method, params) {
    sendWebviewMessage({ type: "mcp-notification", request: { method, params } });
  }

  function getThreadMessages(threadId) {
    if (!state.messagesByThread.has(threadId)) {
      state.messagesByThread.set(threadId, []);
    }
    return state.messagesByThread.get(threadId);
  }

  function registerItemMessage(threadId, msg) {
    const messages = getThreadMessages(threadId);
    messages.push(msg);
    if (msg.itemId) state.itemIndex.set(msg.itemId, msg);
    return msg;
  }

  function renderThreads() {
    const q = dom.threadSearch.value.trim().toLowerCase();
    dom.threadList.innerHTML = "";
    const threads = state.threads.filter((t) => {
      if (!q) return true;
      const preview = (t.preview || "").toLowerCase();
      const id = (t.id || "").toLowerCase();
      return preview.includes(q) || id.includes(q);
    });
    threads.forEach((t) => {
      const item = document.createElement("div");
      item.className = "thread-item" + (t.id === state.activeThreadId ? " active" : "");
      item.dataset.threadId = t.id;
      const title = document.createElement("div");
      title.className = "thread-title";
      title.textContent = t.preview ? t.preview.slice(0, 60) : "Untitled";
      const preview = document.createElement("div");
      preview.className = "thread-preview";
      preview.textContent = t.id;
      item.appendChild(title);
      item.appendChild(preview);
      item.addEventListener("click", () => openThread(t.id));
      dom.threadList.appendChild(item);
    });
  }

  function formatTimestamp(seconds) {
    if (!seconds) return "-";
    try {
      return new Date(seconds * 1000).toLocaleString();
    } catch {
      return String(seconds);
    }
  }

  async function loadSessions(view) {
    const archived = view === "archived";
    try {
      const res = await requestThreadList(archived);
      if (res) {
        const data = res.data || res.threads || [];
        data.forEach((t) => upsertLocalThread(t));
        if (archived) state.sessionsArchived = data;
        else state.sessionsActive = data;
      } else {
        const local = getLocalThreadList(archived);
        if (archived) state.sessionsArchived = local;
        else state.sessionsActive = local;
        logEvent("Session list unavailable. Using local cache.", "warn");
      }
      renderSessionList();
    } catch (err) {
      logEvent(`Session list failed: ${err.message}`, "error");
    }
  }

  function renderSessionList() {
    if (!dom.sessionList) return;
    dom.sessionList.innerHTML = "";
    const query = dom.sessionSearch ? dom.sessionSearch.value.trim().toLowerCase() : "";
    const sessions = state.sessionView === "archived" ? state.sessionsArchived : state.sessionsActive;
    sessions.filter((s) => {
      if (!query) return true;
      return (s.preview || "").toLowerCase().includes(query) || (s.id || "").toLowerCase().includes(query);
    }).forEach((s) => {
      const item = document.createElement("div");
      item.className = "session-item";

      const title = document.createElement("div");
      title.className = "thread-title";
      title.textContent = s.preview ? s.preview.slice(0, 80) : "Untitled";
      item.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "session-meta";
      meta.textContent = `ID: ${s.id} · Updated: ${formatTimestamp(s.updatedAt)} · CWD: ${s.cwd || "-"}`;
      item.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "session-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "btn small";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", async () => {
        await openThread(s.id);
        closeSessionManager();
      });
      actions.appendChild(openBtn);

      const renameBtn = document.createElement("button");
      renameBtn.className = "btn small";
      renameBtn.textContent = "Rename";
      renameBtn.addEventListener("click", async () => {
        const name = prompt("New session name", s.preview || "");
        if (!name) return;
        try {
          await mcpRequest("thread/name/set", { threadId: s.id, name });
          await loadSessions(state.sessionView);
          await loadThreads();
        } catch (err) {
          logEvent(`Rename failed: ${err.message}`, "error");
        }
      });
      actions.appendChild(renameBtn);

      const forkBtn = document.createElement("button");
      forkBtn.className = "btn small";
      forkBtn.textContent = "Fork";
      forkBtn.addEventListener("click", async () => {
        try {
          const res = await mcpRequest("thread/fork", { threadId: s.id });
          const thread = res.thread || res;
          if (thread && thread.id) {
            state.threads.unshift(thread);
            state.loadedThreads.add(thread.id);
            await openThread(thread.id);
            await loadSessions(state.sessionView);
            renderThreads();
          }
        } catch (err) {
          logEvent(`Fork failed: ${err.message}`, "error");
        }
      });
      actions.appendChild(forkBtn);

      const archiveBtn = document.createElement("button");
      archiveBtn.className = "btn small";
      archiveBtn.textContent = state.sessionView === "archived" ? "Unarchive" : "Archive";
      archiveBtn.addEventListener("click", async () => {
        try {
          if (state.sessionView === "archived") {
            await mcpRequest("thread/unarchive", { threadId: s.id });
          } else {
            await mcpRequest("thread/archive", { threadId: s.id });
          }
          await loadSessions(state.sessionView);
          await loadThreads();
        } catch (err) {
          logEvent(`Archive failed: ${err.message}`, "error");
        }
      });
      actions.appendChild(archiveBtn);

      item.appendChild(actions);
      dom.sessionList.appendChild(item);
    });
  }

  function openSessionManager() {
    if (!dom.sessionModal) return;
    dom.sessionModal.classList.remove("hidden");
    dom.sessionModal.classList.add("show");
    state.sessionView = "active";
    if (dom.tabActive) dom.tabActive.classList.add("active");
    if (dom.tabArchived) dom.tabArchived.classList.remove("active");
    if (dom.sessionSearch) dom.sessionSearch.value = "";
    loadSessions("active");
  }

  function closeSessionManager() {
    if (!dom.sessionModal) return;
    dom.sessionModal.classList.add("hidden");
    dom.sessionModal.classList.remove("show");
  }

  function messageKey(threadId, msg) {
    return `${threadId}:${msg.itemId || ""}`;
  }

  function createMessageElement(msg, threadId) {
    const wrap = document.createElement("div");
    wrap.className = `message ${msg.role || "assistant"}`;
    if (msg.kind && msg.kind !== "message") {
      wrap.classList.add("card");
    }
    wrap.dataset.threadId = threadId;
    wrap.dataset.itemId = msg.itemId || "";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = msg.meta || (msg.role === "user" ? "You" : "Codex");
    wrap.appendChild(meta);

    const body = document.createElement("div");
    body.className = "content";
    wrap.appendChild(body);
    updateMessageElement(msg, body);
    return wrap;
  }

  function updateMessageElement(msg, bodyEl) {
    if (!bodyEl) return;
    if (msg.kind === "command") {
      const output = msg.output ? `<pre>${escapeHtml(msg.output)}</pre>` : "";
      bodyEl.innerHTML = `Command: <code>${escapeHtml(msg.command || "")}</code><br>cwd: ${escapeHtml(msg.cwd || "-")}${output}`;
      return;
    }
    if (msg.kind === "file") {
      const diff = msg.diff ? `<pre>${escapeHtml(msg.diff)}</pre>` : "";
      bodyEl.innerHTML = `File changes (${(msg.changes || []).length})${diff}`;
      return;
    }
    if (msg.kind === "tool") {
      bodyEl.innerHTML = `Tool: <code>${escapeHtml(msg.tool || "")}</code>`;
      return;
    }
    bodyEl.innerHTML = renderText(msg.text || "");
  }

  function ensureMessageRendered(msg, threadId) {
    const key = messageKey(threadId, msg);
    const cached = state.messageEls.get(key);
    if (cached) {
      updateMessageElement(msg, cached.querySelector(".content"));
      return cached;
    }
    const el = createMessageElement(msg, threadId);
    state.messageEls.set(key, el);
    dom.chatBody.appendChild(el);
    return el;
  }

  function renderMessages() {
    const messages = state.activeThreadId ? getThreadMessages(state.activeThreadId) : [];
    dom.chatBody.innerHTML = "";
    state.messageEls.clear();
    messages.forEach((msg) => {
      ensureMessageRendered(msg, state.activeThreadId);
    });
    dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
  }

  function renderApprovals() {
    dom.approvalList.innerHTML = "";
    dom.approvalCount.textContent = String(state.approvals.length);

    state.approvals.forEach((approval) => {
      const card = document.createElement("div");
      card.className = "approval-card";
      const title = document.createElement("div");
      title.className = "meta";
      title.textContent = approval.method;
      card.appendChild(title);

      const content = document.createElement("div");
      if (approval.method === "item/commandExecution/requestApproval") {
        content.innerHTML = `Command: <code>${escapeHtml(approval.params.command || "")}</code><br>cwd: ${escapeHtml(approval.params.cwd || "-")}`;
      } else if (approval.method === "item/fileChange/requestApproval") {
        content.innerHTML = `File change approval requested`;
      } else if (approval.method === "item/tool/requestUserInput") {
        content.innerHTML = `Tool input requested`;
      } else if (approval.method === "item/tool/call") {
        content.innerHTML = `Tool call: <code>${escapeHtml(approval.params.tool || "")}</code>`;
      } else {
        content.innerHTML = `Request received`;
      }
      card.appendChild(content);

      if (approval.method === "item/tool/requestUserInput") {
        const form = document.createElement("div");
        approval.params.questions.forEach((q) => {
          const block = document.createElement("div");
          block.style.marginTop = "8px";
          const label = document.createElement("div");
          label.className = "meta";
          label.textContent = q.question;
          block.appendChild(label);
          if (q.options && q.options.length) {
            const select = document.createElement("select");
            select.dataset.questionId = q.id;
            q.options.forEach((opt) => {
              const option = document.createElement("option");
              option.value = opt.label;
              option.textContent = `${opt.label} - ${opt.description}`;
              select.appendChild(option);
            });
            block.appendChild(select);
          } else {
            const input = document.createElement("input");
            input.type = "text";
            input.dataset.questionId = q.id;
            input.style.width = "100%";
            input.style.marginTop = "6px";
            block.appendChild(input);
          }
          form.appendChild(block);
        });
        card.appendChild(form);
        const actions = document.createElement("div");
        actions.className = "approval-actions";
        const sendBtn = document.createElement("button");
        sendBtn.className = "btn small primary";
        sendBtn.textContent = "Send response";
        sendBtn.addEventListener("click", () => {
          const answers = {};
          form.querySelectorAll("input, select").forEach((field) => {
            const id = field.dataset.questionId;
            if (!answers[id]) answers[id] = { answers: [] };
            if (field.value) answers[id].answers.push(field.value);
          });
          respondToApproval(approval, { answers });
        });
        actions.appendChild(sendBtn);
        card.appendChild(actions);
      } else if (approval.method === "item/tool/call") {
        const actions = document.createElement("div");
        actions.className = "approval-actions";
        const successBtn = document.createElement("button");
        successBtn.className = "btn small primary";
        successBtn.textContent = "Return success";
        successBtn.addEventListener("click", () => {
          respondToApproval(approval, { success: true, contentItems: [] });
        });
        const failBtn = document.createElement("button");
        failBtn.className = "btn small danger";
        failBtn.textContent = "Return error";
        failBtn.addEventListener("click", () => {
          respondToApproval(approval, { success: false, contentItems: [] });
        });
        actions.appendChild(successBtn);
        actions.appendChild(failBtn);
        card.appendChild(actions);
      } else {
        const actions = document.createElement("div");
        actions.className = "approval-actions";
        const acceptBtn = document.createElement("button");
        acceptBtn.className = "btn small primary";
        acceptBtn.textContent = "Accept";
        acceptBtn.addEventListener("click", () => respondToApproval(approval, { decision: "accept" }));

        const acceptSessionBtn = document.createElement("button");
        acceptSessionBtn.className = "btn small";
        acceptSessionBtn.textContent = "Accept session";
        acceptSessionBtn.addEventListener("click", () => respondToApproval(approval, { decision: "acceptForSession" }));

        const declineBtn = document.createElement("button");
        declineBtn.className = "btn small";
        declineBtn.textContent = "Decline";
        declineBtn.addEventListener("click", () => respondToApproval(approval, { decision: "decline" }));

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn small danger";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => respondToApproval(approval, { decision: "cancel" }));

        actions.appendChild(acceptBtn);
        actions.appendChild(acceptSessionBtn);
        actions.appendChild(declineBtn);
        actions.appendChild(cancelBtn);

        if (approval.method === "item/commandExecution/requestApproval" && Array.isArray(approval.params.proposedExecpolicyAmendment)) {
          const policyBtn = document.createElement("button");
          policyBtn.className = "btn small";
          policyBtn.textContent = "Accept + policy";
          policyBtn.addEventListener("click", () => respondToApproval(approval, {
            decision: {
              acceptWithExecpolicyAmendment: {
                execpolicy_amendment: approval.params.proposedExecpolicyAmendment
              }
            }
          }));
          actions.appendChild(policyBtn);
        }

        card.appendChild(actions);
      }

      dom.approvalList.appendChild(card);
    });
  }

  function respondToApproval(approval, payload) {
    sendWebviewMessage({
      type: "mcp-response",
      response: { id: approval.id, result: payload }
    });
    state.approvals = state.approvals.filter((a) => a.id !== approval.id);
    renderApprovals();
  }

  function modeToSandboxMode(mode) {
    if (mode === "full") return "danger-full-access";
    if (mode === "agent") return "workspace-write";
    return "read-only";
  }

  function modeToSandboxPolicy(mode) {
    if (mode === "full") return { type: "dangerFullAccess" };
    if (mode === "agent") return { type: "workspaceWrite", networkAccess: false, excludeSlashTmp: false, excludeTmpdirEnvVar: false, writableRoots: [] };
    return { type: "readOnly" };
  }

  async function loadThreads() {
    try {
      const res = await requestThreadList(false);
      if (res) {
        state.threads = res.data || res.threads || [];
        state.threads.forEach((t) => upsertLocalThread(t));
      } else {
        state.threads = getLocalThreadList(false);
        logEvent("Thread list unavailable. Using local cache.", "warn");
      }
      renderThreads();
    } catch (err) {
      logEvent(`Thread list failed: ${err.message}`, "error");
    }
  }

  function itemToMessage(item) {
    if (!item || !item.type) return null;
    if (item.type === "userMessage") {
      const text = (item.content || []).map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "mention") return `@${c.name}`;
        if (c.type === "skill") return `/${c.name}`;
        return "";
      }).join("\n");
      return { itemId: item.id, role: "user", text, kind: "message" };
    }
    if (item.type === "agentMessage") {
      return { itemId: item.id, role: "assistant", text: item.text, kind: "message" };
    }
    if (item.type === "plan") {
      return { itemId: item.id, role: "assistant", text: item.text, kind: "message", meta: "Plan" };
    }
    if (item.type === "commandExecution") {
      return {
        itemId: item.id,
        role: "assistant",
        kind: "command",
        meta: "Command",
        command: item.command,
        cwd: item.cwd,
        output: item.aggregatedOutput || ""
      };
    }
    if (item.type === "fileChange") {
      const diff = (item.changes || []).map((c) => `${c.path}\n${c.diff}`).join("\n\n");
      return {
        itemId: item.id,
        role: "assistant",
        kind: "file",
        meta: "File change",
        changes: item.changes || [],
        diff
      };
    }
    if (item.type === "mcpToolCall") {
      return {
        itemId: item.id,
        role: "assistant",
        kind: "tool",
        meta: "Tool call",
        tool: item.tool
      };
    }
    if (item.type === "webSearch") {
      return { itemId: item.id, role: "assistant", text: `Web search: ${item.query}`, kind: "message", meta: "Web" };
    }
    return { itemId: item.id, role: "assistant", text: `[${item.type}]`, kind: "message" };
  }

  async function openThread(threadId) {
    state.activeThreadId = threadId;
    dom.chatTitle.textContent = `Thread ${threadId.slice(0, 8)}`;
    const thread = state.threads.find((t) => t.id === threadId);
    dom.chatMeta.textContent = thread ? thread.preview || thread.id : threadId;
    upsertLocalThread(thread || { id: threadId }, { archived: false, updatedAt: Math.floor(Date.now() / 1000) });
    if (!state.loadedThreads.has(threadId)) {
      try {
        const res = await mcpRequest("thread/resume", { threadId });
        const resumed = res.thread || res;
        if (resumed && resumed.id) state.loadedThreads.add(resumed.id);
      } catch (err) {
        const msg = extractErrorMessage(err);
        logEvent(`Thread resume failed: ${msg || err.message}`, "error");
      }
    }
    if (!state.messagesByThread.has(threadId)) {
      try {
        const res = await mcpRequest("thread/read", { threadId, includeTurns: true });
        const threadData = res.thread || res;
        const messages = [];
        (threadData.turns || []).forEach((turn) => {
          (turn.items || []).forEach((item) => {
            const msg = itemToMessage(item);
            if (msg) messages.push(msg);
          });
        });
        state.messagesByThread.set(threadId, messages);
        messages.forEach((msg) => {
          if (msg.itemId) state.itemIndex.set(msg.itemId, msg);
        });
      } catch (err) {
        logEvent(`Thread read failed: ${err.message}`, "error");
      }
    }
    renderThreads();
    renderMessages();
  }

  async function createThread() {
    const params = {
      approvalPolicy: state.approvalPolicy,
      sandbox: modeToSandboxMode(state.mode)
    };
    const res = await mcpRequest("thread/start", params);
    const thread = res.thread || res;
    if (thread && thread.id) {
      state.loadedThreads.add(thread.id);
      state.threads.unshift(thread);
      upsertLocalThread(thread, { archived: false, updatedAt: Math.floor(Date.now() / 1000) });
      renderThreads();
      await openThread(thread.id);
    }
  }

  async function ensureThreadLoaded(threadId) {
    if (!threadId) return false;
    if (state.loadedThreads.has(threadId)) return true;
    try {
      const res = await mcpRequest("thread/resume", { threadId });
      const resumed = res.thread || res;
      if (resumed && resumed.id) state.loadedThreads.add(resumed.id);
      return true;
    } catch (err) {
      const msg = extractErrorMessage(err);
      logEvent(`Thread resume failed: ${msg || err.message}`, "error");
      return false;
    }
  }

  function extractErrorMessage(err) {
    if (!err) return "";
    if (typeof err === "string") return err;
    const msg = err.message || "";
    if (msg && msg.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed.message === "string") return parsed.message;
      } catch {}
    }
    return msg;
  }

  async function sendMessage() {
    const text = dom.composerInput.value.trim();
    if (!text) return;
    if (!state.activeThreadId) {
      await createThread();
      if (!state.activeThreadId) return;
    }
    const loaded = await ensureThreadLoaded(state.activeThreadId);
    if (!loaded) {
      logEvent("Active thread not loaded. Creating a new thread...", "error");
      await createThread();
      if (!state.activeThreadId) return;
    }
    const message = { itemId: `user-${Date.now()}`, role: "user", text, kind: "message" };
    registerItemMessage(state.activeThreadId, message);
    if (state.activeThreadId) {
      ensureMessageRendered(message, state.activeThreadId);
      dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
    } else {
      renderMessages();
    }
    dom.composerInput.value = "";
    updateThreadPreview(state.activeThreadId, text);

    const targetThreadId = state.activeThreadId;
    try {
      await mcpRequest("turn/start", {
        threadId: targetThreadId,
        input: [{ type: "text", text }],
        approvalPolicy: state.approvalPolicy,
        sandboxPolicy: modeToSandboxPolicy(state.mode)
      });
    } catch (err) {
      const msg = extractErrorMessage(err);
      logEvent(`Turn start failed: ${msg || err.message}`, "error");
      if (msg && msg.includes("thread not found")) {
        logEvent("Thread missing. Creating a new thread and retrying...", "error");
        try {
          const res = await mcpRequest("thread/start", {
            approvalPolicy: state.approvalPolicy,
            sandbox: modeToSandboxMode(state.mode)
          });
          const thread = res.thread || res;
          if (thread && thread.id) {
            const oldThreadId = targetThreadId;
            state.activeThreadId = thread.id;
            state.threads.unshift(thread);
            state.loadedThreads.add(thread.id);
            upsertLocalThread(thread, { archived: false, updatedAt: Math.floor(Date.now() / 1000) });

            const oldMessages = getThreadMessages(oldThreadId);
            const idx = oldMessages.indexOf(message);
            if (idx >= 0) oldMessages.splice(idx, 1);
            getThreadMessages(thread.id).push(message);
            state.itemIndex.set(message.itemId, message);

            renderThreads();
            await openThread(thread.id);

            await mcpRequest("turn/start", {
              threadId: thread.id,
              input: [{ type: "text", text }],
              approvalPolicy: state.approvalPolicy,
              sandboxPolicy: modeToSandboxPolicy(state.mode)
            });
          }
        } catch (retryErr) {
          const retryMsg = extractErrorMessage(retryErr);
          logEvent(`Retry failed: ${retryMsg || retryErr.message}`, "error");
        }
      }
    }
  }

  async function interruptTurn() {
    if (!state.activeThreadId || !state.activeTurnId) return;
    try {
      await mcpRequest("turn/interrupt", { threadId: state.activeThreadId, turnId: state.activeTurnId });
    } catch (err) {
      logEvent(`Interrupt failed: ${err.message}`, "error");
    }
  }

  function handleNotification(method, params) {
    if (method === "turn/started") {
      state.activeTurnId = params.turnId;
      logEvent(`Turn started: ${params.turnId}`);
      return;
    }
    if (method === "turn/completed") {
      logEvent(`Turn completed: ${params.turnId}`);
      return;
    }
      if (method === "item/agentMessage/delta") {
        const { itemId, threadId, delta } = params;
        const targetThread = threadId || state.activeThreadId;
        if (!targetThread) return;
        let msg = state.itemIndex.get(itemId);
        if (!msg) {
          msg = { itemId, role: "assistant", text: "", kind: "message" };
          registerItemMessage(targetThread, msg);
        }
        msg.text += delta;
        updateThreadPreview(targetThread, msg.text);
        if (targetThread === state.activeThreadId) {
          ensureMessageRendered(msg, targetThread);
          dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
        }
        return;
      }
    if (method === "item/completed") {
      const { item, threadId } = params;
      const targetThread = threadId || state.activeThreadId;
      if (!targetThread || !item) return;
      const existing = state.itemIndex.get(item.id);
      if (!existing) {
        if (item.type === "userMessage") {
          const messages = getThreadMessages(targetThread);
          const last = messages.slice().reverse().find((m) => m.role === "user");
          const text = (item.content || []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
            if (last && last.text === text && String(last.itemId || "").startsWith("user-")) {
              const oldId = last.itemId;
              last.itemId = item.id;
              state.itemIndex.set(item.id, last);
              const oldKey = `${targetThread}:${oldId}`;
              const newKey = `${targetThread}:${item.id}`;
              const el = state.messageEls.get(oldKey);
              if (el) {
                state.messageEls.delete(oldKey);
                state.messageEls.set(newKey, el);
                el.dataset.itemId = item.id;
              }
            } else {
              const msg = itemToMessage(item);
              if (msg) registerItemMessage(targetThread, msg);
          }
        } else {
          const msg = itemToMessage(item);
          if (msg) registerItemMessage(targetThread, msg);
        }
        } else if (item.type === "agentMessage") {
          existing.text = item.text;
          updateThreadPreview(targetThread, item.text);
        }
        if (targetThread === state.activeThreadId) {
          if (existing) ensureMessageRendered(existing, targetThread);
          else if (item && item.id) {
            const msg = state.itemIndex.get(item.id);
            if (msg) ensureMessageRendered(msg, targetThread);
          }
          dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
        }
        return;
      }
      if (method === "item/commandExecution/outputDelta") {
        const { itemId, threadId, delta } = params;
        const targetThread = threadId || state.activeThreadId;
        let msg = state.itemIndex.get(itemId);
      if (!msg) {
        msg = { itemId, role: "assistant", kind: "command", meta: "Command", command: "", cwd: "", output: "" };
        registerItemMessage(targetThread, msg);
        }
        msg.output = (msg.output || "") + delta;
        if (targetThread === state.activeThreadId) {
          ensureMessageRendered(msg, targetThread);
          dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
        }
        return;
      }
      if (method === "item/fileChange/outputDelta") {
        const { itemId, threadId, delta } = params;
        const targetThread = threadId || state.activeThreadId;
      let msg = state.itemIndex.get(itemId);
      if (!msg) {
        msg = { itemId, role: "assistant", kind: "file", meta: "File change", changes: [], diff: "" };
        registerItemMessage(targetThread, msg);
        }
        msg.diff = (msg.diff || "") + delta;
        if (targetThread === state.activeThreadId) {
          ensureMessageRendered(msg, targetThread);
          dom.chatBody.scrollTop = dom.chatBody.scrollHeight;
        }
        return;
      }

    logEvent(`Notify ${method}`);
  }

  function isTimeoutError(err) {
    return !!(err && err.message && err.message.includes("Timeout waiting for"));
  }

  async function requestThreadList(archived) {
    try {
      return await mcpRequest("thread/list", { archived, limit: 200 }, { timeoutMs: 8000 });
    } catch (err) {
      if (!isTimeoutError(err)) {
        try {
          return await mcpRequest("thread/list", {}, { timeoutMs: 8000 });
        } catch {}
      }
      return null;
    }
  }

  function handleServerRequest(req) {
    state.approvals.push({ id: req.id, method: req.method, params: req.params });
    renderApprovals();
    logEvent(`Approval requested: ${req.method}`);
  }

  function handleResponse(response) {
    const { id, result, error } = response;
    const pending = state.pending.get(String(id));
    if (pending) {
      state.pending.delete(String(id));
      if (error) pending.reject(new Error(JSON.stringify(error)));
      else pending.resolve(result);
    } else {
      logEvent(`Response ${id}`);
    }
  }

  function connect() {
    const token = new URLSearchParams(location.search).get("token");
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    state.ws = new WebSocket(wsUrl);
    setStatus("Connecting...", true);

    state.ws.addEventListener("open", () => {
      state.connected = true;
      setStatus("Connected", true);
      sendWebviewMessage({ type: "ready" });
      loadThreads();
      logEvent("WebSocket connected");
    });

    state.ws.addEventListener("close", () => {
      state.connected = false;
      setStatus("Disconnected", false);
      logEvent("WebSocket disconnected", "error");
      setTimeout(connect, 2000);
    });

    state.ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "to-webview") {
        const msg = data.message;
        if (msg.type === "mcp-notification") {
          handleNotification(msg.method, msg.params);
        } else if (msg.type === "mcp-response") {
          handleResponse(msg.message || msg.response || msg);
        } else if (msg.type === "mcp-request") {
          handleServerRequest(msg.request);
        } else if (msg.type === "codex-app-server-fatal-error") {
          logEvent(`Fatal: ${msg.errorMessage || ""}`, "error");
        }
        return;
      }
      if (data.type === "stdout") logEvent(data.text, "stdout");
      if (data.type === "stderr") logEvent(data.text, "stderr");
      if (data.type === "status") {
        logEvent(`Status: ${data.status}`);
      }
    });
  }

  dom.threadSearch.addEventListener("input", renderThreads);
  dom.newThread.addEventListener("click", createThread);
  dom.sendMsg.addEventListener("click", sendMessage);
  dom.composerInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      sendMessage();
    }
  });
  dom.refreshThread.addEventListener("click", () => {
    loadThreads();
    if (state.activeThreadId) openThread(state.activeThreadId);
  });
  dom.clearChat.addEventListener("click", () => {
    if (!state.activeThreadId) return;
    state.messagesByThread.set(state.activeThreadId, []);
    renderMessages();
  });
  dom.clearLog.addEventListener("click", () => {
    dom.eventLog.innerHTML = "";
  });
  dom.interruptTurn.addEventListener("click", interruptTurn);

  if (dom.openSessions) {
    dom.openSessions.addEventListener("click", openSessionManager);
  }
  if (dom.closeSessions) {
    dom.closeSessions.addEventListener("click", closeSessionManager);
  }
  if (dom.sessionSearch) {
    dom.sessionSearch.addEventListener("input", renderSessionList);
  }
  if (dom.tabActive) {
    dom.tabActive.addEventListener("click", () => {
      state.sessionView = "active";
      dom.tabActive.classList.add("active");
      if (dom.tabArchived) dom.tabArchived.classList.remove("active");
      loadSessions("active");
    });
  }
  if (dom.tabArchived) {
    dom.tabArchived.addEventListener("click", () => {
      state.sessionView = "archived";
      dom.tabArchived.classList.add("active");
      if (dom.tabActive) dom.tabActive.classList.remove("active");
      loadSessions("archived");
    });
  }
  if (dom.refreshSessions) {
    dom.refreshSessions.addEventListener("click", () => {
      loadSessions(state.sessionView);
    });
  }
  if (dom.sessionModal) {
    dom.sessionModal.addEventListener("click", (ev) => {
      if (ev.target === dom.sessionModal) closeSessionManager();
    });
  }

  if (dom.applyMode && dom.modeSelect) {
    dom.applyMode.addEventListener("click", () => {
      state.mode = dom.modeSelect.value;
      if (dom.approvalSelect) state.approvalPolicy = dom.approvalSelect.value;
      logEvent(`Mode set: ${state.mode}, approval: ${state.approvalPolicy}`);
    });
  }

  if (dom.approvalSelect) {
    dom.approvalSelect.addEventListener("change", () => {
      state.approvalPolicy = dom.approvalSelect.value;
      logEvent(`Approval set: ${state.approvalPolicy}`);
    });
  }

  dom.toggleLeft.addEventListener("click", () => {
    document.body.classList.toggle("show-left");
    document.body.classList.remove("show-right");
  });

  dom.toggleRight.addEventListener("click", () => {
    document.body.classList.toggle("show-right");
    document.body.classList.remove("show-left");
  });

  dom.backdrop.addEventListener("click", () => {
    document.body.classList.remove("show-left", "show-right");
  });

  loadLocalThreads();
  connect();
})();
