# Codex Web Console

This is a standalone web console that talks directly to `codex app-server` over JSON-RPC. It does **not** hook into VS Code.

## Start

1. Ensure Codex CLI is installed (npm global is OK).
2. The web console auto-detects `codex` from `CODEX_PATH`, common npm global locations, or `PATH`.
3. Run:

```powershell
node codex-web-console.js
```

Open `http://localhost:8800` in a browser. If you use a tunnel, forward this port.

## Full Access mode

- This console runs **Full Access** only.

## Notes

- To add auth for tunnel access, set `authToken` in `codex-web-console.config.json` and append `?token=YOUR_TOKEN` to the URL.

## Two ways to start Codex

1. Web console spawns Codex (default, recommended):
   - `node codex-web-console.js`

2. Codex CLI directly (for debugging only):
   - `codex app-server --analytics-default-enabled`

   This runs the app server in your terminal for inspection. The web console does **not** attach
   to an already-running app-server; it always spawns its own Codex process.
