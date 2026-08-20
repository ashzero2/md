import { useEffect, useState } from "react";
import { getBacklinks } from "../lib/ipc";

/**
 * Fetches and tracks the backlink count for the currently active note path.
 * Returns 0 when no note is active or the fetch fails.
 */
export function useBacklinksCount(activePath: string | null): number {
  const [backlinksCount, setBacklinksCount] = useState(0);

  useEffect(() => {
    let disposed = false;
    if (!activePath) {
      setBacklinksCount(0);
      return;
    }
    getBacklinks(activePath)
      .then((links) => {
        if (!disposed) setBacklinksCount(links.length);
      })
      .catch(() => {
        if (!disposed) setBacklinksCount(0);
      });
    return () => {
      disposed = true;
    };
  }, [activePath]);

  return backlinksCount;
}
