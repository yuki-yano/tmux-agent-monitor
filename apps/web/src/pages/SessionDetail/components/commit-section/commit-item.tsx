import type { CommitDetail, CommitFileDiff, CommitLog } from "@vde-monitor/shared";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { memo } from "react";

import { ChipButton, InsetPanel, PanelSection } from "@/components/ui";

import { formatTimestamp } from "../../sessionDetailUtils";
import { CommitExpandedSection } from "./commit-expanded-section";

type CommitItemProps = {
  commit: CommitLog["commits"][number];
  detail?: CommitDetail;
  loadingDetail: boolean;
  isOpen: boolean;
  copiedHash: string | null;
  commitFileOpen: Record<string, boolean>;
  commitFileDetails: Record<string, CommitFileDiff>;
  commitFileLoading: Record<string, boolean>;
  renderedPatches: Record<string, string[]>;
  onToggleCommit: (hash: string) => void;
  onToggleCommitFile: (hash: string, path: string) => void;
  onCopyHash: (hash: string) => void;
  onResolveFileReference?: (rawToken: string) => Promise<void>;
  onResolveFileReferenceCandidates?: (rawTokens: string[]) => Promise<string[]>;
};

export const CommitItem = memo(
  ({
    commit,
    detail,
    loadingDetail,
    isOpen,
    copiedHash,
    commitFileOpen,
    commitFileDetails,
    commitFileLoading,
    renderedPatches,
    onToggleCommit,
    onToggleCommitFile,
    onCopyHash,
    onResolveFileReference,
    onResolveFileReferenceCandidates,
  }: CommitItemProps) => {
    const commitBody = detail?.body ?? commit.body;
    const toggleCommit = () => {
      onToggleCommit(commit.hash);
    };

    return (
      <InsetPanel>
        <div className="flex w-full flex-wrap items-start gap-2.5 rounded-md px-2.5 py-1.5 sm:gap-3 sm:px-3 sm:py-2">
          <ChipButton
            type="button"
            onClick={() => onCopyHash(commit.hash)}
            aria-label={`Copy commit hash ${commit.shortHash}`}
          >
            <span className="font-mono">{commit.shortHash}</span>
            {copiedHash === commit.hash ? (
              <Check className="text-latte-green-text h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </ChipButton>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={
              isOpen ? `Collapse commit ${commit.shortHash}` : `Expand commit ${commit.shortHash}`
            }
            className="focus-visible:ring-latte-lavender/30 flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md border-0 bg-transparent p-0 text-left focus-visible:outline-hidden focus-visible:ring-2"
            onClick={toggleCommit}
          >
            <div className="min-w-0">
              <p className="text-latte-text text-sm">{commit.subject}</p>
              <p className="text-latte-subtext0 text-xs">
                {commit.authorName} · {formatTimestamp(commit.authoredAt)}
              </p>
            </div>
            <span
              className="text-latte-overlay1 ml-auto flex items-center self-center px-2"
              aria-hidden="true"
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </span>
          </button>
        </div>
        {isOpen && (
          <PanelSection>
            <CommitExpandedSection
              commitHash={commit.hash}
              detail={detail}
              loadingDetail={loadingDetail}
              commitBody={commitBody}
              commitFileOpen={commitFileOpen}
              commitFileDetails={commitFileDetails}
              commitFileLoading={commitFileLoading}
              renderedPatches={renderedPatches}
              onToggleCommitFile={onToggleCommitFile}
              onResolveFileReference={onResolveFileReference}
              onResolveFileReferenceCandidates={onResolveFileReferenceCandidates}
            />
          </PanelSection>
        )}
      </InsetPanel>
    );
  },
);

CommitItem.displayName = "CommitItem";
