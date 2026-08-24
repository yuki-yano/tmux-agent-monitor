import type { ApiEnvelope } from "@vde-monitor/shared";

import { API_ERROR_MESSAGES } from "@/lib/api-messages";

type ErrorMessageOptions = {
  includeStatus?: boolean;
};

type JsonRequest = Promise<Response> | ((signal?: AbortSignal) => Promise<Response>);

type RequestJsonOptions = {
  timeoutMs?: number;
  timeoutMessage?: string;
};

type ErrorMessageResult = {
  error?: {
    message?: string | null;
  } | null;
};

const readJsonSafe = async <T>(res: Response): Promise<T | null> => {
  try {
    return (await res.json()) as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return null;
  }
};

const executeRequest = (request: JsonRequest, signal?: AbortSignal) =>
  typeof request === "function" ? request(signal) : request;

export const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
      error != null &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError";

export const resolveUnknownErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (
    typeof error === "object" &&
    error != null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.length > 0
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
};

export const toErrorWithFallback = (error: unknown, fallback: string) =>
  error instanceof Error ? error : new Error(resolveUnknownErrorMessage(error, fallback));

export const resolveResultErrorMessage = (result: ErrorMessageResult, fallback: string) =>
  result.error?.message ?? fallback;

export const requestJson = async <T>(request: JsonRequest, options?: RequestJsonOptions) => {
  const timeoutMs = options?.timeoutMs ?? 0;
  let res: Response;

  if (timeoutMs > 0 && typeof AbortController !== "undefined") {
    const controller = new AbortController();
    const timeoutMessage = options?.timeoutMessage ?? API_ERROR_MESSAGES.requestTimeout;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const requestPromise = executeRequest(request, controller.signal);
    const timeoutPromise = new Promise<Response>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
    });
    void requestPromise.catch(() => undefined);
    void timeoutPromise.catch(() => undefined);

    try {
      res = await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(timeoutMessage);
      }
      throw error;
    } finally {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
    }
  } else {
    res = await executeRequest(request);
  }

  const data = await readJsonSafe<T>(res);
  return { res, data };
};

const isUnauthorizedStatus = (status: number) => status === 401;

const resolveKnownApiErrorMessage = (error: ApiEnvelope<unknown>["error"] | null | undefined) => {
  if (!error) {
    return null;
  }
  if (error.code === "REPO_UNAVAILABLE") {
    return API_ERROR_MESSAGES.repoUnavailable;
  }
  if (error.code === "FORBIDDEN_PATH") {
    return API_ERROR_MESSAGES.forbiddenPath;
  }
  if (error.code === "PERMISSION_DENIED") {
    return API_ERROR_MESSAGES.permissionDenied;
  }
  return null;
};

export const extractErrorMessage = (
  res: Response,
  data: ApiEnvelope<unknown> | null,
  fallback: string,
  options?: ErrorMessageOptions,
) => {
  if (isUnauthorizedStatus(res.status)) {
    return API_ERROR_MESSAGES.unauthorized;
  }
  const knownMessage = resolveKnownApiErrorMessage(data?.error);
  if (knownMessage) {
    return knownMessage;
  }
  if (data?.error?.message) {
    return data.error.message;
  }
  if (options?.includeStatus) {
    return `${fallback} (${res.status})`;
  }
  return fallback;
};

const ensureOk = <T>(
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
