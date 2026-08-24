import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HttpResponse, http, server } from "@/test/msw/server";

import { useUsageApi } from "./use-usage-api";

const API_BASE_URL = "http://127.0.0.1:11081/api";

describe("useUsageApi", () => {
  it("loads and validates repository activity for the selected range", async () => {
    let requestedRange: string | null = null;
    let requestedAuthorization: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/usage/repository-activity`, ({ request }) => {
        const url = new URL(request.url);
        requestedRange = url.searchParams.get("range");
        requestedAuthorization = request.headers.get("authorization");
        return HttpResponse.json({
          range: "7d",
          rangeStart: "2026-07-04T00:00:00.000Z",
          rangeEnd: "2026-07-11T00:00:00.000Z",
          coverage: {
            status: "complete",
            trackingStartedAt: "2026-06-01T00:00:00.000Z",
            gapDurationMs: 0,
            unattributedRunningMs: 0,
            unattributedCompletedRunCount: 0,
            unverifiedCompletedRunCount: 0,
          },
          items: [
            {
              repoKey: "repo",
              repoRoot: "/repo",
              repoName: "repo",
              activeTimeMs: 60_000,
              agentTimeMs: 90_000,
              completedRunCount: 1,
              lastActiveAt: "2026-07-10T23:00:00.000Z",
            },
          ],
          fetchedAt: "2026-07-11T00:00:00.000Z",
        });
      }),
    );
    const { result } = renderHook(() => useUsageApi({ token: "token", apiBaseUrl: API_BASE_URL }));

    await expect(result.current.requestUsageRepositoryActivity({ range: "7d" })).resolves.toEqual(
      expect.objectContaining({
        range: "7d",
        items: [expect.objectContaining({ repoKey: "repo" })],
      }),
    );
    expect(requestedRange).toBe("7d");
    expect(requestedAuthorization).toBe("Bearer token");
  });

  it("rejects an invalid repository activity response", async () => {
    server.use(
      http.get(`${API_BASE_URL}/usage/repository-activity`, () =>
        HttpResponse.json({ range: "24h", items: [] }),
      ),
    );
    const { result } = renderHook(() => useUsageApi({ token: "token", apiBaseUrl: API_BASE_URL }));

    await expect(result.current.requestUsageRepositoryActivity({ range: "24h" })).rejects.toThrow(
      "Invalid response",
    );
  });

  it("forwards cancellation signals to every usage resource request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const controller = new AbortController();
    const { result } = renderHook(() => useUsageApi({ token: "token", apiBaseUrl: API_BASE_URL }));

    await Promise.allSettled([
      result.current.requestUsageDashboard({}, controller.signal),
      result.current.requestUsageGlobalTimeline({}, controller.signal),
      result.current.requestUsageProviderBilling({ provider: "codex" }, controller.signal),
      result.current.requestUsageRepositoryActivity({ range: "24h" }, controller.signal),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const [, options] of fetchSpy.mock.calls) {
      expect(options?.signal).toBe(controller.signal);
    }
    fetchSpy.mockRestore();
  });
});
