import { describe, expect, it } from "vitest";

import { parseArgs, resolveHosts, resolveMultiplexerOverrides } from "./cli";

const makeFlags = (entries: Array<[string, string | boolean]>) => new Map(entries);

const baseOptions = {
  configBind: "127.0.0.1" as const,
  getLocalIP: () => "192.168.0.2",
  getTailscaleIP: () => "100.64.0.1",
};

describe("parseArgs", () => {
  it("parses command and long flags", () => {
    const result = parseArgs([
      "token",
      "rotate",
      "--public",
      "--bind",
      "192.168.0.10",
      "--port",
      "3000",
      "--multiplexer",
      "wezterm",
      "--backend",
      "wezterm",
      "--no-attach",
    ]);

    expect(result.command).toBe("token");
    expect(result.positional).toEqual(["rotate"]);
    expect(result.flags.get("--public")).toBe(true);
    expect(result.flags.get("--bind")).toBe("192.168.0.10");
    expect(result.flags.get("--port")).toBe("3000");
    expect(result.flags.get("--multiplexer")).toBe("wezterm");
    expect(result.flags.get("--backend")).toBe("wezterm");
    expect(result.flags.get("--no-attach")).toBe(true);
  });

  it("keeps unknown flags and command-less calls", () => {
    const result = parseArgs(["--foo", "bar", "--no-cache"]);

    expect(result.command).toBeNull();
    expect(result.positional).toEqual([]);
    expect(result.flags.get("--foo")).toBe("bar");
    expect(result.flags.get("--no-cache")).toBe(true);
  });

  it("ignores leading separators passed through tsx/pnpm", () => {
    const result = parseArgs(["--", "--", "--public", "--tailscale"]);

    expect(result.command).toBeNull();
    expect(result.positional).toEqual([]);
    expect(result.flags.get("--public")).toBe(true);
    expect(result.flags.get("--tailscale")).toBe(true);
  });

  it("keeps raw string values without numeric coercion", () => {
    const result = parseArgs(["--socket-name", "01", "--port", "-1"]);

    expect(result.flags.get("--socket-name")).toBe("01");
    expect(result.flags.get("--port")).toBe("-1");
  });
});

describe("resolveHosts", () => {
  it("uses default bind and localhost display when no flags", () => {
    const result = resolveHosts({ ...baseOptions, flags: makeFlags([]) });
    expect(result).toEqual({ bindHost: "127.0.0.1", displayHost: "localhost" });
  });

  it("uses local IP display when public", () => {
    const result = resolveHosts({ ...baseOptions, flags: makeFlags([["--public", true]]) });
    expect(result).toEqual({ bindHost: "0.0.0.0", displayHost: "192.168.0.2" });
  });

  it("binds to tailscale when requested", () => {
    const result = resolveHosts({ ...baseOptions, flags: makeFlags([["--tailscale", true]]) });
    expect(result).toEqual({ bindHost: "100.64.0.1", displayHost: "100.64.0.1" });
  });

  it("prints tailscale URL while binding to 0.0.0.0 when public + tailscale", () => {
    const result = resolveHosts({
      ...baseOptions,
      flags: makeFlags([
        ["--public", true],
        ["--tailscale", true],
      ]),
    });
    expect(result).toEqual({ bindHost: "0.0.0.0", displayHost: "100.64.0.1" });
  });

  it("uses bind value when provided", () => {
    const result = resolveHosts({
      ...baseOptions,
      flags: makeFlags([["--bind", "192.168.0.10"]]),
    });
    expect(result).toEqual({ bindHost: "192.168.0.10", displayHost: "192.168.0.10" });
  });

  it("rejects bind + tailscale", () => {
    expect(() =>
      resolveHosts({
        ...baseOptions,
        flags: makeFlags([
          ["--bind", "192.168.0.10"],
          ["--tailscale", true],
        ]),
      }),
    ).toThrow(/--bind and --tailscale/);
  });

  it("fails when tailscale IP is not available", () => {
    expect(() =>
      resolveHosts({
        ...baseOptions,
        getTailscaleIP: () => null,
        flags: makeFlags([["--tailscale", true]]),
      }),
    ).toThrow(/Tailscale IP not found/);
  });
});

describe("resolveMultiplexerOverrides", () => {
  it("resolves multiplexer/backend and wezterm flags", () => {
    const flags = makeFlags([
      ["--multiplexer", "wezterm"],
      ["--backend", "ghostty"],
      ["--wezterm-cli", "/opt/homebrew/bin/wezterm"],
      ["--wezterm-target", " dev "],
    ]);

    const result = resolveMultiplexerOverrides(flags);

    expect(result).toEqual({
      multiplexerBackend: "wezterm",
      screenImageBackend: "ghostty",
      weztermCliPath: "/opt/homebrew/bin/wezterm",
      weztermTarget: " dev ",
    });
  });

  it("resolves backend as screen image backend", () => {
    const flags = makeFlags([["--backend", "terminal"]]);
    const result = resolveMultiplexerOverrides(flags);
    expect(result).toEqual({ screenImageBackend: "terminal" });
  });

  it("rejects invalid multiplexer/backend values", () => {
    expect(() => resolveMultiplexerOverrides(makeFlags([["--multiplexer", "foo"]]))).toThrow(
      /--multiplexer must be one of/,
    );
    expect(() => resolveMultiplexerOverrides(makeFlags([["--backend", "foo"]]))).toThrow(
      /--backend must be one of/,
    );
  });

  it("rejects missing values for required multiplexer flags", () => {
    expect(() => resolveMultiplexerOverrides(makeFlags([["--multiplexer", true]]))).toThrow(
      /--multiplexer requires a value/,
    );
    expect(() => resolveMultiplexerOverrides(makeFlags([["--backend", true]]))).toThrow(
      /--backend requires a value/,
    );
    expect(() => resolveMultiplexerOverrides(makeFlags([["--wezterm-cli", true]]))).toThrow(
      /--wezterm-cli requires a value/,
    );
    expect(() => resolveMultiplexerOverrides(makeFlags([["--wezterm-target", true]]))).toThrow(
      /--wezterm-target requires a value/,
    );
  });
});
