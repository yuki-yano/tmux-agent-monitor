// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { renderAnsiLines } from "./ansi";

describe("renderAnsiLines", () => {
  it("keeps default ANSI rendering for non-Claude agents", () => {
    const lines = renderAnsiLines("  10 +foo", "latte", { agent: "codex" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("text-latte-green");
    expect(lines[0]).not.toContain("text-latte-red");
  });

  it("formats Claude diff lines with plain classes", () => {
    const text = ["Update(file)", "  10 +foo", "  11 -bar", "  12 baz"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[1]).toContain('class="text-latte-text"');
    expect(lines[1]).toContain('class="text-latte-green"');
    expect(lines[1]).toContain(">+foo<");
    expect(lines[2]).toContain('class="text-latte-red"');
    expect(lines[3]).toContain('class="text-latte-text"');
  });

  it("does not format line-number blocks without diff markers", () => {
    const text = ["  1 foo", "  2 bar"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[0]).not.toContain("text-latte-green");
    expect(lines[0]).not.toContain("text-latte-red");
    expect(lines[1]).not.toContain("text-latte-green");
    expect(lines[1]).not.toContain("text-latte-red");
  });

  it("strips ANSI codes and escapes HTML in Claude diff rendering", () => {
    const text = "  10 +\u001b[31m<div>\u001b[0m";
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[0]).toContain("&lt;div&gt;");
    expect(lines[0]).not.toContain("\u001b");
  });

  it("keeps ellipsis lines within a diff segment as plain text", () => {
    const text = ["  1 foo", "  2 -bar", "...", "  3 baz"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[2]).toContain("text-latte-text");
    expect(lines[2]).toContain("...");
  });

  it("normalizes bright ANSI text for Claude in latte theme", () => {
    const text = "\u001b[97mPrompt\u001b[0m";
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[0]).not.toMatch(/#eff1f5|rgb\(239, 241, 245\)/);
    expect(lines[0]).toMatch(/76,\s*79,\s*105|#4c4f69/);
  });

  it("applies background padding only for codex", () => {
    const text = ["\u001b[41mfirst", "second"].join("\n");
    const codexLines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(codexLines[0]).toContain("background-color");
    expect(codexLines[1]).toContain("background-color");

    const unknownLines = renderAnsiLines(text, "latte", { agent: "unknown" });
    expect(unknownLines[0]).toContain("background-color");
    expect(unknownLines[1]).not.toContain("background-color");
  });
});
