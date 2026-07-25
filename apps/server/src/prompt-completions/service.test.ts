import type { PromptCompletionItem } from "@vde-monitor/shared";
import { describe, expect, it, vi } from "vitest";

import { createPromptCompletionService } from "./service";

const skill = (name: string): PromptCompletionItem => ({
  id: `skill:${name}`,
  label: `$${name}`,
  insertText: `$${name}`,
  description: `${name} description`,
  argumentHint: "",
  kind: "skill",
  scope: "user",
});

const plugin = (name: string): PromptCompletionItem => ({
  id: `plugin:${name}`,
  label: `@${name}`,
  insertText: `@${name}`,
  description: `${name} description`,
  argumentHint: "",
  kind: "plugin",
  scope: "openai-bundled",
});

describe("createPromptCompletionService", () => {
  it("routes completion triggers by agent", async () => {
    const listCodexPlugins = vi.fn(async () => [plugin("Chrome")]);
    const listCodexSkills = vi.fn(async () => [skill("react-doctor")]);
    const listClaudeCommands = vi.fn(async () => [
      { ...skill("frontend-design"), label: "/frontend-design", insertText: "/frontend-design" },
    ]);
    const service = createPromptCompletionService({
      listCodexPlugins,
      listCodexSkills,
      listClaudeCommands,
    });

    expect(
      await service.list({ agent: "codex", cwd: "/repo", trigger: "at", query: "chr" }),
    ).toEqual({ items: [plugin("Chrome")] });
    expect(
      await service.list({ agent: "codex", cwd: "/repo", trigger: "dollar", query: "react" }),
    ).toEqual({ items: [skill("react-doctor")] });
    expect(
      await service.list({ agent: "claude", cwd: "/repo", trigger: "dollar", query: "" }),
    ).toEqual({ items: [] });
    expect(
      await service.list({ agent: "claude", cwd: "/repo", trigger: "slash", query: "front" }),
    ).toMatchObject({ items: [{ label: "/frontend-design" }] });
  });

  it("caches dynamic candidates per agent and working directory", async () => {
    const listCodexSkills = vi.fn(async () => [skill("react-doctor")]);
    const service = createPromptCompletionService({
      listCodexPlugins: vi.fn(async () => []),
      listCodexSkills,
      listClaudeCommands: vi.fn(async () => []),
    });

    await service.list({ agent: "codex", cwd: "/repo", trigger: "dollar", query: "" });
    await service.list({ agent: "codex", cwd: "/repo", trigger: "dollar", query: "doctor" });
    await service.list({ agent: "codex", cwd: "/other", trigger: "dollar", query: "" });

    expect(listCodexSkills).toHaveBeenCalledTimes(2);
    expect(listCodexSkills).toHaveBeenNthCalledWith(1, "/repo");
    expect(listCodexSkills).toHaveBeenNthCalledWith(2, "/other");
  });

  it("returns every matching Skill without truncating plugin cache entries", async () => {
    const cachedPluginSkill = {
      ...skill("visualize:visualize"),
      id: "codex-skill:/home/user/.codex/plugins/cache/visualize/SKILL.md",
    };
    const skills = [
      ...Array.from({ length: 55 }, (_, index) => skill(`skill-${String(index).padStart(2, "0")}`)),
      cachedPluginSkill,
    ];
    const service = createPromptCompletionService({
      listCodexPlugins: vi.fn(async () => []),
      listCodexSkills: vi.fn(async () => skills),
      listClaudeCommands: vi.fn(async () => []),
    });

    const result = await service.list({
      agent: "codex",
      cwd: "/repo",
      trigger: "dollar",
      query: "",
    });

    expect(result.items).toHaveLength(skills.length);
    expect(result.items).toContainEqual(cachedPluginSkill);
  });
});
