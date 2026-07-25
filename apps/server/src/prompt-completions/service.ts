import type {
  PromptCompletionItem,
  PromptCompletionResult,
  PromptCompletionTrigger,
} from "@vde-monitor/shared";

import { listClaudeCommands } from "./claude-commands";
import { listCodexCommands } from "./codex-commands";
import { listCodexPlugins } from "./codex-plugins";
import { listCodexSkills } from "./codex-skills";

type SupportedAgent = "codex" | "claude";

type PromptCompletionProviders = {
  listCodexPlugins: (cwd: string) => Promise<PromptCompletionItem[]>;
  listCodexSkills: (cwd: string) => Promise<PromptCompletionItem[]>;
  listClaudeCommands: (cwd: string) => Promise<PromptCompletionItem[]>;
};

type CachedItems = {
  expiresAt: number;
  items: PromptCompletionItem[];
};

const CACHE_TTL_MS = 30_000;

const defaultProviders: PromptCompletionProviders = {
  listCodexPlugins: (cwd) => listCodexPlugins({ cwd }),
  listCodexSkills: (cwd) => listCodexSkills({ cwd }),
  listClaudeCommands: (cwd) => listClaudeCommands({ cwd }),
};

const normalizeQuery = (query: string) =>
  query
    .trim()
    .replace(/^[$/@]/, "")
    .toLocaleLowerCase();

const filterItems = (items: PromptCompletionItem[], query: string) => {
  const normalized = normalizeQuery(query);
  const scored = items.flatMap((item) => {
    const label = item.label.slice(1).toLocaleLowerCase();
    if (!normalized) {
      return [{ item, score: 0 }];
    }
    if (label.startsWith(normalized)) {
      return [{ item, score: 0 }];
    }
    if (label.includes(normalized)) {
      return [{ item, score: 1 }];
    }
    return [];
  });
  return scored
    .sort(
      (left, right) => left.score - right.score || left.item.label.localeCompare(right.item.label),
    )
    .map(({ item }) => item);
};

export const createPromptCompletionService = (
  providers: PromptCompletionProviders = defaultProviders,
) => {
  const cache = new Map<string, CachedItems>();
  const pending = new Map<string, Promise<PromptCompletionItem[]>>();

  const loadCached = async (key: string, load: () => Promise<PromptCompletionItem[]>) => {
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.items;
    }
    const activeRequest = pending.get(key);
    if (activeRequest) {
      return activeRequest;
    }
    const request = load()
      .then((items) => {
        cache.set(key, { items, expiresAt: Date.now() + CACHE_TTL_MS });
        return items;
      })
      .finally(() => {
        pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };

  const list = async ({
    agent,
    cwd,
    trigger,
    query,
  }: {
    agent: SupportedAgent;
    cwd: string;
    trigger: PromptCompletionTrigger;
    query: string;
  }): Promise<PromptCompletionResult> => {
    let items: PromptCompletionItem[];
    if (agent === "codex" && trigger === "at") {
      items = await loadCached(`codex:plugins:${cwd}`, () => providers.listCodexPlugins(cwd));
    } else if (agent === "codex" && trigger === "dollar") {
      items = await loadCached(`codex:skills:${cwd}`, () => providers.listCodexSkills(cwd));
    } else if (agent === "codex" && trigger === "slash") {
      items = listCodexCommands();
    } else if (agent === "claude" && trigger === "slash") {
      items = await loadCached(`claude:commands:${cwd}`, () => providers.listClaudeCommands(cwd));
    } else {
      items = [];
    }
    return { items: filterItems(items, query) };
  };

  return { list };
};

export type PromptCompletionService = ReturnType<typeof createPromptCompletionService>;
