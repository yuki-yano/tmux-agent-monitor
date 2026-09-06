import type { FilesScopeIdentity } from "./session-files-query-runtime";
import type { LogCandidateState } from "./useSessionFiles-lookup-actions";

export type FilesLocalState = {
  scope: FilesScopeIdentity;
  selectedFilePath: string | null;
  fileResolveError: string | null;
  logCandidate: LogCandidateState;
};

export const createFilesLocalState = (scope: FilesScopeIdentity): FilesLocalState => ({
  scope,
  selectedFilePath: null,
  fileResolveError: null,
  logCandidate: null,
});
