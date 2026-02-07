# vde-monitor

Monitor tmux sessions from a mobile-friendly web UI with a single CLI. Designed for Codex CLI and Claude Code sessions running inside tmux.

## Features

- Live session list and activity state
- Screen capture (text + optional image capture on macOS terminals)
- Token-based access with optional static auth
- Rate limits
- QR code login on startup (when terminal height permits)
- Claude hooks helper CLI for event logging

## Requirements

- Node.js 24+
- tmux 2.0+ (a running tmux server is required)
- macOS is required for image capture (uses `osascript`/`screencapture`). Other OSes are text-only.
- On macOS, Screen Recording and Accessibility permissions may be required.

## Install

```bash
npm install -g vde-monitor
```

## Quick start

```bash
vde-monitor
```

The command prints a URL like (and a QR code when possible):

```
vde-monitor: http://localhost:11080/?token=...
```

Open that URL in a browser to access the UI.

Recommended access methods:

- SSH port-forward
- Tailscale
- Private LAN only (avoid exposing to the public internet)

## CLI options

```
--bind <ip>     Bind to a specific IPv4 address
--public        Bind to 0.0.0.0 instead of 127.0.0.1
--tailscale     Use the Tailscale IP when printing the URL
--no-attach     Do not auto-attach tmux panes
--port <port>   Override the server port
--web-port <p>  Override the displayed web port in the printed URL
--socket-name   tmux socket name
--socket-path   tmux socket path
```

Notes:

- `--bind` cannot be used with `--tailscale`.
- `--bind` takes priority over `--public`.
- `--tailscale` requires a Tailscale IP. The server will fail to start if it cannot be resolved.
- `--tailscale` without `--public` binds to the Tailscale IP.
- `--public` with `--tailscale` binds to `0.0.0.0` and prints a Tailscale URL.

Rotate the auth token:

```bash
vde-monitor token rotate
```

## Configuration

Config is stored at `$XDG_CONFIG_HOME/vde/monitor/config.json` (defaults to
`~/.config/vde/monitor/config.json`). It is created automatically on first run.
Auth token is stored separately at `~/.vde-monitor/token.json`.

Example (use Alacritty for image capture):

```json
{
  "screen": {
    "image": {
      "backend": "alacritty"
    }
  }
}
```

Supported image backends:
`alacritty`, `terminal`, `iterm`, `wezterm`, `ghostty`

Security defaults:

- Token auth is required for API/WebSocket access
- Default bind is `127.0.0.1` (`--public` is opt-in)

## Claude hooks helper

The repo includes a small hook logger CLI:

```bash
vde-monitor-hook <HookEventName>
```

To print a Claude hooks snippet:

```bash
vde-monitor claude hooks print
```

## Development

```bash
pnpm install
pnpm dev
```

Build the distributable package:

```bash
pnpm build
```
