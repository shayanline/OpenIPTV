import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";

type Handler = (() => void) | null;

class FakeRequest<T = unknown> {
  result!: T;
  error: unknown = null;
  onsuccess: Handler = null;
  onerror: Handler = null;

  succeed(value: T) {
    this.result = value;
    this.onsuccess?.();
  }

  fail(error: unknown) {
    this.error = error;
    this.onerror?.();
  }
}

class FakeTransaction {
  error: unknown = null;
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  requests: FakeRequest[] = [];
  operation = "";
  key: unknown;
  value: unknown;

  get request() {
    return this.requests[0];
  }

  enqueue(): FakeRequest {
    const request = new FakeRequest();
    this.requests.push(request);
    return request;
  }

  store = {
    get: (key: unknown) => {
      this.operation = "get";
      this.key = key;
      return this.enqueue();
    },
    put: (value: unknown, key: unknown) => {
      this.operation = "put";
      this.key = key;
      this.value = value;
      return this.enqueue();
    },
    delete: (key: unknown) => {
      this.operation = "delete";
      this.key = key;
      return this.enqueue();
    },
    clear: () => {
      this.operation = "clear";
      return this.enqueue();
    },
  };

  objectStore() {
    return this.store;
  }

  complete() {
    this.oncomplete?.();
  }

  abortWith(error: unknown) {
    this.error = error;
    this.onabort?.();
  }

  abort() {
    if (this.error === null) this.error = new Error("transaction aborted");
    this.onabort?.();
  }
}

class FakeDatabase {
  objectStoreNames = { contains: (name: string) => this.stores.includes(name) };
  stores: string[] = [];
  created: string[] = [];
  transactions: FakeTransaction[] = [];
  onversionchange: Handler = null;
  closed = false;

  createObjectStore(name: string) {
    this.stores.push(name);
    this.created.push(name);
    return {};
  }

  transaction() {
    const transaction = new FakeTransaction();
    this.transactions.push(transaction);
    return transaction;
  }

  close() {
    this.closed = true;
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

class FakeFactory {
  calls: Array<{ name: string; version: number }> = [];
  requests: FakeOpenRequest[] = [];

  open(name: string, version: number) {
    this.calls.push({ name, version });
    const request = new FakeOpenRequest();
    this.requests.push(request);
    return request;
  }
}

async function opened(factory: FakeFactory) {
  const disk = await import("../src/services/personalDisk");
  const pending = disk.readLineup("pl-1");
  const request = factory.requests[0];
  const database = new FakeDatabase();
  request.result = database;
  request.onupgradeneeded?.();
  request.succeed(database);
  await Promise.resolve();
  return { disk, pending, database };
}

beforeEach(() => {
  vi.resetModules();
});

test("opens the dedicated version one database with one out of line store", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await pending;
  assert.deepEqual(factory.calls, [
    { name: disk.PERSONAL_DB_NAME, version: disk.PERSONAL_DB_VERSION },
  ]);
  assert.deepEqual(database.created, [disk.LINEUPS_STORE]);
});

test("version change closes the connection and the next operation reopens", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await pending;
  database.onversionchange?.();
  assert.equal(database.closed, true);
  const next = disk.readLineup("pl-2");
  assert.equal(factory.requests.length, 2);
  const reopened = new FakeDatabase();
  factory.requests[1].succeed(reopened);
  await Promise.resolve();
  reopened.transactions[0].request.succeed(undefined);
  reopened.transactions[0].complete();
  assert.equal(await next, null);
});

test("reads a missing or stored lineup by playlist id", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  assert.equal(await pending, null);
  const saved = disk.readLineup("pl-2");
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.request.succeed({ version: 1 });
  transaction.complete();
  assert.deepEqual(await saved, { version: 1 });
  assert.equal(transaction.key, "pl-2");
});

test("a write resolves only when its transaction completes", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  let settled = false;
  const pending = disk.writeLineup("pl-1", { version: 1 }).then(() => {
    settled = true;
  });
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.request.succeed(undefined);
  await Promise.resolve();
  assert.equal(settled, false);
  transaction.complete();
  await pending;
  assert.equal(settled, true);
  assert.equal(transaction.operation, "put");
  assert.equal(transaction.key, "pl-1");
});

test("an aborted transaction reports a durable write failure", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const pending = disk.writeLineup("pl-1", { version: 1 });
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.request.succeed(undefined);
  transaction.abortWith(new DOMException("full", "QuotaExceededError"));
  await assert.rejects(pending, { operation: "write" });
});

test("request quota failure rejects the write", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const pending = disk.writeLineup("pl-1", {});
  await Promise.resolve();
  database.transactions[1].request.fail(new DOMException("full", "QuotaExceededError"));
  await assert.rejects(pending, { operation: "write" });
});

test("blocked open rejects and a later call retries", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const disk = await import("../src/services/personalDisk");
  const first = disk.readLineup("pl-1");
  factory.requests[0].onblocked?.();
  await assert.rejects(first, { operation: "open" });
  const second = disk.readLineup("pl-1");
  assert.equal(factory.requests.length, 2);
  const database = new FakeDatabase();
  factory.requests[1].succeed(database);
  await Promise.resolve();
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  assert.equal(await second, null);
});

test("removes one playlist and clears only the lineup store", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const removal = disk.removeLineup("pl-2");
  await Promise.resolve();
  const removeTransaction = database.transactions[1];
  removeTransaction.request.succeed(undefined);
  removeTransaction.complete();
  await removal;
  assert.equal(removeTransaction.operation, "delete");
  assert.equal(removeTransaction.key, "pl-2");
  const clearing = disk.clearLineups();
  await Promise.resolve();
  const clearTransaction = database.transactions[2];
  clearTransaction.request.succeed(undefined);
  clearTransaction.complete();
  await clearing;
  assert.equal(clearTransaction.operation, "clear");
});

test("writeLineupIfAbsent puts inside the same transaction only when absent", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const inserted = disk.writeLineupIfAbsent("pl-1", { version: 1 });
  await Promise.resolve();
  const transaction = database.transactions[1];
  assert.equal(transaction.requests.length, 1);
  transaction.requests[0].succeed(undefined);
  await Promise.resolve();
  assert.equal(transaction.requests.length, 2);
  assert.equal(transaction.operation, "put");
  assert.equal(transaction.key, "pl-1");
  transaction.requests[1].succeed(undefined);
  transaction.complete();
  assert.equal(await inserted, true);
});

test("writeLineupIfAbsent reports false and writes nothing for an existing key", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const inserted = disk.writeLineupIfAbsent("pl-1", { version: 1 });
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.requests[0].succeed({ version: 1, revision: 3 });
  transaction.complete();
  assert.equal(await inserted, false);
  assert.equal(transaction.requests.length, 1);
});

test("writeLineupIfAbsent rejects when the conditional put throws synchronously", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const inserted = disk.writeLineupIfAbsent("pl-1", { version: 1 });
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.store.put = () => {
    throw new Error("quota");
  };
  transaction.requests[0].succeed(undefined);
  await assert.rejects(inserted);
  assert.equal(transaction.requests.length, 1);
});

test("writeLineupIfAbsent rejects when the put request fails asynchronously", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const inserted = disk.writeLineupIfAbsent("pl-1", { version: 1 });
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.requests[0].succeed(undefined);
  await Promise.resolve();
  assert.equal(transaction.requests.length, 2);
  transaction.requests[1].fail(new Error("quota"));
  transaction.abortWith(new Error("quota"));
  await assert.rejects(inserted);
});

test("writeLineupIfAbsent rejects when the transaction aborts after the put succeeds", async () => {
  const factory = new FakeFactory();
  vi.stubGlobal("indexedDB", factory);
  const { disk, pending: initial, database } = await opened(factory);
  database.transactions[0].request.succeed(undefined);
  database.transactions[0].complete();
  await initial;
  const inserted = disk.writeLineupIfAbsent("pl-1", { version: 1 });
  let settled: "pending" | "resolved" | "rejected" = "pending";
  void inserted.then(
    () => {
      settled = "resolved";
    },
    () => {
      settled = "rejected";
    },
  );
  await Promise.resolve();
  const transaction = database.transactions[1];
  transaction.requests[0].succeed(undefined);
  await Promise.resolve();
  transaction.requests[1].succeed(undefined);
  await Promise.resolve();
  assert.equal(settled, "pending");
  transaction.abort();
  await assert.rejects(inserted);
  assert.equal(settled, "rejected");
});
