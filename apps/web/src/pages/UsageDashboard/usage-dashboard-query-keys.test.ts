import { describe, expect, it } from "vitest";

import {
  createUsageDashboardQueryScope,
  usageDashboardQueryKeys,
} from "./usage-dashboard-query-keys";

describe("usageDashboardQueryKeys", () => {
  it("partitions cache entries by API and auth identity without storing the raw token", () => {
    const tokenA = "secret-token-a";
    const scopeA = createUsageDashboardQueryScope("/api", tokenA);
    const scopeB = createUsageDashboardQueryScope("https://example.test/api", "secret-token-b");

    expect(scopeA.authScope).not.toBe(tokenA);
    expect(JSON.stringify(scopeA)).not.toContain(tokenA);
    expect(usageDashboardQueryKeys.dashboard(scopeA)).not.toEqual(
      usageDashboardQueryKeys.dashboard(scopeB),
    );
    expect(createUsageDashboardQueryScope("/api/", tokenA)).toEqual(scopeA);
    expect(createUsageDashboardQueryScope("/api", tokenA)).toEqual(scopeA);
  });

  it("includes resource identity and range or provider dimensions", () => {
    const scope = createUsageDashboardQueryScope("/api", "token");

    expect(usageDashboardQueryKeys.timeline(scope, "24h")).not.toEqual(
      usageDashboardQueryKeys.timeline(scope, "7d"),
    );
    expect(usageDashboardQueryKeys.repositoryActivity(scope, "24h")).not.toEqual(
      usageDashboardQueryKeys.timeline(scope, "24h"),
    );
    expect(usageDashboardQueryKeys.billing(scope, "codex")).not.toEqual(
      usageDashboardQueryKeys.billing(scope, "claude"),
    );
  });
});
