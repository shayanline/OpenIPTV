export const PERSONAL_DB_NAME = "openiptv-personal";
export const PERSONAL_DB_VERSION = 1;
export const LINEUPS_STORE = "lineups";

type PersonalDiskOperation = "open" | "read" | "write" | "remove" | "clear";

export class PersonalDiskError extends Error {
  readonly operation: PersonalDiskOperation;
  readonly cause?: unknown;

  constructor(operation: PersonalDiskOperation, cause?: unknown) {
    super(`Personal lineup ${operation} failed`);
    this.name = "PersonalDiskError";
    this.operation = operation;
    this.cause = cause;
  }
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const fail = (cause?: unknown) => {
      failed = true;
      reject(new PersonalDiskError("open", cause));
    };
    if (typeof indexedDB === "undefined") {
      fail();
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(PERSONAL_DB_NAME, PERSONAL_DB_VERSION);
    } catch (error) {
      fail(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LINEUPS_STORE)) {
        request.result.createObjectStore(LINEUPS_STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        opening = null;
      };
      resolve(database);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail();
  });
  opening = pending;
  void pending.catch(() => {
    if (opening === pending) opening = null;
  });
  return pending;
}

async function transact<T>(
  operation: Exclude<PersonalDiskOperation, "open">,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest<T>,
  onSuccess?: (result: T, store: IDBObjectStore) => void,
): Promise<T | null> {
  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch (error) {
    if (error instanceof PersonalDiskError) throw error;
    throw new PersonalDiskError("open", error);
  }
  return new Promise<T | null>((resolve, reject) => {
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    let objectStore!: IDBObjectStore;
    let result: T | null = null;
    let failed = false;
    const rejectOnce = (cause?: unknown) => {
      if (failed) return;
      failed = true;
      reject(new PersonalDiskError(operation, cause));
    };
    try {
      transaction = database.transaction([LINEUPS_STORE], mode);
      objectStore = transaction.objectStore(LINEUPS_STORE);
      request = requestFor(objectStore);
    } catch (error) {
      rejectOnce(error);
      return;
    }
    request.onsuccess = () => {
      result = request.result ?? null;
      if (onSuccess) {
        try {
          onSuccess(request.result as T, objectStore);
        } catch (error) {
          rejectOnce(error);
          try {
            transaction.abort();
          } catch {
            // The transaction is already finished.
          }
        }
      }
    };
    request.onerror = () => rejectOnce(request.error);
    transaction.onerror = () => rejectOnce(transaction.error);
    transaction.onabort = () => rejectOnce(transaction.error);
    transaction.oncomplete = () => {
      if (!failed) resolve(result);
    };
  });
}

export function readLineup(playlistId: string): Promise<unknown | null> {
  return transact("read", "readonly", (store) => store.get(playlistId));
}

export async function writeLineup(playlistId: string, value: unknown): Promise<void> {
  await transact("write", "readwrite", (store) => store.put(value, playlistId));
}

export async function writeLineupIfAbsent(
  playlistId: string,
  value: unknown,
): Promise<boolean> {
  let inserted = false;
  await transact<unknown>(
    "write",
    "readwrite",
    (store) => store.get(playlistId),
    (result, objectStore) => {
      if (result === undefined) {
        const put = objectStore.put(value, playlistId);
        put.onsuccess = () => {
          inserted = true;
        };
      }
    },
  );
  return inserted;
}

export async function removeLineup(playlistId: string): Promise<void> {
  await transact("remove", "readwrite", (store) => store.delete(playlistId));
}

export async function clearLineups(): Promise<void> {
  await transact("clear", "readwrite", (store) => store.clear());
}
