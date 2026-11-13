import { useCallback, useEffect, useRef, useState } from 'react';
import { restoreSession, shuffled, type Point, type Scope, type Session } from './model';
import { useMobile } from './context';
let activationNumber = 0;

export function useSession(key: string, scope: Scope, initial?: Session, title = '继续观看') {
  const { store } = useMobile(); const { queueIds, readBookmark, updateWatchPoint, visit, writeBookmarkPoint, writeBookmarkQueue } = store;
  const [session, setSession] = useState<Session | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const persistent = key.startsWith('home:');
  const current = useRef<Session | null>(null);
  const point = useRef<Point | null>(null);
  const generation = useRef(0);
  const savedAt = useRef(0);
  const keyRef = useRef(key); keyRef.current = key;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const initialRef = useRef(initial); initialRef.current = initial;
  const titleRef = useRef(title); titleRef.current = title;
  const watched = useRef(''); const token = useRef(''); const queueRecorded = useRef(false);
  const enqueue = useCallback((operation: () => Promise<void>) => {
    void operation().catch(() => setError('未能保存播放进度，请重试。'));
  }, []);
  const suspend = useCallback(() => {
    const value = current.current; const last = point.current;
    if (watched.current && value && last) { const activeToken = token.current; const id = watched.current; enqueue(() => updateWatchPoint(activeToken, id, last)); }
    watched.current = ''; token.current = ''; queueRecorded.current = false;
  }, [enqueue]);
  const select = useCallback((value: Session, replaceQueue = true) => {
    const previousPoint = point.current; const previousId = watched.current; const activeToken = token.current;
    if (previousId && previousPoint) enqueue(() => updateWatchPoint(activeToken, previousId, previousPoint));
    watched.current = ''; if (replaceQueue) { token.current = ''; queueRecorded.current = false; }
    current.current = value; point.current = value.point; savedAt.current = Date.now(); setSession(value);
    const storageKey = keyRef.current;
    if (replaceQueue) { setVersion(v => v + 1); if (persistent) enqueue(() => writeBookmarkQueue(storageKey, value)); }
    else if (persistent) enqueue(() => writeBookmarkPoint(storageKey, value.ids[value.index], value.point));
  }, [enqueue, persistent]);
  useEffect(() => {
    const request = ++generation.current; let mounted = true;
    setLoading(true); setError('');
    const task = initialRef.current ? Promise.resolve(initialRef.current) : Promise.all([queueIds(scopeRef.current), readBookmark(key)])
      .then(([pool, saved]) => restoreSession(saved, pool, scopeRef.current.source === 'all' && key.startsWith('home:') ? 'shuffle' : 'ordered'));
    void task.then(value => { if (mounted && request === generation.current) select(value); })
      .catch(() => { if (mounted) setError('无法建立播放队列。'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => {
      mounted = false; generation.current++;
      suspend();
      const value = current.current; const last = point.current;
      if (persistent && value?.ids[value.index]) enqueue(() => writeBookmarkPoint(key, value.ids[value.index], last));
    };
  }, [key, select, enqueue, persistent, suspend]);
  const watch = useCallback((id: string, at: Point) => {
    const active = current.current; if (!active || active.ids[active.index] !== id || watched.current === id) return;
    token.current ||= `${keyRef.current}:${Date.now()}:${++activationNumber}`;
    const activeToken = token.current; const snapshot = !queueRecorded.current ? { session: { ...active, point: at }, scope: scopeRef.current, title: titleRef.current } : undefined;
    watched.current = id; point.current = at; queueRecorded.current = true;
    enqueue(() => visit(activeToken, id, at, snapshot));
  }, [enqueue]);
  const checkpoint = useCallback((id: string, value: Point, force = false) => {
    const active = current.current;
    if (!active || active.ids[active.index] !== id || !Number.isFinite(value.value) || value.value < 0) return;
    point.current = value;
    if (!force && Date.now() - savedAt.current < 3000) return;
    savedAt.current = Date.now(); const storageKey = keyRef.current;
    if (persistent) enqueue(() => writeBookmarkPoint(storageKey, id, value));
    if (watched.current === id) { const activeToken = token.current; enqueue(() => updateWatchPoint(activeToken, id, value)); }
  }, [enqueue, persistent]);
  const moveTo = useCallback((index: number) => {
    const active = current.current;
    if (!active || active.index === index || !active.ids[index]) return false;
    select({ ...active, index, point: null }, false); return true;
  }, [select]);
  const refresh = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const ids = await queueIds(scopeRef.current);
      if (request !== generation.current) return;
      const active = current.current; const mode = keyRef.current.startsWith('home:all') ? 'shuffle' : active?.mode ?? 'ordered';
      select({ ids: mode === 'shuffle' ? shuffled(ids, active?.ids[active.index]) : ids, index: 0, mode, point: null });
    } catch { if (request === generation.current) setError('无法刷新播放队列。'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [select]);
  const reshuffle = useCallback(() => {
    const active = current.current; if (!active?.ids.length) return;
    select({ ids: shuffled(active.ids, active.ids[active.index]), index: 0, mode: 'shuffle', point: null });
  }, [select]);
  const next = useCallback(() => {
    const active = current.current; if (!active) return false;
    if (active.index < active.ids.length - 1) return moveTo(active.index + 1);
    if (keyRef.current === 'home:all') { void refresh(); return true; }
    return false;
  }, [moveTo, refresh]);
  return { session, version, loading, error, checkpoint, moveTo, refresh, reshuffle, next, watch, suspend };
}
