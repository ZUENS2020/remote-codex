# Codex Web Control

这是一套本地网关，把 `codex` CLI 的事件流变成手机可用的网页界面。

## 两种启动方式（你要求的）

### 方式 A：直接 `codex` 命令启动（direct）
- 网关只是启动 `codex`，模式切换不会自动重启。
- 适合你已经在 CLI 里控制模式的情况。

在 `config.json` 中设置：

```json
"launchMode": "direct",
"direct": { "command": "codex", "args": [] }
```

### 方式 B：网关托管启动（managed）
- 网页切换 `Chat/Agent/Full Access` 时，网关会**重启** `codex`，带上对应模式。
- 适合你希望“在网页中切换到 Full Access”。

在 `config.json` 中设置：

```json
"launchMode": "managed",
"managed": { "commandTemplate": "codex --mode {mode}", "extraArgs": [] }
```

如果你的 `codex` CLI 模式参数不是 `--mode`，请改成你实际的命令格式。

## 安装与运行

```bash
npm install
npm run start
```

默认端口：`http://localhost:8787`

## 手机访问（tunnel）
你可以用你自己的 tunnel 把本机端口暴露到手机访问。

## 权限
- 网页端与本机 CLI 权限一致（不做额外限制）。
- 可选：在 `config.json` 中设置 `authToken`，手机访问时带 `?token=xxx`。

## 审批按钮
- 页面右下方会出现“允许/拒绝”。
- 默认发送 `y` / `n` 到 CLI，可在 `config.json` 的 `approve` 中修改。
