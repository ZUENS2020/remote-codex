# Codex Web Tools

这个仓库包含三套工具，用于把 Codex 的终端能力变成可在浏览器/手机上操作的界面。

## 推荐使用：Codex Web Console

- 直接与 `codex app-server` 通信（JSON‑RPC）
- 内置会话管理器（查看/打开/重命名/归档）
- 支持审批面板与事件流
- 当前仅保留 **Full Access** 模式

启动：

```powershell
node codex-web-console.js
```

默认地址：`http://localhost:8800`

配置文件：`codex-web-console.config.json`
- 已默认自动查找 `codex`（`CODEX_PATH` / 常见 npm 路径 / PATH）
- 如需鉴权访问，设置 `authToken`，访问时带 `?token=YOUR_TOKEN`

示例配置：`codex-web-console.config.example.json`

## VS Code 扩展抓包工具（调试用）

`codex-proxy.js` 用于抓取 VS Code 扩展与 `codex app-server` 的 JSON‑RPC 数据流。

启动：

```bash
node codex-proxy.js app-server --analytics-default-enabled
```

默认地址：`http://localhost:8799`

配置文件：`codex-proxy.config.json`

示例配置：`codex-proxy.config.example.json`

## 旧版网关（server.js）

`server.js` 是早期 CLI 网关实现，支持 direct/managed 启动模式，仅保留以便参考。

启动：

```bash
npm install
npm run start
```

默认地址：`http://localhost:8787`

配置文件：`config.json`

示例配置：`config.example.json`

## 手机访问（Tunnel）

将本机端口通过自有 tunnel 暴露即可（此项目不内置 tunnel）。

## 发布到 GitHub 前的建议

- 使用示例配置文件，避免提交本机路径或 token
- `.gitignore` 已忽略日志、依赖、VS Code 配置和 VSIX
