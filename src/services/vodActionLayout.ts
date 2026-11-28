export function detailActionColumns(count: number): number {
  return count === 4 ? 3 : Math.max(1, Math.min(2, count - 1));
}

export function stepDetailAction(
  index: number,
  count: number,
  direction: "up" | "down" | "start" | "end",
): number {
  if (count <= 1) return 0;
  const current = Math.max(0, Math.min(count - 1, index));
  const columns = detailActionColumns(count);
  if (direction === "up") return current <= columns ? 0 : current - columns;
  if (direction === "down") {
    if (current === 0) return 1;
    const nextRow = Math.floor((current - 1) / columns) + 1;
    return nextRow * columns + 1 < count ? Math.min(count - 1, current + columns) : current;
  }
  if (current === 0) return current;
  const column = (current - 1) % columns;
  if (direction === "start") return column > 0 ? current - 1 : current;
  return column + 1 < columns && current + 1 < count ? current + 1 : current;
}
