export function recordFromEntries<T>(
  entries: Iterable<readonly [PropertyKey, T]>,
): Record<PropertyKey, T> {
  const result: Record<PropertyKey, T> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
