import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readReviewBookmark, readReviewQueue, shuffleWorkIds, writeReviewPoint, writeReviewPosition, writeReviewQueue,
  type LibraryScope, type ReviewBookmark, type ReviewPoint, type ReviewQueue,
} from './library-store';

export type ReviewSelection = ReviewBookmark & { key: number };

export function useReview() {
  const [tab, setTab] = useState<'review' | 'library'>('library');
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<ReviewSelection | null>(null);
  const lastPoint = useRef<ReviewPoint | null>(null);
  const lastSaved = useRef(0);
  const playbackKey = useRef(0);
  const request = useRef(0);
  const pendingWrites = useRef(Promise.resolve());
  const stopPlayback = useRef<(() => void) | null>(null);

  const save = useCallback((operation: () => Promise<void>) => {
    pendingWrites.current = pendingWrites.current.then(operation).catch(() => {
      setError('未能保存回看进度。');
    });
  }, []);

  const select = useCallback((bookmark: ReviewBookmark) => {
    const next = { ...bookmark, key: ++playbackKey.current };
    active.current = next;
    lastPoint.current = next.point;
    lastSaved.current = Date.now();
    setSelection(next);
  }, []);

  useEffect(() => {
    const version = ++request.current;
    async function restore() {
      try {
        const bookmark = await readReviewBookmark();
        if (request.current !== version) return;
        if (bookmark) select(bookmark);
      } catch {
        if (request.current === version) setError('无法读取上次回看记录。');
      } finally {
        if (request.current === version) setStarting(false);
      }
    }
    void restore();
    return () => { request.current++; };
  }, [select]);

  const start = useCallback(async (scope: LibraryScope, mode: ReviewQueue['mode'], workId?: string) => {
    const version = ++request.current;
    setStarting(true);
    setError('');
    try {
      const queue = await readReviewQueue(scope, mode);
      if (request.current !== version) return;
      const index = workId ? queue.ids.indexOf(workId) : 0;
      if (!queue.ids.length || index < 0) {
        setError('当前列表没有可回看的作品。');
        return;
      }
      stopPlayback.current?.();
      select({ queue, index, point: null });
      save(() => writeReviewQueue(queue, queue.ids[index]));
      setTab('review');
    } catch {
      if (request.current === version) setError('无法建立回看队列，请重试。');
    } finally {
      if (request.current === version) setStarting(false);
    }
  }, [save, select]);

  const showLibrary = useCallback(() => {
    request.current++;
    setStarting(false);
    stopPlayback.current?.();
    setTab('library');
  }, []);

  function showReview(scope: LibraryScope) {
    if (tab === 'review' || starting) return;
    if (active.current) {
      select({ ...active.current, point: lastPoint.current });
      setTab('review');
    } else {
      void start(scope, 'ordered');
    }
  }

  function reshuffle(key: number) {
    const current = active.current;
    if (current?.key !== key || current.queue.ids.length < 2) return;
    const queue: ReviewQueue = { mode: 'shuffle', ids: shuffleWorkIds(current.queue.ids, current.queue.ids[current.index]) };
    stopPlayback.current?.();
    select({ queue, index: 0, point: null });
    save(() => writeReviewQueue(queue, queue.ids[0]));
  }

  const move = useCallback((index: number, key: number) => {
    const current = active.current;
    if (!current || current.key !== key || index === current.index || !current.queue.ids[index]) return false;
    stopPlayback.current?.();
    const { queue } = current;
    select({ queue, index, point: null });
    save(() => writeReviewPosition(queue.ids[index]));
    return true;
  }, [save, select]);

  const checkpoint = useCallback((key: number, point: ReviewPoint, force: boolean) => {
    const current = active.current;
    if (current?.key !== key || !Number.isFinite(point.value) || point.value < 0) return;
    lastPoint.current = point;
    const now = Date.now();
    if (!force && now - lastSaved.current < 3000) return;
    lastSaved.current = now;
    save(() => writeReviewPoint(current.queue.ids[current.index], point));
  }, [save]);

  return { tab, selection, error, starting, stopPlayback, checkpoint, move, start, reshuffle, showLibrary, showReview };
}
