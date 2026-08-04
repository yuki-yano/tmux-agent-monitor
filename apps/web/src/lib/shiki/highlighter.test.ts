import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { codeToHtmlMock, createHighlighterMock } = vi.hoisted(() => {
  const codeToHtml = vi.fn();
  const createHighlighter = vi.fn(async () => ({
    codeToHtml,
  }));
  return {
    codeToHtmlMock: codeToHtml,
    createHighlighterMock: createHighlighter,
  };
});

vi.mock("shiki", () => ({
  createHighlighter: createHighlighterMock,
}));

import { highlightCode, resetShikiHighlighter } from "./highlighter";

describe("highlightCode", () => {
  beforeEach(() => {
    codeToHtmlMock.mockReset();
    createHighlighterMock.mockClear();
    resetShikiHighlighter();
  });

  afterEach(() => {
    resetShikiHighlighter();
  });

  it("maps language alias and theme name", async () => {
    codeToHtmlMock.mockReturnValue("<pre>ok</pre>");

    const result = await highlightCode({
      code: "const value = 1",
      lang: "ts",
      theme: "latte",
    });

    expect(result.html).toBe("<pre>ok</pre>");
    expect(codeToHtmlMock).toHaveBeenCalledWith("const value = 1", {
      lang: "typescript",
      theme: "catppuccin-latte",
    });
  });

  it("maps HTML aliases", async () => {
    codeToHtmlMock.mockReturnValue("<pre>html</pre>");

    const result = await highlightCode({
      code: "<main>Hello</main>",
      lang: "htm",
      theme: "latte",
    });

    expect(result.language).toBe("html");
    expect(codeToHtmlMock).toHaveBeenCalledWith("<main>Hello</main>", {
      lang: "html",
      theme: "catppuccin-latte",
    });
  });

  it.each(["rs", "rust"])("maps the %s alias and loads Rust highlighting", async (lang) => {
    codeToHtmlMock.mockReturnValue("<pre>rust</pre>");

    const result = await highlightCode({
      code: "fn main() {}",
      lang,
      theme: "mocha",
    });

    expect(result.language).toBe("rust");
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining(["rust"]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith("fn main() {}", {
      lang: "rust",
      theme: "catppuccin-mocha",
    });
  });

  it.each(["go", "golang"])("maps the %s alias and loads Go highlighting", async (lang) => {
    codeToHtmlMock.mockReturnValue("<pre>go</pre>");

    const result = await highlightCode({
      code: "package main\nfunc main() {}",
      lang,
      theme: "latte",
    });

    expect(result.language).toBe("go");
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining(["go"]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith("package main\nfunc main() {}", {
      lang: "go",
      theme: "catppuccin-latte",
    });
  });

  it("loads Swift highlighting", async () => {
    codeToHtmlMock.mockReturnValue("<pre>swift</pre>");

    const code = "struct App: SwiftUI.App {}";
    const result = await highlightCode({
      code,
      lang: "swift",
      theme: "mocha",
    });

    expect(result.language).toBe("swift");
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining(["swift"]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith(code, {
      lang: "swift",
      theme: "catppuccin-mocha",
    });
  });

  it("loads Nix highlighting", async () => {
    codeToHtmlMock.mockReturnValue("<pre>nix</pre>");

    const code = "{ pkgs, ... }: { environment.systemPackages = [ pkgs.git ]; }";
    const result = await highlightCode({
      code,
      lang: "nix",
      theme: "latte",
    });

    expect(result.language).toBe("nix");
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining(["nix"]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith(code, {
      lang: "nix",
      theme: "catppuccin-latte",
    });
  });

  it.each([
    ["css", "css", ":root { color-scheme: dark; }"],
    ["sql", "sql", "SELECT id FROM users;"],
    ["makefile", "make", "build:\\n\\tpnpm build"],
    ["py", "python", 'print("release")'],
    ["rb", "ruby", "class VdeMonitor < Formula; end"],
  ])("maps the %s alias and loads %s highlighting", async (alias, language, code) => {
    codeToHtmlMock.mockReturnValue(`<pre>${language}</pre>`);

    const result = await highlightCode({
      code,
      lang: alias,
      theme: "mocha",
    });

    expect(result.language).toBe(language);
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining([language]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith(code, {
      lang: language,
      theme: "catppuccin-mocha",
    });
  });

  it.each([
    ["lua", "local value = 1"],
    ["toml", 'name = "vde-monitor"'],
  ])("loads %s highlighting", async (lang, code) => {
    codeToHtmlMock.mockReturnValue(`<pre>${lang}</pre>`);

    const result = await highlightCode({
      code,
      lang,
      theme: "mocha",
    });

    expect(result.language).toBe(lang);
    expect(createHighlighterMock).toHaveBeenCalledWith({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: expect.arrayContaining([lang]),
    });
    expect(codeToHtmlMock).toHaveBeenCalledWith(code, {
      lang,
      theme: "catppuccin-mocha",
    });
  });

  it("caches highlighted html for identical input", async () => {
    codeToHtmlMock.mockReturnValue("<pre>cached</pre>");

    await highlightCode({
      code: "const value = 1",
      lang: "ts",
      theme: "latte",
    });
    await highlightCode({
      code: "const value = 1",
      lang: "ts",
      theme: "latte",
    });

    expect(createHighlighterMock).toHaveBeenCalledTimes(1);
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to txt when requested language highlight fails", async () => {
    codeToHtmlMock.mockImplementation((_, options: { lang: string }) => {
      if (options.lang === "javascript") {
        throw new Error("language not loaded");
      }
      return "<pre>txt</pre>";
    });

    const result = await highlightCode({
      code: "const value = 1",
      lang: "javascript",
      theme: "mocha",
    });

    expect(result.language).toBe("txt");
    expect(codeToHtmlMock).toHaveBeenNthCalledWith(1, "const value = 1", {
      lang: "javascript",
      theme: "catppuccin-mocha",
    });
    expect(codeToHtmlMock).toHaveBeenNthCalledWith(2, "const value = 1", {
      lang: "txt",
      theme: "catppuccin-mocha",
    });
  });
});
