/**
 * Local storage that cannot throw.
 *
 * Every call to localStorage on a television is a call that might fail: the quota is small, the
 * store can be disabled outright, and a private session refuses writes while still answering
 * reads. None of that is worth an exception reaching the interface, because none of it is worth
 * interrupting a viewer over. A setting that did not save is a smaller problem than a channel
 * that stopped playing to say so.
 *
 * One implementation, because there were two: the channel store had a read and a write wrapped
 * in try/catch, and the settings store had the same two wrapped again inside its own load and
 * persist, with the same comment above each explaining the same reasoning.
 */

export function read(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A full or disabled store must not stop a channel change.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear, which is the outcome asked for anyway.
  }
}

/** Read and parse, falling back whenever the store or the contents disappoint. */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
