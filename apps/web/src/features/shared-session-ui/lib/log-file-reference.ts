type NormalizedLogReference = {
  display: string;
  normalizedPath: string | null;
  filename: string | null;
  kind: "path" | "filename" | "unknown";
};

type LogReferenceLocation = {
  line: number | null;
  column: number | null;
};

const URL_PATTERN = /^https?:\/\//i;
const LINE_COLUMN_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const LINE_COLUMN_CAPTURE_PATTERN = /:(\d+)(?::(\d+))?$/;
const HASH_LINE_COLUMN_SUFFIX_PATTERN = /#L\d+(?:C\d+)?$/i;
const HASH_LINE_COLUMN_CAPTURE_PATTERN = /#L(\d+)(?:C(\d+))?$/i;
const PAREN_POSITION_SUFFIX_PATTERN = /\(\d+(?:\s*[,:\s]\s*\d+)?\)$/;
const PAREN_POSITION_CAPTURE_PATTERN = /\((\d+)(?:\s*[,:\s]\s*(\d+))?\)$/;
const TRAILING_PUNCTUATION_PATTERN = /[.,;:!?]+$/;
const PATH_SEGMENT_PATTERN = /^\/?[^\s/]+(?:\/[^\s/]+)+$/;
const FILENAME_PATTERN = /^(?!\.)[^\s/]*\.[^\s/]+$/;
const SYMBOL_ONLY_PATTERN = /^[^A-Za-z0-9]+$/;

const LEADING_WRAPPERS = new Set(['"', "'", "`", "(", "[", "{", "<"]);
const TRAILING_WRAPPERS = new Set(['"', "'", "`", ")", "]", "}", ">"]);
const URL_TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);
const sharedParser = typeof DOMParser === "undefined" ? null : new DOMParser();

const normalizeSlash = (value: string) => value.replace(/\\/g, "/");

const trimWrappingCharacters = (value: string) => {
  let normalized = value;
  while (normalized.length > 0 && LEADING_WRAPPERS.has(normalized[0] ?? "")) {
    normalized = normalized.slice(1);
  }
  while (normalized.length > 0 && TRAILING_WRAPPERS.has(normalized[normalized.length - 1] ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const stripKnownSuffixes = (value: string) => {
  let normalized = value;
  let previous = "";
  while (previous !== normalized) {
    previous = normalized;
    normalized = normalized
      .replace(TRAILING_PUNCTUATION_PATTERN, "")
      .replace(PAREN_POSITION_SUFFIX_PATTERN, "")
      .replace(HASH_LINE_COLUMN_SUFFIX_PATTERN, "")
      .replace(LINE_COLUMN_SUFFIX_PATTERN, "")
      .replace(TRAILING_PUNCTUATION_PATTERN, "");
  }
  return normalized;
};

const normalizeRepoRelativePath = (value: string, sourceRepoRoot: string | null) => {
  if (!sourceRepoRoot || !value.startsWith("/")) {
    return value;
  }
  const normalizedRepoRoot = normalizeSlash(sourceRepoRoot).replace(/\/+$/, "");
  if (normalizedRepoRoot.length === 0) {
    return value;
  }
  if (!value.startsWith(`${normalizedRepoRoot}/`) && value !== normalizedRepoRoot) {
    return value;
  }
  const relative = value.slice(normalizedRepoRoot.length).replace(/^\/+/, "");
  return relative.length > 0 ? relative : value;
};

const normalizeTokenText = (rawToken: string, sourceRepoRoot: string | null) => {
  let normalized = rawToken.trim();
  let previous = "";
  while (previous !== normalized) {
    previous = normalized;
    normalized = stripKnownSuffixes(normalized);
    normalized = trimWrappingCharacters(normalized);
  }
  normalized = normalizeSlash(normalized);
  normalized = normalizeRepoRelativePath(normalized, sourceRepoRoot);
  normalized = normalized.replace(/^\.\/+/, "");
  return normalized.trim();
};

const toPositiveIntegerOrNull = (value: string | undefined) => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

export const extractLogReferenceLocation = (rawToken: string): LogReferenceLocation => {
  const resolveFromCandidate = (candidate: string): LogReferenceLocation | null => {
    const hashMatch = candidate.match(HASH_LINE_COLUMN_CAPTURE_PATTERN);
    if (hashMatch) {
      return {
        line: toPositiveIntegerOrNull(hashMatch[1]),
        column: toPositiveIntegerOrNull(hashMatch[2]),
      };
    }

    const parenMatch = candidate.match(PAREN_POSITION_CAPTURE_PATTERN);
    if (parenMatch) {
      return {
        line: toPositiveIntegerOrNull(parenMatch[1]),
        column: toPositiveIntegerOrNull(parenMatch[2]),
      };
    }

    const lineColumnMatch = candidate.match(LINE_COLUMN_CAPTURE_PATTERN);
    if (lineColumnMatch) {
      return {
        line: toPositiveIntegerOrNull(lineColumnMatch[1]),
        column: toPositiveIntegerOrNull(lineColumnMatch[2]),
      };
    }
    return null;
  };

  let candidate = rawToken.trim();
  candidate = trimWrappingCharacters(candidate);
  candidate = candidate.replace(TRAILING_PUNCTUATION_PATTERN, "");
  const primary = resolveFromCandidate(candidate);
  if (primary) {
    return primary;
  }

  candidate = trimWrappingCharacters(candidate);
  candidate = candidate.replace(TRAILING_PUNCTUATION_PATTERN, "");
  const secondary = resolveFromCandidate(candidate);
  if (secondary) {
    return secondary;
  }

  return {
    line: null,
    column: null,
  };
};

const extractFilenameFromPath = (path: string) => {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const filename = segments[segments.length - 1] ?? null;
  if (!filename) {
    return null;
  }
  if (!FILENAME_PATTERN.test(filename)) {
    return null;
  }
  return filename;
};

const resolveReferenceKind = (normalized: string): NormalizedLogReference["kind"] => {
  if (normalized.length === 0 || URL_PATTERN.test(normalized)) {
    return "unknown";
  }
  if (SYMBOL_ONLY_PATTERN.test(normalized)) {
    return "unknown";
  }
  if (PATH_SEGMENT_PATTERN.test(normalized)) {
    return "path";
  }
  if (FILENAME_PATTERN.test(normalized)) {
    return "filename";
  }
  return "unknown";
};

export const normalizeLogReference = (
  rawToken: string,
  options: { sourceRepoRoot: string | null },
): NormalizedLogReference => {
  const displayFallback = rawToken.trim();
  const normalized = normalizeTokenText(rawToken, options.sourceRepoRoot);
  const kind = resolveReferenceKind(normalized);
  if (kind === "path") {
    return {
      display: normalized.length > 0 ? normalized : displayFallback,
      normalizedPath: normalized,
      filename: extractFilenameFromPath(normalized),
      kind,
    };
  }
  if (kind === "filename") {
    return {
      display: normalized.length > 0 ? normalized : displayFallback,
      normalizedPath: null,
      filename: normalized,
      kind,
    };
  }
  return {
    display: displayFallback,
    normalizedPath: null,
    filename: null,
    kind: "unknown",
  };
};

const LOG_TOKEN_PATTERN = /[^\s]+/g;

const extractCandidateTokensFromText = (sourceText: string) => {
  const tokens: string[] = [];
  LOG_TOKEN_PATTERN.lastIndex = 0;
  let match = LOG_TOKEN_PATTERN.exec(sourceText);
  while (match) {
    const rawToken = match[0];
    const reference = normalizeLogReference(rawToken, { sourceRepoRoot: null });
    if (reference.kind !== "unknown") {
      tokens.push(rawToken);
    }
    match = LOG_TOKEN_PATTERN.exec(sourceText);
  }
  return tokens;
};

const buildLinkifiedTextFragment = (
  sourceText: string,
  document: Document,
  options?: {
    isLinkableToken?: (rawToken: string) => boolean;
    isActiveToken?: (rawToken: string) => boolean;
  },
) => {
  const fragment = document.createDocumentFragment();
  let hasReplacements = false;
  let cursor = 0;

  LOG_TOKEN_PATTERN.lastIndex = 0;
  let match = LOG_TOKEN_PATTERN.exec(sourceText);
  while (match) {
    const rawToken = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + rawToken.length;
    if (matchStart > cursor) {
      fragment.append(sourceText.slice(cursor, matchStart));
    }
    const reference = normalizeLogReference(rawToken, { sourceRepoRoot: null });
    const isLinkable =
      reference.kind !== "unknown" &&
      (options?.isLinkableToken ? options.isLinkableToken(rawToken) : true);
    if (!isLinkable) {
      fragment.append(rawToken);
    } else {
      const isActive = options?.isActiveToken?.(rawToken) ?? false;
      const element = document.createElement("span");
      element.textContent = rawToken;
      element.dataset.vdeFileRef = rawToken;
      element.setAttribute("role", "button");
      element.tabIndex = 0;
      element.setAttribute("aria-label", `Open file ${rawToken}`);
      element.className = [
        "cursor-pointer",
        "hover:text-latte-lavender-text",
        "focus-visible:text-latte-lavender-text",
        isActive ? "text-latte-lavender-text" : "",
      ]
        .filter((item) => item.length > 0)
        .join(" ");
      fragment.append(element);
      hasReplacements = true;
    }
    cursor = matchEnd;
    match = LOG_TOKEN_PATTERN.exec(sourceText);
  }

  if (cursor < sourceText.length) {
    fragment.append(sourceText.slice(cursor));
  }

  return {
    hasReplacements,
    fragment,
  };
};

const shouldTrimTrailingWrapper = (candidate: string, wrapper: string) => {
  const count = (target: string) => Array.from(candidate).filter((char) => char === target).length;
  if (wrapper === ")") {
    return count("(") < count(")");
  }
  if (wrapper === "]") {
    return count("[") < count("]");
  }
  if (wrapper === "}") {
    return count("{") < count("}");
  }
  if (wrapper === ">") {
    return candidate.includes("<");
  }
  return true;
};

const resolveHttpUrlToken = (rawToken: string) => {
  let startIndex = 0;
  let endIndex = rawToken.length;

  while (startIndex < endIndex && LEADING_WRAPPERS.has(rawToken[startIndex] ?? "")) {
    startIndex += 1;
  }

  while (endIndex > startIndex) {
    const trailing = rawToken[endIndex - 1] ?? "";
    if (URL_TRAILING_PUNCTUATION.has(trailing)) {
      endIndex -= 1;
      continue;
    }
    if (!TRAILING_WRAPPERS.has(trailing)) {
      break;
    }
    const candidate = rawToken.slice(startIndex, endIndex);
    if (!shouldTrimTrailingWrapper(candidate, trailing)) {
      break;
    }
    endIndex -= 1;
  }

  if (endIndex <= startIndex) {
    return null;
  }

  const urlText = rawToken.slice(startIndex, endIndex);
  if (!URL_PATTERN.test(urlText)) {
    return null;
  }

  try {
    const parsed = new URL(urlText);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return {
      prefix: rawToken.slice(0, startIndex),
      suffix: rawToken.slice(endIndex),
      urlText,
      href: parsed.href,
    };
  } catch {
    return null;
  }
};

const buildUrlLinkifiedTextFragment = (sourceText: string, document: Document) => {
  const fragment = document.createDocumentFragment();
  let hasReplacements = false;
  let cursor = 0;

  LOG_TOKEN_PATTERN.lastIndex = 0;
  let match = LOG_TOKEN_PATTERN.exec(sourceText);
  while (match) {
    const rawToken = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + rawToken.length;
    if (matchStart > cursor) {
      fragment.append(sourceText.slice(cursor, matchStart));
    }

    const resolvedUrl = resolveHttpUrlToken(rawToken);
    if (!resolvedUrl) {
      fragment.append(rawToken);
    } else {
      if (resolvedUrl.prefix.length > 0) {
        fragment.append(resolvedUrl.prefix);
      }
      const element = document.createElement("a");
      element.textContent = resolvedUrl.urlText;
      element.href = resolvedUrl.href;
      element.target = "_blank";
      element.rel = "noreferrer noopener";
      element.dataset.vdeLogUrl = resolvedUrl.urlText;
      element.className = "text-latte-lavender-text underline-offset-2 hover:underline";
      fragment.append(element);
      if (resolvedUrl.suffix.length > 0) {
        fragment.append(resolvedUrl.suffix);
      }
      hasReplacements = true;
    }

    cursor = matchEnd;
    match = LOG_TOKEN_PATTERN.exec(sourceText);
  }

  if (cursor < sourceText.length) {
    fragment.append(sourceText.slice(cursor));
  }

  return {
    hasReplacements,
    fragment,
  };
};

export const extractLogReferenceTokensFromLine = (lineHtml: string) => {
  if (!sharedParser) {
    return [];
  }
  const document = sharedParser.parseFromString(`<div>${lineHtml}</div>`, "text/html");
  const container = document.body.firstElementChild;
  if (!container) {
    return [];
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    const text = currentNode.nodeValue ?? "";
    if (text.length > 0) {
      tokens.push(...extractCandidateTokensFromText(text));
    }
    currentNode = walker.nextNode();
  }
  return tokens;
};

export const linkifyLogLineFileReferences = (
  lineHtml: string,
  options?: {
    isLinkableToken?: (rawToken: string) => boolean;
    isActiveToken?: (rawToken: string) => boolean;
  },
) => {
  if (!sharedParser) {
    return lineHtml;
  }
  const document = sharedParser.parseFromString(`<div>${lineHtml}</div>`, "text/html");
  const container = document.body.firstElementChild;
  if (!container) {
    return lineHtml;
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const rawText = textNode.nodeValue ?? "";
    if (rawText.length === 0) {
      return;
    }
    const { hasReplacements, fragment } = buildLinkifiedTextFragment(rawText, document, options);
    if (!hasReplacements) {
      return;
    }
    textNode.replaceWith(fragment);
  });

  return container.innerHTML;
};

export const linkifyLogLineHttpUrls = (lineHtml: string) => {
  if (!sharedParser) {
    return lineHtml;
  }
  if (!lineHtml.includes("http://") && !lineHtml.includes("https://")) {
    return lineHtml;
  }
  const document = sharedParser.parseFromString(`<div>${lineHtml}</div>`, "text/html");
  const container = document.body.firstElementChild;
  if (!container) {
    return lineHtml;
  }
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    if (textNode.parentElement?.closest("a")) {
      return;
    }
    const rawText = textNode.nodeValue ?? "";
    if (rawText.length === 0) {
      return;
    }
    const { hasReplacements, fragment } = buildUrlLinkifiedTextFragment(rawText, document);
    if (!hasReplacements) {
      return;
    }
    textNode.replaceWith(fragment);
  });

  return container.innerHTML;
};
