import type { SessionSummary } from "@vde-monitor/shared";

const NOTIFICATION_TITLE_DB_NAME = "vde-monitor-local-notification-titles";
const NOTIFICATION_TITLE_STORE_NAME = "session_titles";
const NOTIFICATION_TITLE_DB_VERSION = 1;

type NotificationTitleSession = Pick<
  SessionSummary,
  "paneId" | "customTitle" | "title" | "sessionName"
>;

type StoredNotificationSessionTitle = {
  paneId: string;
  title: string;
  updatedAt: number;
};

export type NotificationSessionTitleEntry = {
  paneId: string;
  title: string;
};

const normalizePaneId = (paneId: string) => paneId.trim();

const normalizeTitle = (title: string) => title.trim();

const openNotificationTitleDb = async (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  return await new Promise((resolve) => {
    const request = indexedDB.open(NOTIFICATION_TITLE_DB_NAME, NOTIFICATION_TITLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTIFICATION_TITLE_STORE_NAME)) {
        db.createObjectStore(NOTIFICATION_TITLE_STORE_NAME, { keyPath: "paneId" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
    request.onblocked = () => {
      resolve(null);
    };
  });
};

const normalizeEntries = (entries: NotificationSessionTitleEntry[]) => {
  const deduped = new Map<string, string>();
  entries.forEach((entry) => {
    const paneId = normalizePaneId(entry.paneId);
    if (paneId.length === 0) {
      return;
    }
    const title = normalizeTitle(entry.title);
    if (title.length === 0) {
      return;
    }
    deduped.set(paneId, title);
  });
  return deduped;
};

const withReadWriteTransaction = async (
  db: IDBDatabase,
  apply: (store: IDBObjectStore, done: () => void) => void,
) => {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(NOTIFICATION_TITLE_STORE_NAME, "readwrite");
    const store = tx.objectStore(NOTIFICATION_TITLE_STORE_NAME);
    const done = () => resolve();
    tx.oncomplete = done;
    tx.onabort = done;
    tx.onerror = done;
    apply(store, done);
  });
};

export const resolveNotificationSessionTitle = (session: NotificationTitleSession) => {
  const primary = session.customTitle ?? session.title ?? session.sessionName;
  const normalizedPrimary = normalizeTitle(primary);
  if (normalizedPrimary.length > 0) {
    return normalizedPrimary;
  }
  const normalizedPaneId = normalizePaneId(session.paneId);
  return normalizedPaneId.length > 0 ? normalizedPaneId : session.sessionName;
};

export const toNotificationSessionTitleEntries = (sessions: NotificationTitleSession[]) => {
  const deduped = new Map<string, string>();
  sessions.forEach((session) => {
    const paneId = normalizePaneId(session.paneId);
    if (paneId.length === 0) {
      return;
    }
    deduped.set(paneId, resolveNotificationSessionTitle(session));
  });
  return Array.from(deduped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([paneId, title]) => ({ paneId, title }));
};

export const buildNotificationSessionTitleFingerprint = (
  entries: NotificationSessionTitleEntry[],
) =>
  toNotificationSessionTitleEntries(
    entries.map((entry) => ({
      paneId: entry.paneId,
      customTitle: entry.title,
      title: null,
      sessionName: entry.paneId,
    })),
  )
    .map((entry) => `${entry.paneId}\u0001${entry.title}`)
    .join("\u0002");

export const upsertLocalNotificationSessionTitle = async (entry: NotificationSessionTitleEntry) => {
  const entries = normalizeEntries([entry]);
  if (entries.size === 0) {
    return;
  }
  const db = await openNotificationTitleDb();
  if (!db) {
    return;
  }
  const nowMs = Date.now();
  try {
    await withReadWriteTransaction(db, (store) => {
      entries.forEach((title, paneId) => {
        store.put({
          paneId,
          title,
          updatedAt: nowMs,
        } satisfies StoredNotificationSessionTitle);
      });
    });
  } finally {
    db.close();
  }
};

export const syncLocalNotificationSessionTitles = async (
  entries: NotificationSessionTitleEntry[],
) => {
  const normalized = normalizeEntries(entries);
  const db = await openNotificationTitleDb();
  if (!db) {
    return;
  }
  const nowMs = Date.now();
  try {
    await withReadWriteTransaction(db, (store) => {
      normalized.forEach((title, paneId) => {
        store.put({
          paneId,
          title,
          updatedAt: nowMs,
        } satisfies StoredNotificationSessionTitle);
      });
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          return;
        }
        if (typeof cursor.key !== "string") {
          cursor.delete();
          cursor.continue();
          return;
        }
        const paneId = cursor.key;
        if (!normalized.has(paneId)) {
          cursor.delete();
        }
        cursor.continue();
      };
    });
  } finally {
    db.close();
  }
};
