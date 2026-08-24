import type {
  RepoFileNodeKind,
  RepoFileSearchPage,
  RepoFileTreeNode,
  RepoFileTreePage,
} from "@vde-monitor/shared";

export type FileTreeRenderNode = {
  path: string;
  name: string;
  kind: RepoFileNodeKind;
  depth: number;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  searchMatched: boolean;
  activeMatch: boolean;
  isIgnored: boolean;
};

export const mergeTreeEntries = (existing: RepoFileTreeNode[], incoming: RepoFileTreeNode[]) => {
  const merged = new Map<string, RepoFileTreeNode>();
  existing.forEach((entry) => {
    merged.set(entry.path, entry);
  });
  incoming.forEach((entry) => {
    merged.set(entry.path, entry);
  });
  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
};

export const mergeSearchItems = (
  existing: RepoFileSearchPage["items"],
  incoming: RepoFileSearchPage["items"],
) => {
  const merged = [...existing];
  const knownPaths = new Set(existing.map((item) => item.path));
  incoming.forEach((item) => {
    if (knownPaths.has(item.path)) {
      return;
    }
    knownPaths.add(item.path);
    merged.push(item);
  });
  return merged;
};

export const collectAncestorDirectories = (targetPath: string) => {
  const segments = targetPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return [];
  }
  const ancestors: string[] = [];
  let current = "";
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }
    current = current.length > 0 ? `${current}/${segment}` : segment;
    ancestors.push(current);
  }
  return ancestors;
};

const normalizeSearchTree = (items: RepoFileSearchPage["items"]) => {
  const nodeMap = new Map<
    string,
    {
      path: string;
      name: string;
      kind: RepoFileNodeKind;
      children: Set<string>;
      isIgnored: boolean;
    }
  >();
  const rootChildren = new Set<string>();

  const ensureNode = (
    nodePath: string,
    name: string,
    kind: RepoFileNodeKind,
    isIgnored: boolean,
  ) => {
    const existing = nodeMap.get(nodePath);
    if (existing) {
      if (isIgnored) {
        existing.isIgnored = true;
      }
      return existing;
    }
    const created = {
      path: nodePath,
      name,
      kind,
      children: new Set<string>(),
      isIgnored,
    };
    nodeMap.set(nodePath, created);
    return created;
  };

  items.forEach((item) => {
    const segments = item.path.split("/").filter((segment) => segment.length > 0);
    let parentPath: string | null = null;
    segments.forEach((segment, index) => {
      const currentPath = segments.slice(0, index + 1).join("/");
      const kind: RepoFileNodeKind = index === segments.length - 1 ? item.kind : "directory";
      const current = ensureNode(
        currentPath,
        segment,
        kind,
        index === segments.length - 1 && item.isIgnored === true,
      );
      if (!parentPath) {
        rootChildren.add(current.path);
      } else {
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.add(current.path);
        }
      }
      parentPath = current.path;
    });
  });

  return { nodeMap, rootChildren };
};

export const buildSearchRenderNodes = ({
  searchItems,
  selectedFilePath,
  activeMatchPath,
  expandedDirSet,
}: {
  searchItems: RepoFileSearchPage["items"];
  selectedFilePath: string | null;
  activeMatchPath: string | null;
  expandedDirSet: Set<string>;
}): FileTreeRenderNode[] => {
  if (searchItems.length === 0) {
    return [];
  }

  const { nodeMap, rootChildren } = normalizeSearchTree(searchItems);
  const matchedPathSet = new Set(searchItems.map((item) => item.path));
  const ignoredMemo = new Map<string, boolean>();

  const resolveNodeIgnored = (nodePath: string): boolean => {
    const cached = ignoredMemo.get(nodePath);
    if (cached != null) {
      return cached;
    }
    const node = nodeMap.get(nodePath);
    if (!node) {
      ignoredMemo.set(nodePath, false);
      return false;
    }
    if (node.kind === "file" || node.isIgnored) {
      ignoredMemo.set(nodePath, node.isIgnored);
      return node.isIgnored;
    }
    const childPaths = Array.from(node.children);
    if (childPaths.length === 0) {
      ignoredMemo.set(nodePath, false);
      return false;
    }
    const allChildrenIgnored = childPaths.every((childPath) => resolveNodeIgnored(childPath));
    ignoredMemo.set(nodePath, allChildrenIgnored);
    return allChildrenIgnored;
  };

  Array.from(rootChildren).forEach((rootPath) => {
    resolveNodeIgnored(rootPath);
  });

  const renderNodes: FileTreeRenderNode[] = [];
  const visit = (nodePath: string, depth: number) => {
    const node = nodeMap.get(nodePath);
    if (!node) {
      return;
    }
    const isDirectory = node.kind === "directory";
    const expanded = isDirectory && expandedDirSet.has(node.path);
    const childPaths = Array.from(node.children).sort((leftPath, rightPath) => {
      const leftNode = nodeMap.get(leftPath);
      const rightNode = nodeMap.get(rightPath);
      if (!leftNode || !rightNode) {
        return leftPath.localeCompare(rightPath);
      }
      return leftNode.name.localeCompare(rightNode.name);
    });
    renderNodes.push({
      path: node.path,
      name: node.name,
      kind: node.kind,
      depth,
      selected: node.path === selectedFilePath,
      expanded,
      hasChildren: childPaths.length > 0,
      searchMatched: matchedPathSet.has(node.path),
      activeMatch: node.path === activeMatchPath,
      isIgnored: ignoredMemo.get(node.path) ?? node.isIgnored,
    });
    if (!expanded) {
      return;
    }
    childPaths.forEach((childPath) => visit(childPath, depth + 1));
  };

  Array.from(rootChildren)
    .sort((leftPath, rightPath) => {
      const leftNode = nodeMap.get(leftPath);
      const rightNode = nodeMap.get(rightPath);
      if (!leftNode || !rightNode) {
        return leftPath.localeCompare(rightPath);
      }
      return leftNode.name.localeCompare(rightNode.name);
    })
    .forEach((rootPath) => visit(rootPath, 0));

  return renderNodes;
};

export const buildNormalRenderNodes = ({
  treePages,
  expandedDirSet,
  selectedFilePath,
}: {
  treePages: Record<string, RepoFileTreePage>;
  expandedDirSet: Set<string>;
  selectedFilePath: string | null;
}) => {
  const renderNodes: FileTreeRenderNode[] = [];

  const appendEntries = (basePath: string, depth: number) => {
    const page = treePages[basePath];
    if (!page) {
      return;
    }
    page.entries.forEach((entry) => {
      const expanded = entry.kind === "directory" && expandedDirSet.has(entry.path);
      renderNodes.push({
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        depth,
        selected: entry.path === selectedFilePath,
        expanded,
        hasChildren: entry.kind === "directory" ? Boolean(entry.hasChildren) : false,
        searchMatched: false,
        activeMatch: false,
        isIgnored: entry.isIgnored === true,
      });
      if (entry.kind === "directory" && expanded) {
        appendEntries(entry.path, depth + 1);
      }
    });
  };

  appendEntries(".", 0);
  return renderNodes;
};

export const resolveTreeLoadMoreTarget = ({
  treePages,
  expandedDirSet,
}: {
  treePages: Record<string, RepoFileTreePage>;
  expandedDirSet: Set<string>;
}) => {
  const rootCursor = treePages["."]?.nextCursor;
  if (rootCursor != null) return { path: ".", cursor: rootCursor };
  for (const path of expandedDirSet) {
    const cursor = treePages[path]?.nextCursor;
    if (cursor != null) return { path, cursor };
  }
  return null;
};

export const collectVisibleExpandedTreeDirectories = ({
  treePages,
  expandedDirSet,
}: {
  treePages: Record<string, RepoFileTreePage>;
  expandedDirSet: Set<string>;
}) => {
  const visible = new Set<string>();
  const visit = (path: string) => {
    const page = treePages[path];
    if (page == null) return;
    for (const entry of page.entries) {
      if (entry.kind !== "directory" || !expandedDirSet.has(entry.path)) continue;
      visible.add(entry.path);
      visit(entry.path);
    }
  };
  visit(".");
  return visible;
};
