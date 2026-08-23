import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DefaultTreeAdapterTypes, parse, serialize } from "parse5";
import postcss, { type AtRule, type Declaration } from "postcss";
import valueParser from "postcss-value-parser";

import { buildPreviewResourcePath } from "./resource-url";
import type { PreviewRoot, PreviewTransformContext } from "./types";

const disabledResourceUrl = "about:blank";
const remoteUrlPattern = /^(?:https?:)?\/\//i;
const retainedSchemePattern = /^(?:data|blob):/i;
const unsupportedSchemePattern = /^[a-z][a-z\d+.-]*:/i;

const isOutsideRoot = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};

const findRootForAbsolutePath = (absolutePath: string, roots: readonly PreviewRoot[]) => {
  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync.native(absolutePath);
  } catch {
    return undefined;
  }
  return roots
    .filter((root) => !isOutsideRoot(root.canonicalPath, canonicalTarget))
    .sort((left, right) => right.canonicalPath.length - left.canonicalPath.length)
    .map((root) => ({
      root,
      relativePath: path.relative(root.canonicalPath, canonicalTarget).split(path.sep).join("/"),
    }))
    .find(
      ({ relativePath }) =>
        relativePath &&
        !relativePath.split("/").some((segment) => segment.toLowerCase() === ".git"),
    );
};

const splitPathSuffix = (value: string) => {
  const suffixIndex = value.search(/[?#]/);
  if (suffixIndex < 0) {
    return { pathValue: value, suffix: "" };
  }
  return { pathValue: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
};

const resolveFilesystemReference = (value: string) => {
  if (value.toLowerCase().startsWith("file:")) {
    try {
      const url = new URL(value);
      return { absolutePath: fileURLToPath(url), suffix: `${url.search}${url.hash}` };
    } catch {
      return undefined;
    }
  }
  if (!path.isAbsolute(value)) {
    return undefined;
  }
  const { pathValue, suffix } = splitPathSuffix(value);
  return { absolutePath: pathValue, suffix };
};

const resolveRelativeReference = (value: string, context: PreviewTransformContext) => {
  const { pathValue, suffix } = splitPathSuffix(value);
  if (!pathValue) {
    return undefined;
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathValue);
  } catch {
    return undefined;
  }
  const resourceRoot = context.roots.find((root) => root.rootId === context.resourceRootId);
  if (!resourceRoot) {
    return undefined;
  }
  const resourceDirectory = path.dirname(
    path.join(resourceRoot.canonicalPath, ...context.resourceRelativePath.split("/")),
  );
  return { absolutePath: path.resolve(resourceDirectory, decodedPath), suffix };
};

const authorizeReference = (
  reference: { absolutePath: string; suffix: string },
  context: PreviewTransformContext,
) => {
  const match = findRootForAbsolutePath(reference.absolutePath, context.roots);
  if (!match || !context.authorizeResource(match.root.rootId, match.relativePath)) {
    return disabledResourceUrl;
  }
  return `${buildPreviewResourcePath(context.ticket, match.root.rootId, match.relativePath)}${reference.suffix}`;
};

export const rewritePreviewResourceUrl = (value: string, context: PreviewTransformContext) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#") || retainedSchemePattern.test(trimmed)) {
    return value;
  }
  if (remoteUrlPattern.test(trimmed)) {
    return disabledResourceUrl;
  }
  const filesystemReference = resolveFilesystemReference(trimmed);
  if (filesystemReference) {
    return authorizeReference(filesystemReference, context);
  }
  if (unsupportedSchemePattern.test(trimmed)) {
    return disabledResourceUrl;
  }
  const relativeReference = resolveRelativeReference(trimmed, context);
  return relativeReference ? authorizeReference(relativeReference, context) : disabledResourceUrl;
};

const replaceCssValueUrls = (value: string, context: PreviewTransformContext) => {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "url") {
      return;
    }
    const rawUrl = valueParser
      .stringify(node.nodes)
      .trim()
      .replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    const rewritten = rewritePreviewResourceUrl(rawUrl, context);
    node.nodes = valueParser(
      `"${rewritten.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    ).nodes;
  });
  return valueParser.stringify(parsed.nodes);
};

const replaceImportUrl = (rule: AtRule, context: PreviewTransformContext) => {
  const parsed = valueParser(rule.params);
  const firstNode = parsed.nodes.find((node) => node.type !== "space" && node.type !== "comment");
  if (!firstNode || firstNode.type === "function") {
    rule.params = replaceCssValueUrls(rule.params, context);
    return;
  }
  if (firstNode.type !== "string" && firstNode.type !== "word") {
    return;
  }
  firstNode.value = rewritePreviewResourceUrl(firstNode.value, context);
  rule.params = valueParser.stringify(parsed.nodes);
};

export const transformPreviewCss = (css: string, context: PreviewTransformContext) => {
  const root = postcss.parse(css);
  root.walkDecls((declaration: Declaration) => {
    declaration.value = replaceCssValueUrls(declaration.value, context);
  });
  root.walkAtRules("import", (rule: AtRule) => {
    replaceImportUrl(rule, context);
  });
  return root.toString();
};

const findAttribute = (element: DefaultTreeAdapterTypes.Element, name: string) =>
  element.attrs.find((attribute) => attribute.name === name);

const rewriteAttribute = (
  element: DefaultTreeAdapterTypes.Element,
  name: string,
  context: PreviewTransformContext,
) => {
  const attribute = findAttribute(element, name);
  if (attribute) {
    attribute.value = rewritePreviewResourceUrl(attribute.value, context);
  }
};

const rewriteSrcset = (value: string, context: PreviewTransformContext) =>
  value.replace(
    /(^|,)(\s*)([^\s,]+)/g,
    (_match, separator: string, whitespace: string, url: string) =>
      `${separator}${whitespace}${rewritePreviewResourceUrl(url, context)}`,
  );

const rewriteElement = (
  element: DefaultTreeAdapterTypes.Element,
  context: PreviewTransformContext,
) => {
  if (element.tagName === "img" || element.tagName === "source") {
    rewriteAttribute(element, "src", context);
    const srcset = findAttribute(element, "srcset");
    if (srcset) {
      srcset.value = rewriteSrcset(srcset.value, context);
    }
  }
  if (element.tagName === "link") {
    const rel = findAttribute(element, "rel")?.value.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes("stylesheet")) {
      rewriteAttribute(element, "href", context);
    }
  }
  rewriteAttribute(element, "poster", context);
  const style = findAttribute(element, "style");
  if (style) {
    style.value = transformPreviewCss(`a{${style.value}}`, context).replace(/^a\{|\}$/g, "");
  }
  if (element.tagName === "style") {
    for (const child of element.childNodes) {
      if (child.nodeName === "#text" && "value" in child) {
        child.value = transformPreviewCss(child.value, context);
      }
    }
  }
};

const walkHtml = (node: DefaultTreeAdapterTypes.Node, context: PreviewTransformContext) => {
  if ("tagName" in node) {
    rewriteElement(node, context);
  }
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      walkHtml(child, context);
    }
  }
  if ("content" in node) {
    walkHtml(node.content, context);
  }
};

export const transformPreviewHtml = (html: string, context: PreviewTransformContext) => {
  const document = parse(html);
  walkHtml(document, context);
  return serialize(document);
};
