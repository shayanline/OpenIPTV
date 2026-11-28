type CountState = "idle" | "loading" | "loaded" | "empty" | "failed" | "too-large";
type CountFrame = { state: CountState; items: readonly { categoryKey: string }[] };

/*
 * Category badges answer "how many titles does the provider say live here" without ever
 * asking the provider for them. The order is deliberate: a category frame that already
 * finished loading is the only count measured from real items, a declared provider total
 * is next because the provider asserts it, and a fully loaded all-titles index is the
 * last resort because it only exists after an explicit load. Anything else stays
 * undefined rather than guessing, so badges never trigger catalogue requests, per
 * category fanout, disk scans, or persisted counts.
 */
const countsByItems = new WeakMap<CountFrame["items"], Map<string, number>>();

function countLoaded(items: CountFrame["items"], categoryKey: string): number {
  let counts = countsByItems.get(items);
  if (!counts) {
    counts = new Map();
    for (const item of items) {
      counts.set(item.categoryKey, (counts.get(item.categoryKey) ?? 0) + 1);
    }
    countsByItems.set(items, counts);
  }
  return counts.get(categoryKey) ?? 0;
}

export function knownCategoryCount(
  categoryKey: string,
  declared: number | undefined,
  category: CountFrame | undefined,
  indexState?: CountState,
  indexedItems?: readonly unknown[],
): number | undefined {
  if (category && (category.state === "loaded" || category.state === "empty")) {
    return countLoaded(category.items, categoryKey);
  }
  if (declared !== undefined && Number.isSafeInteger(declared) && declared >= 0)
    return declared;
  if (indexState === "loaded" || indexState === "empty") return indexedItems?.length ?? 0;
  return undefined;
}
