import type { ContentTarget, FilesScopeIdentity } from "./session-files-query-runtime";
import type { SearchDescriptors, TreeDescriptors } from "./session-files-query-projection";
import { rootDescriptor } from "./session-files-query-projection";
import type { LogCandidateState } from "./useSessionFiles-lookup-actions";

export type FilesLocalState = {
  scope: FilesScopeIdentity;
  scopeGeneration: number;
  selectedFilePath: string | null;
  rawSearchQuery: string;
  desiredSearchQuery: string | null;
  displayedSearchQuery: string | null;
  searchActiveIndex: number;
  expandedDirSet: Set<string>;
  searchExpandedDirSet: Set<string>;
  searchCollapsedDirSet: Set<string>;
  treeDescriptors: TreeDescriptors;
  searchDescriptors: SearchDescriptors;
  contentTarget: ContentTarget | null;
  fileModalMarkdownViewMode: "code" | "preview" | "diff" | null;
  fileModalShowLineNumbers: boolean;
  fileModalCopiedPath: boolean;
  fileModalCopyError: string | null;
  copyOperationId: number;
  fileResolveError: string | null;
  logCandidate: LogCandidateState;
};

export const createFilesLocalState = (
  scope: FilesScopeIdentity,
  scopeGeneration = 0,
): FilesLocalState => ({
  scope,
  scopeGeneration,
  selectedFilePath: null,
  rawSearchQuery: "",
  desiredSearchQuery: null,
  displayedSearchQuery: null,
  searchActiveIndex: 0,
  expandedDirSet: new Set(),
  searchExpandedDirSet: new Set(),
  searchCollapsedDirSet: new Set(),
  treeDescriptors: scope.resolvedRoot == null ? {} : { ".": [rootDescriptor()] },
  searchDescriptors: {},
  contentTarget: null,
  fileModalMarkdownViewMode: null,
  fileModalShowLineNumbers: true,
  fileModalCopiedPath: false,
  fileModalCopyError: null,
  copyOperationId: 0,
  fileResolveError: null,
  logCandidate: null,
});
