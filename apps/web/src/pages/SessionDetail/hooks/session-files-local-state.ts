import type { FilesScopeIdentity } from "./session-files-query-runtime";
import type { SearchDescriptors, TreeDescriptors } from "./session-files-query-projection";
import { rootDescriptor } from "./session-files-query-projection";
import type { LogCandidateState } from "./useSessionFiles-lookup-actions";

export type FilesLocalState = {
  scope: FilesScopeIdentity;
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
  fileResolveError: string | null;
  logCandidate: LogCandidateState;
};

export const createFilesLocalState = (scope: FilesScopeIdentity): FilesLocalState => ({
  scope,
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
  fileResolveError: null,
  logCandidate: null,
});
