import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { PromptCompletionService } from "../../prompt-completions/service";
import { buildError } from "../helpers";
import type { ResolvePane } from "./types";

const querySchema = z.object({
  trigger: z.enum(["at", "dollar", "slash"]),
  q: z.string().max(256).optional(),
});

export const createPromptCompletionRoutes = ({
  resolvePane,
  service,
}: {
  resolvePane: ResolvePane;
  service: PromptCompletionService;
}) => {
  const router = new Hono();

  router.get("/sessions/:paneId/completions", zValidator("query", querySchema), async (c) => {
    const resolved = resolvePane(c);
    if (resolved instanceof Response) {
      return resolved;
    }
    const { detail } = resolved;
    if (detail.agent === "unknown") {
      return c.json({ items: [] });
    }
    const cwd = detail.worktreePath ?? detail.repoRoot ?? detail.currentPath;
    if (!cwd) {
      return c.json({ error: buildError("REPO_UNAVAILABLE", "session cwd is unavailable") }, 400);
    }
    const { trigger, q = "" } = c.req.valid("query");
    try {
      const result = await service.list({
        agent: detail.agent,
        cwd,
        trigger,
        query: q,
      });
      return c.json(result);
    } catch (error) {
      console.error("[vde-monitor] failed to load prompt completions", error);
      return c.json({ error: buildError("INTERNAL", "failed to load prompt completions") }, 500);
    }
  });

  return router;
};
