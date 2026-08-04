// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PreviewTicketService } from "../../file-preview";
import { createFilePreviewRoutes } from "./file-preview-routes";

const tempRoots: string[] = [];

const createPreviewFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vde-monitor-preview-route-"));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, "styles"), { recursive: true });
  await fs.mkdir(path.join(root, "images"), { recursive: true });
  const imagePath = path.join(root, "images", "large.png");
  const image = Buffer.alloc(512 * 1024, 0xab);
  await fs.writeFile(imagePath, image);
  await fs.writeFile(
    path.join(root, "styles", "main.css"),
    `@import "./theme.css"; .hero { background: url("${imagePath}"); }`,
  );
  await fs.writeFile(path.join(root, "styles", "theme.css"), ".theme { color: red; }");
  await fs.writeFile(path.join(root, "images", "unreferenced.png"), "not authorized");
  await fs.writeFile(path.join(root, "images", "alias-only.png"), "alias image");
  await fs.symlink(path.join(root, "images"), path.join(root, "linked-images"));
  await fs.writeFile(
    path.join(root, "images", "active.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  await fs.writeFile(
    path.join(root, "index.html"),
    `<img src="${imagePath}"><img src="./linked-images/alias-only.png"><link rel="stylesheet" href="./styles/main.css"><img src="https://example.com/tracker.png">`,
  );
  return { root: await fs.realpath(root), image };
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("createFilePreviewRoutes", () => {
  it("serves transformed HTML and CSS with a restrictive CSP and no authentication", async () => {
    const fixture = await createPreviewFixture();
    const tickets = new PreviewTicketService({ randomBytes: () => Buffer.alloc(32, 1) });
    const grant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "index.html",
    });
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    const htmlResponse = await routes.request(`/${grant.ticket}/r/repo/index.html`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("cache-control")).toBe("no-store");
    expect(htmlResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(htmlResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(htmlResponse.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(htmlResponse.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(htmlResponse.headers.get("content-security-policy")).toContain(
      "sandbox allow-same-origin",
    );
    const html = await htmlResponse.text();
    expect(html).toContain(`/${grant.ticket}/r/repo/images/large.png`);
    expect(html).toContain(`/${grant.ticket}/r/repo/images/alias-only.png`);
    expect(html).toContain(`/${grant.ticket}/r/repo/styles/main.css`);
    expect(html).toContain('src="about:blank"');

    expect((await routes.request(`/${grant.ticket}/r/repo/styles/theme.css`)).status).toBe(404);
    const cssResponse = await routes.request(`/${grant.ticket}/r/repo/styles/main.css`);
    expect(cssResponse.status).toBe(200);
    const css = await cssResponse.text();
    expect(css).toContain(`@import "/file-preview/${grant.ticket}/r/repo/styles/theme.css"`);
    expect(css).toContain(`/${grant.ticket}/r/repo/images/large.png`);
    expect((await routes.request(`/${grant.ticket}/r/repo/styles/theme.css`)).status).toBe(200);
    expect((await routes.request(`/${grant.ticket}/r/repo/images/alias-only.png`)).status).toBe(
      200,
    );
    expect((await routes.request(`/${grant.ticket}/r/repo/images/unreferenced.png`)).status).toBe(
      404,
    );
  });

  it("streams images larger than the former JSON limit", async () => {
    const fixture = await createPreviewFixture();
    const tickets = new PreviewTicketService({ randomBytes: () => Buffer.alloc(32, 2) });
    const grant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "images/large.png",
    });
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    const response = await routes.request(`/${grant.ticket}/r/repo/images/large.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(fixture.image.byteLength));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.image);
  });

  it("transforms self-contained HTML larger than the former 4 MiB limit", async () => {
    const fixture = await createPreviewFixture();
    const largeHtml = path.join(fixture.root, "large.html");
    const embeddedImage = "a".repeat(5 * 1024 * 1024);
    await fs.writeFile(largeHtml, `<img src="data:image/png;base64,${embeddedImage}">`);
    const tickets = new PreviewTicketService();
    const grant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "large.html",
    });
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    const response = await routes.request(`/${grant.ticket}/r/repo/large.html`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await response.text()).length).toBeGreaterThan(5 * 1024 * 1024);
  });

  it("rejects HTML and CSS above the transform limit without limiting image streams", async () => {
    const fixture = await createPreviewFixture();
    const oversizedHtml = path.join(fixture.root, "oversized.html");
    const oversizedCss = path.join(fixture.root, "styles", "oversized.css");
    await fs.writeFile(oversizedHtml, " ");
    await fs.truncate(oversizedHtml, 256 * 1024 * 1024 + 1);
    await fs.writeFile(oversizedCss, " ");
    await fs.truncate(oversizedCss, 256 * 1024 * 1024 + 1);
    const tickets = new PreviewTicketService();
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    const htmlGrant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "oversized.html",
    });
    expect((await routes.request(`/${htmlGrant.ticket}/r/repo/oversized.html`)).status).toBe(404);

    const cssGrant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "styles/oversized.css",
    });
    expect((await routes.request(`/${cssGrant.ticket}/r/repo/styles/oversized.css`)).status).toBe(
      404,
    );
  });

  it("applies a sandboxed CSP to active image documents such as SVG", async () => {
    const fixture = await createPreviewFixture();
    const tickets = new PreviewTicketService();
    const grant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "images/active.svg",
    });
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    const response = await routes.request(`/${grant.ticket}/r/repo/images/active.svg`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-same-origin");
  });

  it("returns the same 404 response for unknown, expired, and traversal tickets", async () => {
    const fixture = await createPreviewFixture();
    let now = 1_000;
    const tickets = new PreviewTicketService({
      now: () => now,
      ttlMs: 10,
      randomBytes: () => Buffer.alloc(32, 3),
    });
    const grant = tickets.issue([{ rootId: "repo", canonicalPath: fixture.root }], {
      rootId: "repo",
      relativePath: "index.html",
    });
    const routes = createFilePreviewRoutes({ previewTicketService: tickets });

    expect((await routes.request(`/unknown/r/repo/index.html`)).status).toBe(404);
    expect((await routes.request(`/${grant.ticket}/r/repo/../index.html`)).status).toBe(404);
    now = 1_010;
    expect((await routes.request(`/${grant.ticket}/r/repo/index.html`)).status).toBe(404);
  });
});
