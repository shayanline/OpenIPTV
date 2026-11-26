import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Run a requested focus or scroll handoff after the new DOM commits, before paint. */
export function useLayoutTask() {
  const tasks = useRef<Array<() => void>>([]);
  const [revision, setRevision] = useState(0);
  const enqueue = useCallback((task: () => void) => {
    tasks.current.push(task);
    setRevision((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    if (revision === 0) return;
    const pending = tasks.current;
    tasks.current = [];
    for (const task of pending) task();
  }, [revision]);

  return enqueue;
}
