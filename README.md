# Codex Web Console

把 `codex app-server` 变成手机可用的网页控制台，专注 **Full Access** 工作流。

## 功能
- 直接对接 `codex app-server`（JSON‑RPC）
- 会话管理器：查看/打开/重命名/归档/新建会话
- 审批面板 + 事件流
- 手机端适配（无横向滚动，分区滚动）

## 快速开始

```powershell
node codex-web-console.js
```

默认地址：`http://localhost:8800`

## 配置

配置文件：`codex-web-console.config.json`

常用字段：
- `port`: Web 控制台端口（默认 `8800`）
- `publicDir`: 前端目录（默认 `./codex-web-console-public`）
- `authToken`: 访问鉴权（设置后需 `?token=YOUR_TOKEN`）
- `codexPath`: Codex 可执行文件路径（默认 `auto`，会自动在 npm 安装路径与 PATH 里搜索）
- `codexArgs`: 默认为 `["app-server","--analytics-default-enabled"]`
- `cwd`: Codex 工作目录

示例配置：`codex-web-console.config.example.json`

## 手机访问

使用你自己的 tunnel 暴露端口即可（本项目不内置 tunnel）。

## 目录结构
- `codex-web-console.js`：后端服务（启动 Codex + WebSocket 转发）
- `codex-web-console-public/`：前端

## 说明
本项目仅保留 Codex Web Console，一切旧工具已移除。
