import { createHighlighter } from "shiki";

type HighlightTheme = "latte" | "mocha";

type HighlightInput = {
  code: string;
  lang: string | null;
  theme: HighlightTheme;
};

type HighlightResult = {
  html: string;
  language: string;
};

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

const MAX_CACHE_ENTRIES = 200;

const themeByName: Record<HighlightTheme, "catppuccin-latte" | "catppuccin-mocha"> = {
  latte: "catppuccin-latte",
  mocha: "catppuccin-mocha",
};

const languageAliasMap: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  diff: "diff",
  patch: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
  swift: "swift",
  nix: "nix",
  lua: "lua",
  toml: "toml",
  text: "txt",
  txt: "txt",
  plaintext: "txt",
};

const highlightCache = new Map<string, HighlightResult>();
let highlighterPromise: Promise<ShikiHighlighter> | null = null;

const normalizeLanguage = (lang: string | null) => {
  if (!lang) {
    return "txt";
  }
  const normalized = lang.trim().toLowerCase();
  return languageAliasMap[normalized] ?? "txt";
};

const buildCacheKey = ({ code, lang, theme }: HighlightInput) => {
  const normalizedLanguage = normalizeLanguage(lang);
  return {
    cacheKey: `${theme}:${normalizedLanguage}:${code}`,
    normalizedLanguage,
  };
};

const getHighlighter = async () => {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["catppuccin-latte", "catppuccin-mocha"],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "json",
        "yaml",
        "bash",
        "markdown",
        "html",
        "diff",
        "dockerfile",
        "go",
        "rust",
        "swift",
        "nix",
        "lua",
        "toml",
        "txt",
      ],
    });
  }
  return highlighterPromise;
};

const setCache = (key: string, value: HighlightResult) => {
  if (highlightCache.has(key)) {
    highlightCache.delete(key);
  }
  highlightCache.set(key, value);
  if (highlightCache.size <= MAX_CACHE_ENTRIES) {
    return;
  }
  const oldestKey = highlightCache.keys().next().value;
  if (oldestKey) {
    highlightCache.delete(oldestKey);
  }
};

export const resetShikiHighlighter = () => {
  highlighterPromise = null;
  highlightCache.clear();
};

export const peekHighlightedCode = (input: HighlightInput): HighlightResult | null => {
  const { cacheKey } = buildCacheKey(input);
  return highlightCache.get(cacheKey) ?? null;
};

export const highlightCode = async ({
  code,
  lang,
  theme,
}: HighlightInput): Promise<HighlightResult> => {
  const { cacheKey, normalizedLanguage } = buildCacheKey({ code, lang, theme });
  const cached = highlightCache.get(cacheKey);
  if (cached) {
    setCache(cacheKey, cached);
    return cached;
  }

  const highlighter = await getHighlighter();
  try {
    const html = highlighter.codeToHtml(code, {
      lang: normalizedLanguage,
      theme: themeByName[theme],
    });
    const result: HighlightResult = {
      html,
      language: normalizedLanguage,
    };
    setCache(cacheKey, result);
    return result;
  } catch (error) {
    if (normalizedLanguage !== "txt") {
      const html = highlighter.codeToHtml(code, {
        lang: "txt",
        theme: themeByName[theme],
      });
      const result: HighlightResult = {
        html,
        language: "txt",
      };
      setCache(cacheKey, result);
      return result;
    }
    throw error;
  }
};
