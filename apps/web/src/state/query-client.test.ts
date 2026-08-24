import { describe, expect, it } from "vitest";

import { createAppQueryClient } from "./query-client";

describe("createAppQueryClient", () => {
  it("uses explicit request semantics without implicit retries or reconnect refreshes", () => {
    const client = createAppQueryClient();

    expect(client.getDefaultOptions()).toEqual({
      queries: {
        retry: false,
        networkMode: "online",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchIntervalInBackground: false,
      },
      mutations: {
        retry: false,
        networkMode: "online",
      },
    });
  });

  it("creates an isolated cache for each app lifetime", () => {
    const first = createAppQueryClient();
    const second = createAppQueryClient();

    first.setQueryData(["session-detail", "pane-1"], { value: "first" });

    expect(second.getQueryData(["session-detail", "pane-1"])).toBeUndefined();
  });
});
