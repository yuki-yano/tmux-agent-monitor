import { zValidator } from "@hono/zod-validator";
import {
  allowedKeySchema,
  type RawItem,
  type SessionStateTimelineRange,
} from "@vde-monitor/shared";
import { Hono } from "hono";
import { z } from "zod";

import { createScreenResponse } from "../../screen/screen-response";
import { buildError, nowIso } from "../helpers";
import {
  IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES,
  ImageAttachmentError,
  saveImageAttachment,
} from "../image-attachment";
import type { SessionRouteDeps } from "./types";

const timelineQuerySchema = z.object({
  range: z.enum(["15m", "1h", "6h"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const titleSchema = z.object({
  title: z.string().nullable(),
});
const screenRequestSchema = z.object({
  mode: z.enum(["text", "image"]).optional(),
  lines: z.number().int().min(1).optional(),
  cursor: z.string().optional(),
});
const sendTextSchema = z.object({
  text: z.string(),
  enter: z.boolean().optional(),
});
const sendKeysSchema = z.object({
  keys: z.array(allowedKeySchema),
});
const rawItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("key"), value: allowedKeySchema }),
]);
const sendRawSchema = z.object({
  items: z.array(rawItemSchema),
  unsafe: z.boolean().optional(),
});

const resolveTimelineRange = (range: string | undefined): SessionStateTimelineRange => {
  if (range === "15m" || range === "1h" || range === "6h") {
    return range;
  }
  return "1h";
};

export const createSessionRoutes = ({
  config,
  monitor,
  actions,
  screenLimiter,
  sendLimiter,
  screenCache,
  getLimiterKey,
  resolvePane,
  resolveTitleUpdate,
  validateAttachmentContentLength,
  executeCommand,
}: SessionRouteDeps) =>
  new Hono()
    .get("/sessions", (c) => {
      return c.json({
        sessions: monitor.registry.snapshot(),
        serverTime: nowIso(),
        clientConfig: {
          screen: { highlightCorrection: config.screen.highlightCorrection },
        },
      });
    })
    .get("/sessions/:paneId", (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      return c.json({ session: pane.detail });
    })
    .get("/sessions/:paneId/timeline", zValidator("query", timelineQuerySchema), (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const query = c.req.valid("query");
      const timeline = monitor.getStateTimeline(
        pane.paneId,
        resolveTimelineRange(query.range),
        query.limit ?? 200,
      );
      return c.json({ timeline });
    })
    .put("/sessions/:paneId/title", zValidator("json", titleSchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const { title } = c.req.valid("json");
      const titleUpdate = resolveTitleUpdate(c, title);
      if (titleUpdate instanceof Response) {
        return titleUpdate;
      }
      monitor.setCustomTitle(pane.paneId, titleUpdate.nextTitle);
      const updated = monitor.registry.getDetail(pane.paneId) ?? pane.detail;
      return c.json({ session: updated });
    })
    .post("/sessions/:paneId/touch", (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      monitor.recordInput(pane.paneId);
      const updated = monitor.registry.getDetail(pane.paneId) ?? pane.detail;
      return c.json({ session: updated });
    })
    .post("/sessions/:paneId/attachments/image", async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const contentLength = validateAttachmentContentLength(c);
      if (contentLength instanceof Response) {
        return contentLength;
      }
      if (contentLength > IMAGE_ATTACHMENT_MAX_CONTENT_LENGTH_BYTES) {
        return c.json(
          { error: buildError("INVALID_PAYLOAD", "attachment exceeds content-length limit") },
          400,
        );
      }
      let formData: FormData;
      try {
        formData = await c.req.formData();
      } catch {
        return c.json({ error: buildError("INVALID_PAYLOAD", "invalid multipart payload") }, 400);
      }
      const image = formData.get("image");
      if (!(image instanceof File)) {
        return c.json({ error: buildError("INVALID_PAYLOAD", "image field is required") }, 400);
      }

      try {
        const attachment = await saveImageAttachment({
          paneId: pane.paneId,
          repoRoot: pane.detail.repoRoot,
          file: image,
        });
        return c.json({ attachment });
      } catch (error) {
        if (error instanceof ImageAttachmentError) {
          return c.json({ error: buildError(error.code, error.message) }, error.status);
        }
        return c.json({ error: buildError("INTERNAL", "failed to save image attachment") }, 500);
      }
    })
    .post("/sessions/:paneId/screen", zValidator("json", screenRequestSchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const body = c.req.valid("json");
      const screen = await createScreenResponse({
        config,
        monitor,
        target: pane.detail,
        mode: body.mode,
        lines: body.lines,
        cursor: body.cursor,
        screenLimiter,
        limiterKey: getLimiterKey(c),
        buildTextResponse: screenCache.buildTextResponse,
      });
      return c.json({ screen });
    })
    .post("/sessions/:paneId/send/text", zValidator("json", sendTextSchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const body = c.req.valid("json");
      const command = await executeCommand(c, {
        type: "send.text",
        paneId: pane.paneId,
        text: body.text,
        enter: body.enter,
      });
      return c.json({ command });
    })
    .post("/sessions/:paneId/send/keys", zValidator("json", sendKeysSchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const body = c.req.valid("json");
      const command = await executeCommand(c, {
        type: "send.keys",
        paneId: pane.paneId,
        keys: body.keys,
      });
      return c.json({ command });
    })
    .post("/sessions/:paneId/send/raw", zValidator("json", sendRawSchema), async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      const body = c.req.valid("json");
      const command = await executeCommand(c, {
        type: "send.raw",
        paneId: pane.paneId,
        items: body.items as RawItem[],
        unsafe: body.unsafe,
      });
      return c.json({ command });
    })
    .post("/sessions/:paneId/focus", async (c) => {
      const pane = resolvePane(c);
      if (pane instanceof Response) {
        return pane;
      }
      if (!sendLimiter(getLimiterKey(c))) {
        return c.json({
          command: {
            ok: false,
            error: buildError("RATE_LIMIT", "rate limited"),
          },
        });
      }
      const command = await actions.focusPane(pane.paneId);
      return c.json({ command });
    });
