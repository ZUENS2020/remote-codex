# Codex Web Console

这是一个独立的 Web 控制台，直接与 `codex app-server` 通信（JSON‑RPC）。不依赖 VS Code。

## 启动

1. 安装 Codex CLI（npm 全局安装即可）
2. 运行：

```powershell
node codex-web-console.js
```

默认地址：`http://localhost:8800`

## 模式

- 仅保留 **Full Access** 模式

## 配置

文件：`codex-web-console.config.json`

常用项：
- `port`: 端口（默认 8800）
- `authToken`: 可选鉴权 token
- `codexPath`: 默认为 `codex`，会自动从 `CODEX_PATH` / npm 全局路径 / PATH 解析

示例配置：`codex-web-console.config.example.json`

## Tunnel 访问

若用隧道访问，设置 `authToken`，URL 加 `?token=YOUR_TOKEN`。

## 备注

- 本控制台会自行启动 `codex app-server` 进程
- 不会附加到已有的 app-server
