import type { CommitFileDiff } from "@vde-monitor/shared";
import { memo } from "react";

import { DiffPatch } from "../DiffPatch";

type CommitFileDetailContentProps = {
  loadingFile: boolean;
  fileDetail?: CommitFileDiff;
  renderedPatch?: string[];
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

export const CommitFileDetailContent = memo(
  ({
    loadingFile,
    fileDetail,
    renderedPatch,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitFileDetailContentProps) => {
    if (loadingFile) {
      return <p className="text-latte-subtext0 text-xs">Loading diff…</p>;
    }
    if (fileDetail?.binary) {
      return <p className="text-latte-subtext0 text-xs">Binary file (no diff).</p>;
    }
    if (!fileDetail?.patch) {
      return <p className="text-latte-subtext0 text-xs">No diff available.</p>;
    }
    return (
      <div className="custom-scrollbar max-h-[240px] overflow-auto">
        {renderedPatch && (
          <DiffPatch
            lines={renderedPatch}
            onResolveFileReference={onResolveFileReference}
            onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
          />
        )}
        {fileDetail.truncated && (
          <p className="text-latte-subtext0 mt-2 text-xs">Diff truncated.</p>
        )}
      </div>
    );
  },
);

CommitFileDetailContent.displayName = "CommitFileDetailContent";
