import type { ApiEnvelope } from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

type ErrorMessageOptions = {
  includeStatus?: boolean;
};

export const readJsonSafe = async <T>(res: Response): Promise<T | null> => {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

export const requestJson = async <T>(request: Promise<Response>) => {
  const res = await request;
  const data = await readJsonSafe<T>(res);
  return { res, data };
};

const isUnauthorizedStatus = (status: number) => status === 401 || status === 403;

export const extractErrorMessage = (
  res: Response,
  data: ApiEnvelope<unknown> | null,
  fallback: string,
  options?: ErrorMessageOptions,
) => {
  if (isUnauthorizedStatus(res.status)) {
    return API_ERROR_MESSAGES.unauthorized;
  }
  if (data?.error?.message) {
    return data.error.message;
  }
  if (options?.includeStatus) {
    return `${fallback} (${res.status})`;
  }
  return fallback;
};

export const ensureOk = <T>(
  res: Response,
  data: ApiEnvelope<T> | null,
  fallback: string,
  options?: ErrorMessageOptions,
): ApiEnvelope<T> => {
  if (!res.ok || !data) {
    throw new Error(extractErrorMessage(res, data, fallback, options));
  }
  return data;
};

export const expectField = <T, K extends keyof T>(
  res: Response,
  data: ApiEnvelope<T> | null,
  field: K,
  fallback: string,
): NonNullable<T[K]> => {
  const payload = ensureOk(res, data, fallback);
  const value = payload[field];
  if (value == null) {
    throw new Error(fallback);
  }
  return value as NonNullable<T[K]>;
};
