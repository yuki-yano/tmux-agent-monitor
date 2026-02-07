# vde-monitor

Monitor terminal multiplexer sessions from a web UI with a single CLI.  
Built for Codex CLI and Claude Code workflows running inside tmux/WezTerm panes.

## Purpose

- Provide a single operational view for AI coding sessions running in tmux
- Reduce context switching between terminal panes and monitoring tools
- Offer safe remote interaction for active sessions from desktop/mobile browsers

## Scope

- Discover and track tmux/WezTerm pane/session state in near real time
- Expose authenticated HTTP APIs for session inspection and interaction
- Provide a web UI for monitoring, input dispatch, timeline tracking, and Git context checks
- Persist session metadata and timeline history across restarts
- Ingest Claude hook events for activity/state enrichment

## Non-goals

- Replacing tmux as a full terminal multiplexer
- Acting as a general-purpose process supervisor/orchestrator
- Providing full parity for terminal automation features on every OS
- Serving as an internet-exposed service with zero network hardening setup

## Architecture at a glance

- `@vde-monitor/server`: multiplexer integration, monitor loop, API routes, auth/rate limiting, persistence
- `@vde-monitor/web`: session list/detail UI, controls, timeline, diff/commit panels
- `vde-monitor-hook`: CLI helper that writes Claude hook JSONL events
- `@vde-monitor/shared`, `@vde-monitor/tmux`, and `@vde-monitor/wezterm`: shared contracts/config/schema and multiplexer adapter utilities

## Who should use this

- Developers running Codex CLI or Claude Code inside tmux
- Users who need lightweight remote visibility/control of coding sessions
- Teams that want session observability without adopting a heavy terminal platform

## Feature highlights

- Live session list with activity state and per-session details
- Send text, key inputs, and raw input to panes
- Session title customization
- Screen capture in text mode on all platforms, optional image mode on macOS terminals
- Image upload from the composer (attachments are inserted into the prompt automatically)
- State Timeline view (`15m` / `1h` / `6h`) with persisted history across restarts
- Per-session Git context: diff summary/file view and commit log/detail view
- Desktop sidebar pane focus action on macOS (bring terminal app to foreground and target pane)
- Token-based API auth, origin allowlist, and request rate limits
- Claude hooks helper CLI for event logging
- QR code URL output on startup when terminal height permits

## Requirements

- Node.js `24+`
- tmux `2.0+` or WezTerm with `wezterm cli` available
- macOS-only features (image capture and pane focus) require terminal automation via `osascript`
- On macOS, Screen Recording and Accessibility permissions may be required

## Install

```bash
npm install -g vde-monitor
```

## Quick start

```bash
vde-monitor
```

Startup prints a URL like:

```text
vde-monitor: http://localhost:11080/#token=...
```

Open it in a browser to access the UI.

Recommended remote access:

- SSH port-forward
- Tailscale
- Private LAN only (avoid public internet exposure)

## CLI options

```text
--bind <ip>     Bind to a specific IPv4 address
--public        Bind to 0.0.0.0 instead of 127.0.0.1
--tailscale     Use the Tailscale IP when printing the URL
--no-attach     Do not auto-attach tmux panes
--port <port>   Override the server port
--web-port <p>  Override the displayed web port in the printed URL
--socket-name   tmux socket name
--socket-path   tmux socket path
--multiplexer  multiplexer backend (`tmux` or `wezterm`)
--wezterm-cli  wezterm binary path (default: `wezterm`)
--wezterm-target wezterm CLI target (`auto` or explicit target name)
```

Host resolution notes:

- `--bind` cannot be used with `--tailscale`
- `--bind` takes priority over `--public`
- `--tailscale` requires a resolvable Tailscale IP
- `--tailscale` without `--public` binds to the Tailscale IP
- `--public` with `--tailscale` binds to `0.0.0.0` and prints a Tailscale URL

## Commands

Rotate auth token:

```bash
vde-monitor token rotate
```

Print Claude hooks snippet:

```bash
vde-monitor claude hooks print
```

Write Claude hook event JSONL:

```bash
vde-monitor-hook <HookEventName>
```

## Configuration

Config file:

- `$XDG_CONFIG_HOME/vde/monitor/config.json`
- fallback: `~/.config/vde/monitor/config.json`

Token file:

- `~/.vde-monitor/token.json`

Minimal example:

```json
{
  "bind": "127.0.0.1",
  "port": 11080,
  "allowedOrigins": [],
  "rateLimit": {
    "send": { "windowMs": 1000, "max": 10 },
    "screen": { "windowMs": 1000, "max": 10 },
    "raw": { "windowMs": 1000, "max": 200 }
  },
  "screen": {
    "mode": "text",
    "image": {
      "enabled": true,
      "backend": "terminal",
      "format": "png",
      "cropPane": true,
      "timeoutMs": 5000
    }
  },
  "multiplexer": {
    "backend": "tmux",
    "wezterm": {
      "cliPath": "wezterm",
      "target": "auto"
    }
  },
  "tmux": {
    "socketName": null,
    "socketPath": null,
    "primaryClient": null
  }
}
```

Supported multiplexer backends:
`tmux`, `wezterm`

Supported image backends:
`alacritty`, `terminal`, `iterm`, `wezterm`, `ghostty`

## Platform behavior

- Text screen capture works cross-platform
- Image capture is macOS-only
- Desktop sidebar pane focus is macOS-only
- QuickPanel does not include pane focus action

## Runtime data paths

- Session/timeline persistence: `~/.vde-monitor/state.json`
- Claude hook event logs: `~/.vde-monitor/events/<server-key>/claude.jsonl`
- Uploaded image attachments: `$TMPDIR/vde-monitor/attachments/<encoded-pane-id>/...`

## Security defaults

- Bearer token auth is required for API access
- Default bind is `127.0.0.1` (`--public` is opt-in)
- Optional origin restriction is available via `allowedOrigins`

## Development

```bash
pnpm install
pnpm dev
```

Run CI checks:

```bash
pnpm run ci
```

Build distributable package:

```bash
pnpm build
```
