import type { RepoFileNodeKind } from "@vde-monitor/shared";
import { defaultStyles } from "react-file-icon";

type FileIconStyleKey = keyof typeof defaultStyles;

type FileIconModel =
  | {
      kind: "directory";
      open: boolean;
    }
  | {
      kind: "file";
      extension: string | null;
      styleKey: FileIconStyleKey;
    };

const extensionlessStyleByName: Record<string, FileIconStyleKey> = {
  dockerfile: "docker",
  makefile: "makefile",
  readme: "md",
  license: "txt",
};

const hasStyleKey = (value: string): value is keyof typeof defaultStyles => {
  return Object.prototype.hasOwnProperty.call(defaultStyles, value);
};

const resolveFileName = (targetPath: string) => {
  const segments = targetPath.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
};

const resolveExtension = (fileName: string) => {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex < 0 || lastDotIndex === fileName.length - 1) {
    return null;
  }
  return fileName.slice(lastDotIndex + 1).toLowerCase();
};

export const resolveFileIcon = (
  targetPath: string,
  kind: RepoFileNodeKind,
  open = false,
): FileIconModel => {
  if (kind === "directory") {
    return {
      kind: "directory",
      open,
    };
  }

  const fileName = resolveFileName(targetPath);
  const lowerFileName = fileName.toLowerCase();
  const mappedByName = extensionlessStyleByName[lowerFileName];
  if (mappedByName) {
    return {
      kind: "file",
      extension: null,
      styleKey: mappedByName,
    };
  }

  const extension = resolveExtension(fileName);
  if (extension && hasStyleKey(extension)) {
    return {
      kind: "file",
      extension,
      styleKey: extension,
    };
  }

  return {
    kind: "file",
    extension,
    styleKey: "default",
  };
};
