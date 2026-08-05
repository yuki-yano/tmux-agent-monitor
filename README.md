# vde-monitor

Monitor tmux/WezTerm/herdr/cmux coding sessions from a browser with a single CLI.
It is designed for Codex CLI / Claude Code workflows and optimized for quick checks and control from both desktop and mobile devices.
Mobile application-grade UI/UX is a first-class goal, with touch-friendly controls and compact layouts prioritized for small screens.

Japanese version: [`README.ja.md`](README.ja.md)

## What you can do

- See active sessions in one place, with recent activity and status
- Open a session and send text, key input, or raw input to the pane
- Monitor terminal output in text mode (cross-platform except for the macOS-only cmux backend)
- Use image mode on supported macOS terminal backends (when enabled)
- Track session/repo timeline and activity history across restarts
- Inspect Git diff/commits and keep repo-scoped notes while monitoring
- Launch Codex/Claude agents into tmux or herdr sessions
- Resume existing Codex/Claude sessions on a source pane and move context to another `vw` worktree (when available)
- Switch worktree context per session when reviewing timeline, diffs, commits, and files ([`vde-worktree`](https://github.com/yuki-yano/vde-worktree) / `vw` required)
- Open Usage Dashboard to monitor provider limits pace and billing trends

## Main features

- Session List: grouped by repository/window with quick status checks, search/filter, and pin
- Session Detail: live screen view (text/image), timeline, notes, diff, commits, file navigator, worktree context switch, and input composer (text/keys/raw/image attachment)
- Timeline and context: state timeline, repo notes, git diff/commits, and file browsing
- Worktree context: inspect timeline/git/files against a selected worktree without leaving the session ([`vde-worktree`](https://github.com/yuki-yano/vde-worktree) / `vw` required)
- Agent operations: where supported by the backend, launch Codex/Claude or resume/move an existing session into another worktree context
- Multi-pane monitoring: desktop-oriented Chat Grid for side-by-side pane tracking
- Mobile-first UI/UX: primary monitor/control flows are treated as first-class for phone browsers
- PWA push notifications: per-session notification toggle (default off) plus global config-level enable/disable
- Usage Dashboard: provider-level session/weekly pace plus token/USD billing summary

## Requirements

- Node.js `24.11+`
- tmux `2.0+`, WezTerm with `wezterm cli`, herdr `0.7.1+`, or cmux `0.64.17+`
- cmux requires macOS 14 or later
- Worktree integration requires [`vde-worktree`](https://github.com/yuki-yano/vde-worktree) CLI (`vw`) and is unavailable when `vw` snapshot cannot be resolved
- macOS-only image capture and platform focus integrations require `osascript`
- On macOS, Screen Recording and Accessibility permissions may be required depending on the backend; cmux text capture/control does not require them

## Install

```bash
npx vde-monitor@latest
```

or install globally:

```bash
npm install -g vde-monitor
```

## Quick start

Run one of the following:

```bash
# Local access only (default)
npx vde-monitor@latest

# Expose on trusted private LAN (bind to 0.0.0.0)
npx vde-monitor@latest --public

# Access from Tailscale devices (prints Tailscale URL)
npx vde-monitor@latest --tailscale
```

Startup prints a URL like:

```text
vde-monitor: http://localhost:11080/#token=...
```

Open the URL in your browser.
When terminal height allows, a QR code is also printed for quick access from another device.

## First 5 minutes

1. Open the session list and choose the pane you want to monitor.
2. In session detail, confirm live output in the screen panel.
3. Send input from the composer:
   - text input
   - key input
   - raw input
4. Use timeline, notes, diff, and commits tabs to inspect progress in context.

## UI workflows

### Session Detail (single-session deep dive)

- Desktop layout: Screen + Notes on the left, Diff / Files / Commits / Worktree panels on the right.
- Mobile layout: the same sections are available via section tabs under the screen panel.
- File Navigator keeps Git-ignored entries visible in muted colors. Ignored directories are read only when explicitly expanded and normal search does not recurse into them; `.git/**` stays hidden.
- Image and HTML previews can resolve authorized local assets, including exact absolute paths from logs. Remote HTTP(S) assets are not loaded.
- Typical use:
  1. Monitor the current terminal state in the screen panel.
  2. Capture decisions and TODOs in Notes while reviewing.
  3. Validate changes through Diff and Commits, then inspect source files in File Navigator.
  4. Switch Worktree context to compare another branch/worktree view without leaving the session.
  5. Send follow-up prompts with text/keys/raw, and attach an image when needed.

### Chat Grid (parallel monitoring)

- Track multiple panes side by side in one board.
- Use candidate selection to add/remove monitored panes quickly.
- Refresh all tiles and send inputs per tile to compare multi-agent progress in real time.
- Useful when running parallel experiments or reviewing several repos/windows at once.

### Usage Dashboard (capacity and cost checks)

- Compare Codex and Claude provider snapshots in one view.
- Compare repository activity for the selected 24-hour, 7-day, or 30-day range. Active time
  measures the union of lifecycle-confirmed running periods, Agent time sums those periods across
  concurrent agents, and Completed runs counts distinct explicit completion events. Poll-only
  state fragments are excluded. These are activity metrics, not token or cost rankings.
- Treat partial coverage and unattributed activity callouts as part of the result instead of
  assuming missing observations are zero. Explicitly completed runs without a confirmed start
  event are also reported as partial coverage because their activity time is excluded.
- Use Global State Timeline (range + compact mode) to identify waiting-heavy periods.
- Review issues/warnings surfaced by providers, then jump back to Session List for action.
- Useful for deciding when to rebalance active sessions or reduce costly runs.

## Mobile device usage

Recommended access methods:

- SSH port-forward
- Tailscale
- Private LAN only

Typical flow:

1. Start `npx vde-monitor@latest` on your host machine.
2. Expose the printed URL safely:
   - `--tailscale` is recommended when available
   - `--public` only on trusted networks
3. Open the URL on your mobile device and control sessions from `SessionDetail`.

For Tailscale HTTPS access:

1. Start with Tailscale + HTTPS mode (example): `npx vde-monitor@latest --tailscale --https`.
2. On startup, answer `Run tailscale serve now? [y/N]`.
   - `y` / `yes`: runs `tailscale serve --bg <printed-web-port>` automatically.
   - default `N`: skips auto setup and prints manual recovery command.
3. If existing `tailscale serve` settings are already present, vde-monitor does not overwrite them and prints guidance instead.
4. Open `https://<device>.<tailnet>.ts.net/#token=...` (not the plain `http://100.x.x.x/...` URL).
5. Verify with `tailscale serve status`.

Notes for iOS:

- Web Push on iOS requires an installed Home Screen web app (standalone PWA mode).
- In regular Safari tabs on iOS, the session notification toggle is hidden.

## Useful commands

### Start server

```bash
npx vde-monitor@latest [options]
```

Common options:

```text
--port <port>           API/UI port
--public                Bind to 0.0.0.0
--tailscale             Use Tailscale IP for access URL
--https                 Enable Tailscale HTTPS guidance/QR (effective with `--tailscale`)
--bind <ip>             Bind to specific IPv4
--multiplexer <name>    `tmux`, `wezterm`, `herdr`, or `cmux`
--backend <name>        image backend (`alacritty`, `terminal`, `iterm`, `wezterm`, `ghostty`)
```

Advanced options:

```text
--web-port <port>       Override displayed web port in URL
--wezterm-cli <path>    wezterm binary path (default: `wezterm`)
--wezterm-target <t>    wezterm target (`auto` or explicit target)
--cmux-cli <path>       cmux binary path (default: `cmux`)
--cmux-socket <path>    Explicit cmux socket path (default: auto-detect)
--socket-name <name>    tmux socket name
--socket-path <path>    tmux socket path
```

Notes:

- Only one vde-monitor server may run per OS user. A second start exits before monitoring or
  listening, even when another port is available.
- Automatic port selection is only used when the configured port is occupied by another
  application; it does not allow multiple vde-monitor servers for the same user.
- `--bind` cannot be combined with `--tailscale`
- `--bind` takes priority over `--public`
- `--tailscale` requires a resolvable Tailscale IP
- `--tailscale` without `--public` binds to the Tailscale IP
- `--public --tailscale` binds to `0.0.0.0` and prints a Tailscale URL, with or without `--https`
- `--public --tailscale --https` still uses loopback (`127.0.0.1`) for the internal Tailscale Serve upstream
- `--https` only takes effect when used with `--tailscale` (otherwise standard HTTP guidance is shown)
- `--tailscale --https` asks before auto-running `tailscale serve --bg <port>` (default `N`)
- Existing `tailscale serve` settings are never auto-overwritten
- For HTTPS on Tailscale, use `tailscale serve` or `tailscale funnel`; plain Tailscale IP HTTP is not HTTPS

### Utility commands

```bash
npx vde-monitor@latest config init
npx vde-monitor@latest config regenerate
npx vde-monitor@latest config check
npx vde-monitor@latest config prune
npx vde-monitor@latest config prune --dry-run
npx vde-monitor@latest token rotate
npx vde-monitor@latest claude hooks print
npx vde-monitor@latest codex hooks print
npx --package vde-monitor@latest vde-monitor-hook <HookEventName>
npx --package vde-monitor@latest vde-monitor-hook codex <HookEventName>
```

- `config init`: create initial generated config only when no global config file exists
- `config regenerate`: overwrite existing global config with regenerated required template
- `config check`: validate global config (parse/schema/required generated keys/unused keys)
- `config prune`: remove unused keys from global config and rewrite as `config.yml` (YAML)
- `config prune --dry-run`: show removable keys without updating files
- `token rotate`: rotate through the owned running-server endpoint recorded in the local runtime marker, so the persisted and active tokens change together without probing other ports; if post-commit runtime cleanup is incomplete, the committed token is printed together with a warning
- `claude hooks print`: print the hooks snippet to paste into Claude Code `.claude/settings.json`
- `codex hooks print`: print the hooks snippet to paste into Codex CLI `~/.codex/hooks.json` (Codex requires trusting the hook via `/hooks` after registration)

## Configuration

Global config file:

- `$XDG_CONFIG_HOME/vde/monitor/config.yml`
- fallback: `~/.config/vde/monitor/config.yml`

Priority:

- `CLI args > global config > defaults`

Global config file discovery order:

- `config.yml > config.yaml > config.json`

Auto-generated required settings (`config.yml`):

| Key                            | Default                     | Meaning                                                                             |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------------------------- |
| `multiplexer.backend`          | `tmux`                      | Multiplexer backend (`tmux`, `wezterm`, `herdr`, or `cmux`)                         |
| `screen.image.backend`         | `terminal`                  | Image capture backend on macOS (`alacritty`/`terminal`/`iterm`/`wezterm`/`ghostty`) |
| `dangerKeys`                   | `["C-c","C-d","C-z"]`       | Blocked danger keys                                                                 |
| `dangerCommandPatterns`        | existing default regex list | Regex list for dangerous command detection                                          |
| `launch.agents.codex.options`  | `[]`                        | Default options for Codex launch                                                    |
| `launch.agents.claude.options` | `[]`                        | Default options for Claude launch                                                   |
| `workspaceTabs.displayMode`    | `all`                       | Mobile workspace tabs display mode (`all`/`pwa`/`none`)                             |

Configurable but optional settings (if omitted, runtime defaults are used):

| Key                                      | Default                                             |
| ---------------------------------------- | --------------------------------------------------- |
| `bind`                                   | `127.0.0.1`                                         |
| `port`                                   | `11080`                                             |
| `allowedOrigins`                         | `[]`                                                |
| `activity.pollIntervalMs`                | `1000`                                              |
| `activity.runningThresholdMs`            | `5000`                                              |
| `screen.maxLines`                        | `2000`                                              |
| `screen.highlightCorrection.codex`       | `true`                                              |
| `screen.highlightCorrection.claude`      | `true`                                              |
| `multiplexer.wezterm.cliPath`            | `wezterm`                                           |
| `multiplexer.wezterm.target`             | `auto`                                              |
| `multiplexer.cmux.cliPath`               | `cmux`                                              |
| `multiplexer.cmux.socketPath`            | `null` (auto-detect)                                |
| `notifications.pushEnabled`              | `true`                                              |
| `notifications.enabledEventTypes`        | `["pane.waiting_permission","pane.task_completed"]` |
| `usage.session.providers.codex.enabled`  | `true`                                              |
| `usage.session.providers.claude.enabled` | `false`                                             |
| `usage.pricing.providers.codex.enabled`  | `true`                                              |
| `usage.pricing.providers.claude.enabled` | `false`                                             |
| `fileNavigator.externalRoots`            | OS temp directories                                 |
| `fileNavigator.autoExpandMatchLimit`     | `100`                                               |
| `tmux.socketName`                        | `null`                                              |
| `tmux.socketPath`                        | `null`                                              |
| `tmux.primaryClient`                     | `null`                                              |

Notes:

- `fileNavigator.externalRoots` controls which repo-external absolute paths may be opened from logs or local preview assets. It defaults to `os.tmpdir()` and, on macOS, `/tmp`. Paths are canonicalized, so `/tmp` and `/private/tmp` are not duplicated. Set an explicit array (including `[]`) to replace the defaults.
- `config check` / `config prune` target global config only.
- `config check` exits with code `1` when any issue is found (including unused keys).
- `config prune` writes YAML to `config.yml`; when source is `config.json`, it is removed after successful write.
- Project-local config (`<repo-root>/.vde/monitor/config.*`) is no longer loaded. Move required values to global config.

### herdr backend

The herdr backend requires herdr `0.7.1+` and is enabled with either CLI args or global config:

```bash
npx vde-monitor@latest --multiplexer herdr
```

```yaml
# ~/.config/vde/monitor/config.yml
multiplexer:
  backend: herdr
```

Socket resolution order:

1. `HERDR_SOCKET_PATH`
2. `~/.config/herdr/sessions/$HERDR_SESSION/herdr.sock`
3. `~/.config/herdr/herdr.sock`

Supported:

- pane list, text capture, send text, send keys/raw input, focus pane, kill pane/window
- Codex/Claude launch through `herdr agent start`, including launch verification
- launch worktree cwd resolution through `vw` when `worktreePath` / `worktreeBranch` is used
- state detection from herdr agent status, plus Claude/Codex hook events when the agent process has `HERDR_PANE_ID`

Current limitations:

- tmux pipe mode is unavailable on herdr; hook events are read from JSONL and also reported through herdr when `HERDR_SOCKET_PATH` and `HERDR_PANE_ID` are present
- herdr does not expose tmux-style copy-mode release; input is sent without a copy-mode escape step
- herdr does not expose pane TTY or alternate-screen state through the verified socket API
- resume into a new window is unsupported on herdr; normal launch and Codex/Claude session resume arguments are supported

### cmux backend

The cmux backend requires cmux `0.64.17+` and macOS 14 or later. After installing cmux.app, run
**Install cmux CLI** from the Command Palette to add the CLI to `PATH`, then verify the installation:

```bash
cmux --version
```

Once the CLI is ready, start vde-monitor with:

```bash
npx vde-monitor@latest --multiplexer cmux
```

Or select it in the global config:

```yaml
# ~/.config/vde/monitor/config.yml
multiplexer:
  backend: cmux
  cmux:
    cliPath: cmux
    socketPath: null
```

Keep `socketPath` unset for normal use. vde-monitor asks the cmux CLI for the active socket during
startup instead of assuming a fixed filesystem path. Use `--cmux-socket` or
`multiplexer.cmux.socketPath` only when you intentionally need to select a specific cmux instance.
Use `--cmux-cli` or `multiplexer.cmux.cliPath` when the CLI is not available as `cmux` on `PATH`. For
example, the CLI bundled with the app can be selected directly:

```bash
npx vde-monitor@latest --multiplexer cmux \
  --cmux-cli /Applications/cmux.app/Contents/Resources/bin/cmux
```

An explicit `--cmux-socket` or `multiplexer.cmux.socketPath` takes precedence over an inherited
`CMUX_SOCKET_PATH`.

cmux socket access must be configured explicitly for the way vde-monitor is launched:

- Select the mode under **cmux Settings > Automation > Socket Control Mode**.
- With the default cmux-only access mode, start vde-monitor from a terminal inside cmux so it is an
  authorized descendant process.
- For a process launched outside cmux, Automation mode allows local clients running as the same
  macOS user without the descendant check. Use Password mode when authentication is required.
- For Password mode, set the `CMUX_SOCKET_PASSWORD` environment variable and configure the matching
  password in cmux. The socket password cannot be stored in the config file; a leftover
  `multiplexer.cmux.password` key is ignored and reported by `config check`.
- `allowAll` is not recommended and is intentionally rejected because it exposes the control socket
  without authentication.

The cmux backend reads and controls terminal Surfaces through the local Unix socket. Its text-only
operation does not require macOS Screen Recording or Accessibility permission. Those permissions
may still be needed when using image capture or platform integrations with another backend.

At startup, vde-monitor verifies the cmux version, access mode, socket metadata, and all required v2
socket methods. Startup fails immediately when the endpoint does not satisfy that contract; it does
not fall back to a hard-coded socket or the tmux compatibility layer.

Supported:

- terminal Surface discovery and grouping by stable cmux UUIDs
- text screen capture, text/key/raw input, focus, and close operations
- Claude/Codex hook correlation by validating the `CMUX_SURFACE_ID` injected by cmux against the
  hook parent process's controlling TTY (fail closed on mismatch or ambiguity)

Current limitations:

- capture is text-only; cmux image capture is unsupported
- browser Surfaces are excluded
- launching or resuming Codex/Claude from the UI is unsupported
- tmux pipe mode has no cmux equivalent; activity uses polling and hook events

## Transport (SSE + polling fallback)

- The web UI receives session list and text screen updates over SSE (`GET /api/streams/sessions`, `GET /api/streams/sessions/:paneId/screen`) when available.
- SSE uses `fetch` + `ReadableStream` so the `Authorization: Bearer` header is preserved. Native `EventSource` is not used.
- If the SSE connection is unavailable (proxy issues, server restart, network loss), the UI automatically falls back to the previous polling behavior (sessions: 1s, text screen: 1s) and reconnects with exponential backoff. No configuration is required.
- Image-mode screen capture and Chat Grid keep using polling by design.
- Reconnection resumes the sessions stream via `Last-Event-ID`; the screen stream restarts from a full snapshot.
- Token rotation (`POST /api/admin/token/rotate`) closes all active streams; clients reconnect with the new token.
- Rollback procedure: disabling or removing the `/api/streams/*` routes (or reverting the SSE commits) is safe — clients detect the failure and continue on polling only.

## Platform behavior

- Text screen capture works cross-platform with tmux, WezTerm, and herdr
- The cmux backend requires macOS 14 or later and supports text capture only
- Image capture is macOS-only
- Pane focus integration is macOS-only

## Runtime data paths

- Token: `~/.vde-monitor/token.json`
- Running-server ownership: `~/.vde-monitor/server-runtimes/server-runtime.<pid>.<instance>.json`
- Session/timeline persistence: `~/.vde-monitor/state.json`
- Push VAPID keys: `~/.vde-monitor/push-vapid.json`
- Push subscriptions: `~/.vde-monitor/notifications.json`
- Hook event logs: `~/.vde-monitor/events/<server-key>/claude.jsonl`, `~/.vde-monitor/events/<server-key>/codex.jsonl`
- Uploaded image attachments: `$TMPDIR/vde-monitor/attachments/<encoded-pane-id>/...`

## Security defaults

- Bearer token auth is required for API access
- Default bind host is loopback (`127.0.0.1`)
- `--public` is opt-in
- Optional origin restriction via `allowedOrigins`
- Local file previews use short-lived scoped URLs; HTML previews block scripts, network connections, frames, objects, and forms with CSP

## Development

Install:

```bash
pnpm install --frozen-lockfile
```

Run local development:

```bash
pnpm dev
pnpm dev:server
pnpm dev:web
pnpm dev:public
pnpm dev -- --tailscale  # serve the dev stack over Tailscale
```

Quality checks:

```bash
pnpm run ci
pnpm run ci:diff
pnpm run ci:fix
pnpm test
pnpm test:run
```

Build package:

```bash
pnpm build
```

`pnpm build` assembles npm-ready artifacts in `dist/`, including CLI entry files and web assets.

To rebuild `dist/` continuously while editing:

```bash
pnpm run build:watch
```

## Troubleshooting

- No sessions appear:
  - confirm the selected tmux/WezTerm/herdr/cmux backend is running
  - verify socket/target options (`--socket-name`, `--socket-path`, `--cmux-socket`, `--multiplexer`)
  - for cmux, confirm version `0.64.17+`, macOS 14+, and an allowed socket access mode
  - with cmux-only access, launch vde-monitor from inside cmux; for Password mode, set
    `CMUX_SOCKET_PASSWORD`
- URL opens but API fails:
  - check token in URL hash (`#token=...`)
  - rotate token with `npx vde-monitor@latest token rotate`
- Mobile device cannot connect:
  - re-check network path (SSH forward / Tailscale / LAN)
  - avoid exposing to public internet without hardening
