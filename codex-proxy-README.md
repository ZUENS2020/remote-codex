# Codex VS Code JSON‑RPC Proxy

此工具用于抓取 VS Code Codex 扩展与本地 `codex app-server` 的 JSON‑RPC 数据流，并提供网页实时查看。

## 关键原理

- VS Code 扩展会执行 `codex app-server` 并通过 stdin/stdout 发送 JSON 行
- 我们用 `codex-proxy.cmd` 取代 `codex` 可执行文件，实现“转发 + 旁路镜像”

## 启动

```bash
node codex-proxy.js app-server --analytics-default-enabled
```

默认地址：`http://localhost:8799`

## VS Code 配置

```json
"chatgpt.cliExecutable": "C:\\path\\to\\codex-proxy.cmd"
```

## 配置文件

`codex-proxy.config.json`
- `realCodexPath`: 真实 codex 路径（例如 `codex` 或 `C:/Users/<YOU>/AppData/Roaming/npm/codex.cmd`）
- `port`: 端口（默认 8799）
- `authToken`: 可选鉴权 token
- `logFile`: 可选日志文件

示例配置：`codex-proxy.config.example.json`

## 说明

- 网页可实时显示 JSON‑RPC 事件
- 输入框可发送“原始 JSON”到 Codex（高级用法）
- 若只监控，忽略输入框即可
