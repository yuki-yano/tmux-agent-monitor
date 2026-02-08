import { shouldSuppressActivity } from "./activity-suppressor";

type ActivityResolverInput = {
  paneId: string;
  paneActivity: number | null;
  // Kept to avoid changing call sites; window activity is no longer used as output fallback.
  windowActivity: number | null;
  // Kept to avoid changing call sites; pane active flag is no longer used as output fallback.
  paneActive: boolean;
  suppressor?: (paneId: string, activityIso: string | null) => boolean;
};

const toIsoFromEpochSeconds = (value: number | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

export const resolveActivityTimestamp = ({
  paneId,
  paneActivity,
  suppressor = shouldSuppressActivity,
}: ActivityResolverInput): string | null => {
  const paneActivityAt = toIsoFromEpochSeconds(paneActivity);
  if (paneActivityAt && !suppressor(paneId, paneActivityAt)) {
    return paneActivityAt;
  }
  return null;
};
