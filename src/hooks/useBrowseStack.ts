import { useCallback, useState } from "react";

export interface BrowseFrame<T> {
  key: string;
  title: string;
  items: T[];
  cursor: number;
  state: "loading" | "loaded" | "empty" | "failed";
  error?: string;
}

export function useBrowseStack<T>(root: BrowseFrame<T>) {
  const [frames, setFrames] = useState<BrowseFrame<T>[]>([root]);
  const current = frames[frames.length - 1];
  const parent = frames.length > 1 ? frames[frames.length - 2] : undefined;

  const push = useCallback((frame: BrowseFrame<T>) => {
    setFrames((stack) => [...stack, frame]);
  }, []);

  const replace = useCallback((frame: BrowseFrame<T>) => {
    setFrames((stack) => [...stack.slice(0, -1), frame]);
  }, []);

  const replaceIfCurrent = useCallback((key: string, frame: BrowseFrame<T>) => {
    setFrames((stack) =>
      stack[stack.length - 1]?.key === key ? [...stack.slice(0, -1), frame] : stack,
    );
  }, []);

  const pop = useCallback(() => {
    setFrames((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }, []);

  const reset = useCallback((frame: BrowseFrame<T>) => {
    setFrames([frame]);
  }, []);

  const setCursor = useCallback((cursor: number) => {
    setFrames((stack) => [...stack.slice(0, -1), { ...stack[stack.length - 1], cursor }]);
  }, []);

  return {
    current,
    parent,
    trail: frames.map((frame) => ({ key: frame.key, title: frame.title })),
    depth: frames.length,
    push,
    replace,
    replaceIfCurrent,
    pop,
    reset,
    setCursor,
  };
}
