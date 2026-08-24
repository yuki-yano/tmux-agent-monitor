import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePushNotifications } from "./use-push-notifications";

const useSessionsMock = vi.fn();

const createDeferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createSettingsResponse = () =>
  Response.json({
    settings: {
      pushEnabled: true,
      vapidPublicKey: "AQ",
      requireStandaloneOnIOS: false,
      supportedEvents: [],
      enabledEventTypes: [],
    },
  });

const readRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const installPushSubscription = () => {
  const subscription = {
    endpoint: "https://push.example/subscription",
    toJSON: () => ({
      endpoint: "https://push.example/subscription",
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" },
    }),
  } as unknown as PushSubscription;
  const getSubscription = vi.fn().mockResolvedValue(subscription);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: { getSubscription } }),
    },
  });
  return { getSubscription, subscription };
};

const readPostedPaneIds = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { scope: { paneIds: string[] } };
      return body.scope.paneIds;
    });

vi.mock("@/state/session-context", () => ({
  useSessionConfigData: () => useSessionsMock(),
}));

describe("usePushNotifications", () => {
  let originalIsSecureContext: PropertyDescriptor | undefined;
  let originalServiceWorker: PropertyDescriptor | undefined;

  beforeEach(() => {
    useSessionsMock.mockReturnValue({
      token: "token",
      apiBaseUrl: "/api",
      authError: null,
    });
    localStorage.clear();
    originalIsSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalIsSecureContext) {
      Object.defineProperty(window, "isSecureContext", originalIsSecureContext);
    } else {
      Reflect.deleteProperty(window, "isSecureContext");
    }
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("reports insecure-context when secure context is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));

    await waitFor(() => {
      expect(result.current.status).toBe("insecure-context");
    });
    expect(result.current.pushEnabled).toBe(false);
  });

  it("does not start subscription flow when token is missing", async () => {
    useSessionsMock.mockReturnValue({
      token: null,
      apiBaseUrl: "/api",
      authError: "Missing token",
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));

    await waitFor(() => {
      expect(result.current.status).toBe("idle");
    });
    expect(result.current.isSubscribed).toBe(false);
  });

  it("rolls back pane scope and exposes an error when server sync fails", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });
    installPushSubscription();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }))
      .mockResolvedValueOnce(
        Response.json({ error: { message: "scope sync failed" } }, { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));

    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await result.current.togglePaneEnabled();
    });

    expect(result.current.isPaneEnabled).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("scope sync failed");
    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe("[]");
  });

  it("serializes consecutive scope toggles and persists the latest successful scope", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    const firstScopeResponse = createDeferred<Response>();
    const secondScopeResponse = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }))
      .mockReturnValueOnce(firstScopeResponse.promise)
      .mockReturnValueOnce(secondScopeResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    let firstToggle: Promise<void>;
    let secondToggle: Promise<void>;
    act(() => {
      firstToggle = result.current.togglePaneEnabled();
      secondToggle = result.current.togglePaneEnabled();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.isPaneEnabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    firstScopeResponse.resolve(Response.json({ subscriptionId: "subscription-1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    secondScopeResponse.resolve(Response.json({ subscriptionId: "subscription-1" }));
    await act(async () => {
      await Promise.all([firstToggle!, secondToggle!]);
    });

    expect(readPostedPaneIds(fetchMock)).toEqual([[], ["%1"], []]);
    expect(result.current.isPaneEnabled).toBe(false);
    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe("[]");
  });

  it("keeps the latest scope when an earlier queued update fails", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    const firstScopeResponse = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }))
      .mockReturnValueOnce(firstScopeResponse.promise)
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    let firstToggle: Promise<void>;
    let secondToggle: Promise<void>;
    act(() => {
      firstToggle = result.current.togglePaneEnabled();
      secondToggle = result.current.togglePaneEnabled();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    firstScopeResponse.resolve(
      Response.json({ error: { message: "first failed" } }, { status: 500 }),
    );
    await act(async () => {
      await Promise.all([firstToggle!, secondToggle!]);
    });

    expect(readPostedPaneIds(fetchMock)).toEqual([[], ["%1"], []]);
    expect(result.current.isPaneEnabled).toBe(false);
    expect(result.current.status).toBe("subscribed");
    expect(result.current.errorMessage).toBeNull();
    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe("[]");
  });

  it("rolls back to the last confirmed scope when the latest queued update fails", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    const firstScopeResponse = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }))
      .mockReturnValueOnce(firstScopeResponse.promise)
      .mockResolvedValueOnce(
        Response.json({ error: { message: "latest failed" } }, { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    let firstToggle: Promise<void>;
    let secondToggle: Promise<void>;
    act(() => {
      firstToggle = result.current.togglePaneEnabled();
      secondToggle = result.current.togglePaneEnabled();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    firstScopeResponse.resolve(Response.json({ subscriptionId: "subscription-1" }));
    await act(async () => {
      await Promise.all([firstToggle!, secondToggle!]);
    });

    expect(readPostedPaneIds(fetchMock)).toEqual([[], ["%1"], []]);
    expect(result.current.isPaneEnabled).toBe(true);
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("latest failed");
    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe('["%1"]');
  });

  it("starts a new context queue without waiting for an obsolete token request", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    const obsoleteScopeResponse = createDeferred<Response>();
    let postCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = readRequestUrl(input);
      if (url.endsWith("/notifications/settings")) return createSettingsResponse();
      if (init?.method === "POST") {
        postCount += 1;
        if (postCount === 2) return obsoleteScopeResponse.promise;
        return Response.json({
          subscriptionId: postCount === 3 ? "new-subscription" : "old-subscription",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(postCount).toBe(1));
    let obsoleteToggle: Promise<void>;
    act(() => {
      obsoleteToggle = result.current.togglePaneEnabled();
    });
    await waitFor(() => expect(postCount).toBe(2));

    useSessionsMock.mockReturnValue({
      token: "new-token",
      apiBaseUrl: "/new-api",
      authError: null,
    });
    rerender();

    await waitFor(() => expect(postCount).toBe(3));
    expect(localStorage.getItem("vde-monitor-push-subscription-id")).toBe("new-subscription");

    obsoleteScopeResponse.resolve(Response.json({ subscriptionId: "obsolete-subscription" }));
    await act(async () => {
      await obsoleteToggle!;
    });
    expect(localStorage.getItem("vde-monitor-push-subscription-id")).toBe("new-subscription");
  });

  it("stops an obsolete permission flow after the notification context changes", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    const permission = createDeferred<NotificationPermission>();
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: vi.fn(() => permission.promise),
    });
    installPushSubscription();
    const postedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = readRequestUrl(input);
      if (url.endsWith("/notifications/settings")) return createSettingsResponse();
      if (init?.method === "POST") {
        postedUrls.push(url);
        return Response.json({ subscriptionId: `subscription-${postedUrls.length}` });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(postedUrls).toEqual(["/api/notifications/subscriptions"]));

    let obsoletePermissionFlow: Promise<void>;
    act(() => {
      obsoletePermissionFlow = result.current.requestPermissionAndSubscribe();
    });
    await waitFor(() => expect(result.current.status).toBe("requesting-permission"));

    useSessionsMock.mockReturnValue({
      token: "new-token",
      apiBaseUrl: "/new-api",
      authError: null,
    });
    rerender();
    await waitFor(() =>
      expect(postedUrls).toEqual([
        "/api/notifications/subscriptions",
        "/new-api/notifications/subscriptions",
      ]),
    );

    permission.resolve("granted");
    await act(async () => {
      await obsoletePermissionFlow!;
    });
    expect(postedUrls).toEqual([
      "/api/notifications/subscriptions",
      "/new-api/notifications/subscriptions",
    ]);
    expect(result.current.status).toBe("subscribed");
  });

  it("stops obsolete initialization while service worker readiness is pending", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    const ready = createDeferred<ServiceWorkerRegistration>();
    const getSubscription = vi.fn().mockResolvedValue({
      endpoint: "https://push.example/subscription",
      toJSON: () => ({
        endpoint: "https://push.example/subscription",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      }),
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: ready.promise },
    });
    const postedUrls: string[] = [];
    const settingsUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = readRequestUrl(input);
      if (url.endsWith("/notifications/settings")) {
        settingsUrls.push(url);
        return createSettingsResponse();
      }
      if (init?.method === "POST") {
        postedUrls.push(url);
        return Response.json({ subscriptionId: "new-subscription" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(settingsUrls).toEqual(["/api/notifications/settings"]));

    useSessionsMock.mockReturnValue({
      token: "new-token",
      apiBaseUrl: "/new-api",
      authError: null,
    });
    rerender();
    await waitFor(() =>
      expect(settingsUrls).toEqual([
        "/api/notifications/settings",
        "/new-api/notifications/settings",
      ]),
    );

    ready.resolve({ pushManager: { getSubscription } } as unknown as ServiceWorkerRegistration);

    await waitFor(() => expect(postedUrls).toEqual(["/new-api/notifications/subscriptions"]));
    expect(getSubscription).toHaveBeenCalledOnce();
  });

  it("keeps the local pane scope when an in-flight sync is aborted by unmount", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    const scopeResponse = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }))
      .mockReturnValueOnce(scopeResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => usePushNotifications({ paneId: "%1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    let toggle: Promise<void>;
    act(() => {
      toggle = result.current.togglePaneEnabled();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe('["%1"]');

    unmount();
    scopeResponse.resolve(Response.json({ subscriptionId: "subscription-1" }));
    await toggle!;

    expect(localStorage.getItem("vde-monitor-push-enabled-pane-ids:v1")).toBe('["%1"]');
  });

  it("reuses device reconciliation while the active pane changes A to B to A", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    vi.stubGlobal("PushManager", class PushManager {});
    vi.stubGlobal("Notification", { permission: "granted" });
    installPushSubscription();
    localStorage.setItem("vde-monitor-push-enabled-pane-ids:v1", '["%1"]');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createSettingsResponse())
      .mockResolvedValueOnce(Response.json({ subscriptionId: "subscription-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(({ paneId }) => usePushNotifications({ paneId }), {
      initialProps: { paneId: "%1" },
    });
    await waitFor(() => {
      expect(result.current.isSubscribed).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(result.current.isPaneEnabled).toBe(true);

    rerender({ paneId: "%2" });
    expect(result.current.isPaneEnabled).toBe(false);
    rerender({ paneId: "%1" });
    expect(result.current.isPaneEnabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readPostedPaneIds(fetchMock)).toEqual([["%1"]]);
  });
});
