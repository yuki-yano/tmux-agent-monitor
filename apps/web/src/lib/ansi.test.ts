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

  it("normalizes Claude unicode table lines into width-agnostic rows", () => {
    const text = [
      "  ┌──────────┬──────────────┐",
      "  │ ファイル │ 役割         │",
      "  ├──────────┼──────────────┤",
      "  │ foo.ts   │ メインページ │",
      "  └──────────┴──────────────┘",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class="vde-unicode-table"');
    expect(lines[0]).toContain('class="vde-unicode-table-header"');
    expect(lines[0]).toContain("<colgroup>");
    expect(lines[0]).toContain("foo.ts");
    expect(lines[0]).toContain("メインページ");
    expect(lines[0]).not.toContain("&#x250C;");
  });

  it("keeps unicode table borders for codex agent", () => {
    const text = ["┌──┐", "│A │", "└──┘"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("&#x250C;");
    expect(lines[1]).toContain("&#x2502;");
    expect(lines[0]).not.toContain('class="vde-unicode-table"');
  });

  it("normalizes unicode table lines for unknown agent", () => {
    const text = ["┌──┬──┐", "│A │B │", "├──┼──┤", "│1 │2 │", "└──┴──┘"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "unknown" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class="vde-unicode-table"');
    expect(lines[0]).toContain('class="vde-unicode-table-cell-left">A</td>');
    expect(lines[0]).toContain('class="vde-unicode-table-cell-left">2</td>');
  });

  it("keeps wrapped Claude diff lines styled with the diff marker", () => {
    const text = [
      "  98 - very-long-line",
      "       continuation",
      "  99 + add-line",
      "       next",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[1]).toContain('class="text-latte-red"');
    expect(lines[3]).toContain('class="text-latte-green"');
  });

  it("keeps wrapped Claude context lines in diff segments neutral", () => {
    const text = [
      "  104 - old-value",
      "  105 + new-value",
      '  106            className="border"',
      '           ty-60 md:text-sm"',
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[3]).toContain('class="text-latte-text"');
  });

  it("normalizes Claude prompt block background colors", () => {
    const text = [
      "\u001b[44m❯ hello\u001b[0m",
      "\u001b[47m    \u001b[0m",
      "\u001b[47m  claude\u001b[0m",
      "output",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    const readBg = (line: string) =>
      line
        .match(/background-color:\s*([^;"']+)/i)?.[1]
        ?.trim()
        .toLowerCase() ?? null;
    const blockColor = readBg(lines[0] ?? "");
    expect(blockColor).not.toBeNull();
    expect(readBg(lines[1] ?? "")).toBe(blockColor);
    expect(readBg(lines[2] ?? "")).toBe(blockColor);
  });

  it("normalizes single-line Claude prompt background and pads full width", () => {
    const text = ["\u001b[48;2;55;55;55m❯ hello\u001b[49m", "response"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    const readBg = (line: string) =>
      line
        .match(/background-color:\s*([^;"']+)/i)?.[1]
        ?.trim()
        .toLowerCase() ?? null;
    expect(lines[0]).toContain("display:block; width:100%");
    expect(readBg(lines[0] ?? "")).not.toBeNull();
    expect(lines[1]).not.toContain("display:block; width:100%");
  });

  it("does not add Claude prompt highlight to neighboring non-highlight lines", () => {
    const text = [
      "\u001b[48;2;55;55;55m❯ hello\u001b[49m",
      "  continuation without background",
      "response",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "claude" });
    expect(lines[0]).toContain("display:block; width:100%");
    expect(lines[1]).not.toContain("display:block; width:100%");
    expect(lines[1]).not.toContain("background-color:");
    expect(lines[2]).not.toContain("display:block; width:100%");
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

  it("removes OSC/charset escape artifacts from rendered lines", () => {
    const text = [
      "\u001b(B\u001b[0;1mTip:\u001b(B\u001b[0m visit",
      "\u001b]8;;https://chatgpt.com/\u001b\\https://chatgpt.com/\u001b]8;;\u001b\\",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("Tip:");
    expect(lines[0]).not.toContain("(B");
    expect(lines[1]).toContain("https://chatgpt.com/");
    expect(lines[1]).not.toContain("]8;;");
  });

  it("renders colon-based SGR truecolor escapes without raw fragments", () => {
    const text = "\u001b[38:2::215:119:87mClaude\u001b[0m";
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("Claude");
    expect(lines[0]).not.toContain(":2::215:119:87");
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

  it("keeps codex background padding across empty lines", () => {
    const text = ["\u001b[41mfirst", "", "second"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("background-color");
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).toContain("background-color");
  });

  it("keeps codex prompt padding across trailing empty lines", () => {
    const text = ["\u001b[41m\u203A first\u001b[0m", "", ""].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("background-color");
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).not.toContain("background-color");
  });

  it("keeps codex prompt padding across consecutive empty lines in a block", () => {
    const text = ["\u001b[41m\u203A first\u001b[0m", "", "", "\u001b[41m  second\u001b[0m"].join(
      "\n",
    );
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).toContain("background-color");
    expect(lines[3]).toContain("background-color");
  });

  it("keeps codex prompt padding when continuation lines lack background", () => {
    const text = ["\u001b[41m\u203A a\u001b[0m", "  b", "", "  c", "", "output"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).toContain("background-color");
    expect(lines[3]).toContain("background-color");
    expect(lines[4]).toContain("background-color");
    expect(lines[5]).not.toContain("background-color");
  });

  it("keeps codex prompt padding through trailing whitespace-only lines before output", () => {
    const text = [
      "\u001b[41m\u203A a\u001b[0m",
      "\u001b[41m  b\u001b[0m",
      "  ",
      "\u001b[41m  c\u001b[0m",
      "  ",
      "  ",
      "output",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[4]).toContain("background-color");
    expect(lines[5]).not.toContain("background-color");
    expect(lines[6]).not.toContain("background-color");
  });

  it("handles multiple prompt blocks without bleeding into output", () => {
    const text = [
      "intro",
      "\u001b[41m\u203A a\u001b[0m",
      "\u001b[41m  b\u001b[0m",
      "  ",
      "\u001b[41m  c\u001b[0m",
      "  ",
      "  ",
      "output line",
      "",
      "\u001b[41m\u203A next\u001b[0m",
      "  ",
      "\u001b[41m  more\u001b[0m",
      "  ",
      "  ",
    ].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[1]).toContain("background-color");
    expect(lines[4]).toContain("background-color");
    expect(lines[5]).toContain("background-color");
    expect(lines[6]).not.toContain("background-color");
    expect(lines[7]).not.toContain("background-color");
    expect(lines[9]).toContain("background-color");
    expect(lines[10]).toContain("background-color");
    expect(lines[11]).toContain("background-color");
    expect(lines[12]).toContain("background-color");
    expect(lines[13]).not.toContain("background-color");
  });

  it("limits codex padding to prompt blocks when prompt markers are present", () => {
    const text = ["\u001b[41m\u203A first\u001b[0m", "", "output", ""].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).not.toContain("background-color");
    expect(lines[3]).not.toContain("background-color");
  });

  it("keeps codex background padding across consecutive empty lines", () => {
    const text = ["\u001b[41mfirst\u001b[0m", "", "", "\u001b[41msecond\u001b[0m"].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).toContain("background-color");
    expect(lines[3]).toContain("background-color");
  });

  it("pads only one trailing empty line after a codex block", () => {
    const text = ["\u001b[41mfirst\u001b[0m", "", ""].join("\n");
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("background-color");
    expect(lines[1]).toContain("background-color");
    expect(lines[2]).not.toContain("background-color");
  });

  it("normalizes codex latte background fills to the latte base", () => {
    const text = "\u001b[40mfoo\u001b[0m";
    const lines = renderAnsiLines(text, "latte", { agent: "codex" });
    expect(lines[0]).toContain("rgb(230, 233, 239)");
    expect(lines[0]).not.toContain("background-color:#4c4f69");
  });

  it("skips Claude highlight corrections when disabled", () => {
    const text = ["Update(file)", "  10 +foo", "  11 -bar"].join("\n");
    const lines = renderAnsiLines(text, "latte", {
      agent: "claude",
      highlightCorrections: { codex: true, claude: false },
    });
    expect(lines[1]).not.toContain("text-latte-green");
    expect(lines[2]).not.toContain("text-latte-red");
  });

  it("skips codex highlight padding when disabled", () => {
    const text = ["\u001b[41mfirst", "second"].join("\n");
    const lines = renderAnsiLines(text, "latte", {
      agent: "codex",
      highlightCorrections: { codex: false, claude: true },
    });
    expect(lines[0]).toContain("background-color");
    expect(lines[1]).not.toContain("background-color");
  });

  it("inserts a placeholder for empty lines", () => {
    const lines = renderAnsiLines(["foo", "", "bar"].join("\n"), "latte", {
      agent: "unknown",
    });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("&#x200B;");
  });

  it("inserts a placeholder when HTML has only tags", () => {
    const lines = renderAnsiLines("\u001b[31m\u001b[0m", "latte", {
      agent: "unknown",
    });
    expect(lines[0]).toContain("&#x200B;");
  });

  it("normalizes CRLF line endings", () => {
    const lines = renderAnsiLines("foo\r\nbar", "latte", { agent: "unknown" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("\r");
  });

  it("applies low-contrast fallback for mocha theme", () => {
    const text = "\u001b[30;40mfoo\u001b[0m";
    const lines = renderAnsiLines(text, "mocha", { agent: "claude" });
    expect(lines[0]).toMatch(/background-color:\s*(#313244|rgb\(49,\s*50,\s*68\))/);
    expect(lines[0]).toMatch(/color:\s*(#cdd6f4|rgb\(205,\s*214,\s*244\))/);
  });

  it("does not normalize codex backgrounds outside latte theme", () => {
    const text = "\u001b[40mfoo\u001b[0m";
    const lines = renderAnsiLines(text, "mocha", { agent: "codex" });
    expect(lines[0]).toContain("background-color");
    expect(lines[0]).not.toContain("rgb(230, 233, 239)");
  });
});
