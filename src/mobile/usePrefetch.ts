import { useEffect } from 'react';
import { loadMedia } from './media-cache';
import { prefetchIds } from './motion';

export function usePrefetch(ids: string[] | undefined, index: number, enabled: boolean) {
  useEffect(() => {
    if (!ids || !enabled) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        // One background lookup at a time; native players join these requests.
        for (const id of prefetchIds(ids, index)) {
          if (abort.signal.aborted) break;
          try { await loadMedia(id, abort.signal); } catch { /* Visible slots own retry and error presentation. */ }
        }
      })();
    }, 120);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [ids, index, enabled]);
}
