import type { SessionStateTimelineRange } from "@vde-monitor/shared";

import type { RepositoryActivityRange } from "./repository-activity-types";
import type { BillingProviderId } from "./useUsageBillingData";

export type UsageDashboardQueryScope = {
  apiBaseUrl: string;
  authScope: string | null;
};

const hashAuthToken = (token: string) => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${token.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
};

export const createUsageDashboardQueryScope = (
  apiBaseUrl: string | null | undefined,
  authToken: string | null,
): UsageDashboardQueryScope => {
  const normalizedApiBaseUrl = apiBaseUrl?.trim() || "/api";
  return {
    apiBaseUrl: normalizedApiBaseUrl.endsWith("/")
      ? normalizedApiBaseUrl.slice(0, -1)
      : normalizedApiBaseUrl,
    authScope: authToken == null ? null : hashAuthToken(authToken),
  };
};

export const usageDashboardQueryKeys = {
  all: ["usage-dashboard"] as const,
  scope: (scope: UsageDashboardQueryScope) => [...usageDashboardQueryKeys.all, scope] as const,
  resource: (scope: UsageDashboardQueryScope, resource: string) =>
    [...usageDashboardQueryKeys.scope(scope), resource] as const,
  dashboard: (scope: UsageDashboardQueryScope) =>
    usageDashboardQueryKeys.resource(scope, "dashboard"),
  timeline: (scope: UsageDashboardQueryScope, range: SessionStateTimelineRange) =>
    [...usageDashboardQueryKeys.resource(scope, "timeline"), { range }] as const,
  repositoryActivity: (scope: UsageDashboardQueryScope, range: RepositoryActivityRange) =>
    [...usageDashboardQueryKeys.resource(scope, "repository-activity"), { range }] as const,
  billing: (scope: UsageDashboardQueryScope, provider: BillingProviderId) =>
    [...usageDashboardQueryKeys.resource(scope, "billing"), { provider }] as const,
};
