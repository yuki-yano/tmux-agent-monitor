import type { RepoFileSearchPage, RepoFileTreePage } from "@vde-monitor/shared";

import { mergeSearchItems, mergeTreeEntries } from "./session-files-tree-utils";

export type PageDescriptor = {
  cursor: string | null;
  parentCursor: string | null;
  headDataUpdateCount: number;
};

export type TreeDescriptors = Record<string, PageDescriptor[]>;
export type SearchDescriptors = Record<string, PageDescriptor[]>;

export const rootDescriptor = (): PageDescriptor => ({
  cursor: null,
  parentCursor: null,
  headDataUpdateCount: 0,
});

export const sameCursor = (left: string | null | undefined, right: string | null | undefined) =>
  (left ?? null) === (right ?? null);

type QueryProjectionResult<T> = { data?: T };

const projectCursorPages = <TPage extends { nextCursor?: string }>(
  descriptors: PageDescriptor[],
  getResult: (descriptor: PageDescriptor) => QueryProjectionResult<TPage> | undefined,
  merge: (head: TPage, tail: TPage) => TPage,
) => {
  let expectedCursor: string | null = null;
  let merged: TPage | null = null;
  const reachableCursors = new Set<string>();
  const visited = new Set<string>();
  for (const descriptor of descriptors) {
    if (!sameCursor(descriptor.cursor, expectedCursor)) break;
    reachableCursors.add(descriptor.cursor ?? "");
    const page = getResult(descriptor)?.data;
    if (page == null) break;
    merged = merged == null ? page : merge(merged, page);
    const nextCursor = page.nextCursor ?? null;
    if (nextCursor == null) break;
    if (visited.has(nextCursor)) {
      merged = { ...merged, nextCursor: undefined };
      break;
    }
    visited.add(nextCursor);
    expectedCursor = nextCursor;
  }
  return { merged, reachableCursors };
};

export const projectTreeQueryData = ({
  descriptorsByPath,
  headDataUpdateCountByPath,
  resultByKey,
}: {
  descriptorsByPath: TreeDescriptors;
  headDataUpdateCountByPath: Record<string, number>;
  resultByKey: Map<string, QueryProjectionResult<RepoFileTreePage> | undefined>;
}) => {
  const nextDescriptors = { ...descriptorsByPath };
  const pages: Record<string, RepoFileTreePage> = {};
  const reachableKeys = new Set<string>();
  let descriptorsChanged = false;
  for (const [path, descriptors] of Object.entries(descriptorsByPath)) {
    const head = descriptors[0];
    if (head == null) continue;
    const headCount = headDataUpdateCountByPath[path] ?? 0;
    let activeDescriptors = descriptors;
    if (headCount > 0 && head.headDataUpdateCount !== headCount) {
      activeDescriptors = [{ ...head, headDataUpdateCount: headCount }];
      nextDescriptors[path] = activeDescriptors;
      descriptorsChanged = true;
    }
    const projected = projectCursorPages(
      activeDescriptors,
      (descriptor) => resultByKey.get(`${path}\0${descriptor.cursor ?? ""}`),
      (previous, page) => ({
        ...page,
        entries: mergeTreeEntries(previous.entries, page.entries),
      }),
    );
    projected.reachableCursors.forEach((cursor) => reachableKeys.add(`${path}\0${cursor}`));
    if (projected.merged != null) pages[path] = projected.merged;
  }
  return { pages, reachableKeys, nextDescriptors, descriptorsChanged };
};

export const projectSearchQueryData = ({
  queries,
  descriptorsByQuery,
  headDataUpdateCountByQuery,
  resultByKey,
}: {
  queries: string[];
  descriptorsByQuery: SearchDescriptors;
  headDataUpdateCountByQuery: Record<string, number>;
  resultByKey: Map<string, QueryProjectionResult<RepoFileSearchPage> | undefined>;
}) => {
  const nextDescriptors = { ...descriptorsByQuery };
  const pages = new Map<string, RepoFileSearchPage>();
  const reachableKeys = new Set<string>();
  let descriptorsChanged = false;
  for (const query of queries) {
    const descriptors = descriptorsByQuery[query] ?? [];
    const head = descriptors[0];
    if (head == null) continue;
    const headCount = headDataUpdateCountByQuery[query] ?? 0;
    let activeDescriptors = descriptors;
    if (headCount > 0 && head.headDataUpdateCount !== headCount) {
      activeDescriptors = [{ ...head, headDataUpdateCount: headCount }];
      nextDescriptors[query] = activeDescriptors;
      descriptorsChanged = true;
    }
    const projected = projectCursorPages(
      activeDescriptors,
      (descriptor) => resultByKey.get(`${query}\0${descriptor.cursor ?? ""}`),
      (previous, page) => ({
        ...page,
        items: mergeSearchItems(previous.items, page.items),
      }),
    );
    projected.reachableCursors.forEach((cursor) => reachableKeys.add(`${query}\0${cursor}`));
    if (projected.merged != null) pages.set(query, projected.merged);
  }
  return { pages, reachableKeys, nextDescriptors, descriptorsChanged };
};
