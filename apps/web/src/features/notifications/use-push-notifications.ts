import { type NotificationSettings, dedupeStrings } from "@vde-monitor/shared";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useLazyRef } from "@/lib/use-lazy-ref";
import { useSessionConfigData } from "@/state/session-context";

const DEVICE_ID_STORAGE_KEY = "vde-monitor-push-device-id";
const SUBSCRIPTION_ID_STORAGE_KEY = "vde-monitor-push-subscription-id";
const ENABLED_PANE_IDS_STORAGE_KEY = "vde-monitor-push-enabled-pane-ids:v1";

export type PushUiStatus =
  | "unsupported"
  | "insecure-context"
  | "needs-ios-install"
  | "idle"
  | "requesting-permission"
  | "subscribing"
  | "subscribed"
  | "denied"
  | "error";

const areStringArraysEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const isSameNotificationSettings = (
  left: NotificationSettings | null,
  right: NotificationSettings | null,
) => {
  if (left == null || right == null) {
    return left === right;
  }
  return (
    left.pushEnabled === right.pushEnabled &&
    left.vapidPublicKey === right.vapidPublicKey &&
    left.requireStandaloneOnIOS === right.requireStandaloneOnIOS &&
    areStringArraysEqual(left.supportedEvents, right.supportedEvents) &&
    areStringArraysEqual(left.enabledEventTypes, right.enabledEventTypes)
  );
};

const readEnabledPaneIds = () => {
  try {
    const raw = localStorage.getItem(ENABLED_PANE_IDS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return dedupeStrings(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
};

const writeEnabledPaneIds = (paneIds: string[]) => {
  localStorage.setItem(ENABLED_PANE_IDS_STORAGE_KEY, JSON.stringify(dedupeStrings(paneIds)));
};

const readOrCreateDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
  if (existing && existing.length > 0) {
    return existing;
  }
  const next =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
};

const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const resolvePlatform = (): "ios" | "android" | "desktop" | "unknown" => {
  const userAgent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return "ios";
  }
  if (/Android/i.test(userAgent)) {
    return "android";
  }
  if (userAgent.trim().length > 0) {
    return "desktop";
  }
  return "unknown";
};

const canUsePushApi = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

type UsePushNotificationsArgs = {
  paneId: string;
};

type PaneScopeSyncContext = {
  key: string;
  generation: number;
  controller: AbortController;
};

export const usePushNotifications = ({ paneId }: UsePushNotificationsArgs) => {
  const { token, apiBaseUrl, authError } = useSessionConfigData();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [status, setStatus] = useState<PushUiStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [enabledPaneIds, setEnabledPaneIds] = useState<string[]>(() => readEnabledPaneIds());
  const subscriptionIdRef = useLazyRef(() => localStorage.getItem(SUBSCRIPTION_ID_STORAGE_KEY));
  const [isSubscribed, setIsSubscribed] = useState(false);
  const deviceIdRef = useLazyRef(() => readOrCreateDeviceId());
  const enabledPaneIdsRef = useRef(enabledPaneIds);
  const confirmedPaneIdsRef = useRef(enabledPaneIds);
  const paneScopePostQueueRef = useLazyRef<Promise<void>>(() => Promise.resolve());
  const paneScopeSyncVersionRef = useRef(0);

  const apiBasePath = useMemo(() => {
    const normalized = apiBaseUrl?.trim();
    return normalized && normalized.length > 0 ? normalized : "/api";
  }, [apiBaseUrl]);
  const paneScopeContextKey = `${apiBasePath}\0${token ?? ""}`;
  const paneScopeContextRef = useLazyRef<PaneScopeSyncContext>(() => ({
    key: paneScopeContextKey,
    generation: 0,
    controller: new AbortController(),
  }));

  useLayoutEffect(() => {
    const previous = paneScopeContextRef.current;
    if (previous.key !== paneScopeContextKey || previous.controller.signal.aborted) {
      previous.controller.abort();
      paneScopeContextRef.current = {
        key: paneScopeContextKey,
        generation: previous.generation + 1,
        controller: new AbortController(),
      };
      paneScopePostQueueRef.current = Promise.resolve();
      paneScopeSyncVersionRef.current += 1;
    }
    const active = paneScopeContextRef.current;
    return () => {
      active.controller.abort();
      if (paneScopeContextRef.current === active) {
        paneScopeSyncVersionRef.current += 1;
      }
    };
  }, [paneScopeContextKey, paneScopeContextRef, paneScopePostQueueRef]);

  const isPaneEnabled = enabledPaneIds.includes(paneId);
  const pushEnabled = settings?.pushEnabled ?? false;

  const postSubscription = useCallback(
    async (subscription: PushSubscription, paneIds: string[], context: PaneScopeSyncContext) => {
      if (
        !token ||
        context.key !== paneScopeContextKey ||
        context !== paneScopeContextRef.current ||
        context.controller.signal.aborted
      ) {
        return false;
      }
      let response: Response;
      try {
        response = await fetch(`${apiBasePath}/notifications/subscriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            deviceId: deviceIdRef.current,
            subscription: subscription.toJSON(),
            scope: {
              paneIds,
            },
            client: {
              platform: resolvePlatform(),
              standalone: isStandalone(),
              userAgent: navigator.userAgent,
            },
          }),
          signal: context.controller.signal,
        });
      } catch (error) {
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        throw error;
      }
      if (context !== paneScopeContextRef.current || context.controller.signal.aborted)
        return false;
      if (!response.ok) {
        let message = `Failed to upsert subscription (${response.status})`;
        try {
          const payload = (await response.json()) as { error?: { message?: string } };
          if (payload.error?.message) {
            message = `${message}: ${payload.error.message}`;
          }
        } catch {
          // ignore
        }
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        setErrorMessage(message);
        setStatus("error");
        return false;
      }
      const data = (await response.json()) as { subscriptionId?: string };
      if (context !== paneScopeContextRef.current || context.controller.signal.aborted)
        return false;
      if (data.subscriptionId) {
        localStorage.setItem(SUBSCRIPTION_ID_STORAGE_KEY, data.subscriptionId);
        subscriptionIdRef.current = data.subscriptionId;
      }
      setErrorMessage(null);
      setStatus("subscribed");
      setIsSubscribed(true);
      return true;
    },
    [apiBasePath, deviceIdRef, paneScopeContextKey, paneScopeContextRef, subscriptionIdRef, token],
  );

  const enqueuePaneScopePost = useCallback(
    (
      paneIds: string[],
      post: (scope: string[], context: PaneScopeSyncContext) => Promise<boolean>,
    ) => {
      const scope = dedupeStrings(paneIds);
      const context = paneScopeContextRef.current;
      const queued = paneScopePostQueueRef.current.then(async () => {
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        const synced = await post(scope, context);
        if (synced && context === paneScopeContextRef.current) {
          confirmedPaneIdsRef.current = scope;
        }
        return synced;
      });
      paneScopePostQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [paneScopeContextRef, paneScopePostQueueRef],
  );

  const upsertSubscription = useCallback(
    (subscription: PushSubscription, paneIds: string[]) =>
      enqueuePaneScopePost(paneIds, (scope, context) =>
        postSubscription(subscription, scope, context),
      ),
    [enqueuePaneScopePost, postSubscription],
  );

  const revokeServerSubscription = useCallback(
    async (endpoint: string | undefined) => {
      if (!token) {
        return;
      }
      const currentSubscriptionId =
        subscriptionIdRef.current ?? localStorage.getItem(SUBSCRIPTION_ID_STORAGE_KEY);
      if (currentSubscriptionId) {
        await fetch(
          `${apiBasePath}/notifications/subscriptions/${encodeURIComponent(currentSubscriptionId)}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        return;
      }
      await fetch(`${apiBasePath}/notifications/subscriptions/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceId: deviceIdRef.current,
          endpoint,
        }),
      });
    },
    [apiBasePath, deviceIdRef, subscriptionIdRef, token],
  );

  const disableNotifications = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) return;
      if (!("serviceWorker" in navigator)) {
        if (!isCurrent()) return;
        localStorage.removeItem(SUBSCRIPTION_ID_STORAGE_KEY);
        subscriptionIdRef.current = null;
        setIsSubscribed(false);
        setStatus("idle");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        if (!isCurrent()) return;
        const current = await registration.pushManager.getSubscription();
        if (!isCurrent()) return;
        try {
          await revokeServerSubscription(current?.endpoint);
        } catch {
          // best-effort server revoke
        }
        if (!isCurrent()) return;
        await current?.unsubscribe();
      } catch {
        // continue local cleanup
      } finally {
        if (isCurrent()) {
          localStorage.removeItem(SUBSCRIPTION_ID_STORAGE_KEY);
          subscriptionIdRef.current = null;
          setIsSubscribed(false);
          setStatus("idle");
        }
      }
    },
    [revokeServerSubscription, subscriptionIdRef],
  );

  const syncCurrentSubscription = useCallback(
    (paneIds: string[]) =>
      enqueuePaneScopePost(paneIds, async (scope, context) => {
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        if (!("serviceWorker" in navigator)) {
          return false;
        }
        const registration = await navigator.serviceWorker.ready;
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        const current = await registration.pushManager.getSubscription();
        if (context !== paneScopeContextRef.current || context.controller.signal.aborted) {
          return false;
        }
        if (!current) {
          setIsSubscribed(false);
          setStatus("idle");
          return false;
        }
        return postSubscription(current, scope, context);
      }),
    [enqueuePaneScopePost, paneScopeContextRef, postSubscription],
  );

  const requestPermissionAndSubscribe = useCallback(async () => {
    if (!token || settings == null || authError != null) {
      return;
    }
    if (!settings.pushEnabled) {
      setStatus("idle");
      return;
    }
    if (!window.isSecureContext) {
      setStatus("insecure-context");
      return;
    }
    if (!canUsePushApi()) {
      setStatus("unsupported");
      return;
    }
    if (isIOS() && settings.requireStandaloneOnIOS && !isStandalone()) {
      setStatus("needs-ios-install");
      return;
    }
    const context = paneScopeContextRef.current;
    const isCurrentContext = () =>
      context.key === paneScopeContextKey &&
      context === paneScopeContextRef.current &&
      !context.controller.signal.aborted;

    try {
      setStatus("requesting-permission");
      const permission = await Notification.requestPermission();
      if (!isCurrentContext()) return;
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "idle");
        return;
      }

      setStatus("subscribing");
      const registration = await navigator.serviceWorker.ready;
      if (!isCurrentContext()) return;
      let current = await registration.pushManager.getSubscription();
      if (!isCurrentContext()) return;
      if (!current) {
        // PushManager.subscribe creates a browser push subscription; this effect does not own a
        // callback subscription handle that can be released during React cleanup.
        // react-doctor-disable-next-line effect-needs-cleanup
        current = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(settings.vapidPublicKey),
        });
        if (!isCurrentContext()) return;
      }
      await upsertSubscription(current, enabledPaneIdsRef.current);
    } catch (error) {
      if (!isCurrentContext()) return;
      const message =
        error instanceof Error ? error.message : "Failed to subscribe push notification";
      setErrorMessage(message);
      setStatus("error");
    }
  }, [authError, paneScopeContextKey, paneScopeContextRef, settings, token, upsertSubscription]);

  const togglePaneEnabled = useCallback(async () => {
    const previousPaneIds = enabledPaneIdsRef.current;
    const nextPaneIds = previousPaneIds.includes(paneId)
      ? previousPaneIds.filter((id) => id !== paneId)
      : dedupeStrings([...previousPaneIds, paneId]);
    const syncVersion = paneScopeSyncVersionRef.current + 1;
    paneScopeSyncVersionRef.current = syncVersion;
    enabledPaneIdsRef.current = nextPaneIds;
    setEnabledPaneIds(nextPaneIds);
    writeEnabledPaneIds(nextPaneIds);
    if (isSubscribed && settings?.pushEnabled) {
      let synced = false;
      try {
        synced = await syncCurrentSubscription(nextPaneIds);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update push notification scope";
        setErrorMessage(message);
        setStatus("error");
      }
      if (!synced && paneScopeSyncVersionRef.current === syncVersion) {
        const rollbackPaneIds = confirmedPaneIdsRef.current;
        enabledPaneIdsRef.current = rollbackPaneIds;
        setEnabledPaneIds(rollbackPaneIds);
        writeEnabledPaneIds(rollbackPaneIds);
      }
    }
  }, [isSubscribed, paneId, settings?.pushEnabled, syncCurrentSubscription]);

  // Push availability and subscription state must be reconciled when notification context changes.
  // Every post-await state update below is guarded by isCurrentRun(), which includes both the
  // effect cancellation flag and its AbortController signal.
  // react-doctor-disable-next-line no-fetch-in-effect, no-set-state-after-await-in-effect
  useEffect(() => {
    let cancelled = false;
    const context = paneScopeContextRef.current;
    const isCurrentRun = () =>
      !cancelled && context === paneScopeContextRef.current && !context.controller.signal.aborted;
    const run = async () => {
      if (!token || authError != null) {
        if (!cancelled) {
          setSettings(null);
          setStatus("idle");
          setIsSubscribed(false);
        }
        return;
      }
      if (!window.isSecureContext) {
        if (!cancelled) {
          setStatus("insecure-context");
          setIsSubscribed(false);
        }
        return;
      }
      if (!canUsePushApi()) {
        if (!cancelled) {
          setStatus("unsupported");
          setIsSubscribed(false);
        }
        return;
      }

      try {
        const response = await fetch(`${apiBasePath}/notifications/settings`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!isCurrentRun()) return;
        if (!response.ok) {
          if (!cancelled) {
            setErrorMessage(`Failed to load push settings (${response.status})`);
            setStatus("error");
          }
          return;
        }
        const data = (await response.json()) as { settings?: NotificationSettings };
        if (!isCurrentRun()) return;
        const nextSettings = data.settings ?? null;
        if (!nextSettings) {
          if (!cancelled) {
            setErrorMessage("Invalid push settings response");
            setStatus("error");
          }
          return;
        }
        if (!isCurrentRun()) return;
        setSettings((prev) =>
          isSameNotificationSettings(prev, nextSettings) ? prev : nextSettings,
        );
        if (isIOS() && nextSettings.requireStandaloneOnIOS && !isStandalone()) {
          setStatus("needs-ios-install");
          return;
        }
        if (Notification.permission === "denied") {
          setStatus("denied");
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        if (!isCurrentRun()) return;
        const current = await registration.pushManager.getSubscription();
        if (!isCurrentRun()) return;
        if (!nextSettings.pushEnabled) {
          if (current) {
            await disableNotifications(isCurrentRun);
          } else {
            setStatus("idle");
            setIsSubscribed(false);
          }
          return;
        }
        if (current) {
          setIsSubscribed(true);
          setStatus("subscribed");
          await upsertSubscription(current, readEnabledPaneIds());
          return;
        }
        setIsSubscribed(false);
        setStatus("idle");
      } catch (error) {
        if (!isCurrentRun()) return;
        const message =
          error instanceof Error ? error.message : "Failed to initialize push notifications";
        setErrorMessage(message);
        setStatus("error");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    apiBasePath,
    authError,
    disableNotifications,
    paneScopeContextRef,
    token,
    upsertSubscription,
  ]);

  return {
    status,
    pushEnabled,
    isSubscribed,
    isPaneEnabled,
    errorMessage,
    requestPermissionAndSubscribe,
    disableNotifications,
    togglePaneEnabled,
  };
};
