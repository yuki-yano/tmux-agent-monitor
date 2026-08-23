const sharedParser = typeof DOMParser === "undefined" ? null : new DOMParser();

const stripInvisibleChars = (value: string) => value.replace(/[\u200B\uFEFF]/g, "");

export const extractTextContentFromHtml = (lineHtml: string) => {
  if (!lineHtml) {
    return "";
  }
  if (!sharedParser) {
    return stripInvisibleChars(lineHtml.replace(/<[^>]*>/g, ""));
  }
  const parsedDocument = sharedParser.parseFromString(`<div>${lineHtml}</div>`, "text/html");
  return stripInvisibleChars(parsedDocument.body.firstElementChild?.textContent ?? "");
};

export const countCh = (value: string) => Array.from(value).length;

export const matchesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

export const isBlankLikeLine = (value: string) => stripInvisibleChars(value).trim().length === 0;
