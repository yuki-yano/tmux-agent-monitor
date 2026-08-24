import type { RepoFileSearchPage } from "@vde-monitor/shared";

import { normalizeRepoFilePath } from "./session-files-query-runtime";

export const createFilesLookupController = () => ({
  generation: 0,
  invocation: 0,
  positive: new Map<string, boolean>(),
  inFlight: new Map<string, Promise<boolean>>(),
});
export type FilesLookupController = ReturnType<typeof createFilesLookupController>;

export const advanceFilesLookupGeneration = (controller: FilesLookupController) => {
  controller.generation += 1;
  controller.inFlight.clear();
};

export const resetFilesLookupController = (controller: FilesLookupController) => {
  advanceFilesLookupGeneration(controller);
  controller.positive.clear();
};

export const rememberPositiveFilesLookup = (
  controller: FilesLookupController,
  key: string,
  maximumSize: number,
) => {
  if (controller.positive.has(key)) controller.positive.delete(key);
  controller.positive.set(key, true);
  while (controller.positive.size > maximumSize) {
    const oldest = controller.positive.keys().next().value;
    if (oldest == null) break;
    controller.positive.delete(oldest);
  }
};

export const nextFilesLookupInvocation = (controller: FilesLookupController) => {
  controller.invocation += 1;
  return controller.invocation;
};

export const scanFilesLookupPages = async ({
  maxPages,
  fetchPage,
}: {
  maxPages: number;
  fetchPage: (cursor: string | null) => Promise<RepoFileSearchPage>;
}) => {
  const items: RepoFileSearchPage["items"] = [];
  let cursor: string | null = null;
  const visited = new Set<string>();
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    const nextCursor = page.nextCursor ?? null;
    if (nextCursor == null) return { items, incomplete: false };
    if (visited.has(nextCursor)) return { items, incomplete: true };
    visited.add(nextCursor);
    cursor = nextCursor;
  }
  return { items, incomplete: true };
};

export const collectFilesLookupMatches = (items: RepoFileSearchPage["items"], filename: string) => {
  const known = new Set<string>();
  return items.flatMap((item) => {
    const path = normalizeRepoFilePath(item.path);
    if (item.kind !== "file" || item.name !== filename || path == null || known.has(path))
      return [];
    known.add(path);
    return [{ path, name: item.name, isIgnored: item.isIgnored }];
  });
};
