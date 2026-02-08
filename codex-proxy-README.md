# Codex VS Code JSON-RPC Proxy

这个代理用于抓取 VS Code Codex 扩展与本地 `codex app-server` 的 JSON‑RPC 数据流，并提供网页实时查看。

## 关键原理
- 扩展会执行 `codex app-server` 并通过 stdin/stdout 发送 JSON 行。
- 我们用 `codex-proxy.cmd` 替换 `codex` 可执行文件，实现“转发 + 旁路镜像”。

## 配置
- `codex-proxy.config.json`
  - `realCodexPath`: 真实 codex 路径（例如 `codex` 或 `C:/Users/<YOU>/AppData/Roaming/npm/codex.cmd`）
  - `port`: 网页端口（默认 8799）
  - `authToken`: 可选 token
  - `logFile`: 可选日志文件

## 启动
1. 运行代理：

```bash
node codex-proxy.js app-server --analytics-default-enabled
```

2. 在 VS Code 设置中添加：

```json
"chatgpt.cliExecutable": "C:\\path\\to\\codex-proxy.cmd"
```

3. 打开网页：

```
http://localhost:8799
```

如果设置了 token：

```
http://localhost:8799/?token=YOUR_TOKEN
```

## 说明
- 网页可实时显示 JSON‑RPC 事件。
- 输入框可发送“原始 JSON”到 Codex（高级用法）。
- 若只监控，忽略输入框即可。
