import type { LibraryImport } from '../library-format.ts';
import { effectiveLike, effectiveSave, folderSelect, mobileSchema, parseSession, queueQuery, workFrom, workSelect, whereScope, type Point, type Scope, type Session, type Work } from './model.ts';
import * as local from './local-data.ts';
import type { QueryDb, Continuation, SaveUndo } from './local-data.ts';
import type { SQLiteDatabase } from 'expo-sqlite';
function queries(db: Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>): QueryDb {
  return { runAsync: (sql, values = []) => db.runAsync(sql, values), getFirstAsync: <T>(sql: string, values: (string | number | null)[] = []) => db.getFirstAsync<T>(sql, values), getAllAsync: <T>(sql: string, values: (string | number | null)[] = []) => db.getAllAsync<T>(sql, values) };
}

export type StoreDependencies = { open: () => Promise<SQLiteDatabase>; mergeLibrary: (library: LibraryImport, db: SQLiteDatabase) => Promise<void>; countDuplicates: (library: LibraryImport, db: SQLiteDatabase) => Promise<number> };
export function createStore({ open, mergeLibrary, countDuplicates }: StoreDependencies) {
  let ready: ReturnType<typeof open> | undefined;
  let pendingWrites = Promise.resolve();
  function write<T>(operation: () => Promise<T>): Promise<T> {
    const next = pendingWrites.then(operation);
    pendingWrites = next.then(() => undefined, () => undefined);
    return next;
  }
  function importCollection(library: LibraryImport) { return write(async () => mergeLibrary(library, await database())); }
  function database() {
    return ready ??= open().then(async db => { await db.execAsync(mobileSchema); return db; }).catch(error => { ready = undefined; throw error; });
  }
  function transaction<T>(action: (db: QueryDb) => Promise<T>) { return write(async () => { let result: T; await (await database()).withExclusiveTransactionAsync(async tx => { result = await action(queries(tx)); }); return result!; }); }
  const from = workFrom;
  const normalize = <T extends Work>(work: T): T => ({ ...work, liked: Boolean(work.liked), saved: Boolean(work.saved) });
  async function page(scope: Scope, offset = 0, limit = 60) {
    await pendingWrites;
    const db = await database(); const query = whereScope(scope);
    const items = await db.getAllAsync<Work>(`${workSelect} ${query.where} ORDER BY w.published_at DESC,w.id DESC LIMIT ? OFFSET ?`, [...query.values, Math.max(60, Math.floor(limit)), offset]);
    const total = offset === 0 ? (await db.getFirstAsync<{ n: number }>(`SELECT count(*) n ${from} ${query.where}`, query.values))?.n ?? 0 : null;
    return { items: items.map(normalize), total };
  }
  async function queueIds(scope: Scope) {
    await pendingWrites;
    const db = await database(); const query = queueQuery(scope);
    return (await db.getAllAsync<{ id: string }>(query.sql, query.values)).map(row => row.id);
  }
  async function work(id: string) { await pendingWrites; const row = await (await database()).getFirstAsync<Work>(`${workSelect} WHERE w.id=?`, id); return row ? normalize(row) : null; }
  function mark(id: string, key: 'liked' | 'saved', value: boolean) { return transaction(async db => {
    if (key === 'saved') return local.setSaved(db, id, value);
    await db.runAsync('INSERT INTO mobile_marks(work_id,liked) SELECT ?,? WHERE EXISTS(SELECT 1 FROM library_works WHERE id=?) ON CONFLICT(work_id) DO UPDATE SET liked=excluded.liked', [id, value ? 1 : 0, id]); return null;
  }); }
  function undoSaved(undo: SaveUndo) { return transaction(db => local.undoSaved(db, undo)); }
  async function folders() { await pendingWrites; return local.readFolders(queries(await database())); }
  async function groups(id: string) { await pendingWrites; return local.workGroups(queries(await database()), id); }
  function createFolder(title: string) { return transaction(db => local.createFolder(db, title)); }
  function editFolder(id: string, title: string | null) { return transaction(db => local.editFolder(db, id, title)); }
  function assignGroups(id: string, ids: string[]) { return transaction(db => local.assignGroups(db, id, ids)); }
  function resetLocal(kind: 'likes' | 'favorites' | 'groups' | 'all') { return transaction(db => local.resetLocal(db, kind)); }
  async function searches() { await pendingWrites; return (await (await database()).getAllAsync<{ term: string }>('SELECT term FROM mobile_searches ORDER BY used_at DESC,term LIMIT 20')).map(row => row.term); }
  function addSearch(term: string) { return transaction(db => local.addSearch(db, term)); }
  function removeSearch(term?: string) { return write(async () => { await (await database()).runAsync(term === undefined ? 'DELETE FROM mobile_searches' : 'DELETE FROM mobile_searches WHERE term=?', term === undefined ? [] : [term]); }); }
  function visit(token: string, id: string, point: Point | null, snapshot?: Omit<Continuation, 'token'>) { return transaction(db => local.visit(db, token, id, point, snapshot)); }
  function updateWatchPoint(token: string, id: string, point: Point) { return transaction(db => local.updateWatchPoint(db, token, id, point)); }
  async function continuation() {
    await pendingWrites; const db = await database(); const [rows, pool] = await Promise.all([db.getAllAsync<{ key: string; value: string }>("SELECT key,value FROM mobile_state WHERE key IN ('continue:queue','continue:point')"), queueIds({ source: 'all' })]);
    return local.decodeContinuation(rows.find(row => row.key === 'continue:queue')?.value ?? null, rows.find(row => row.key === 'continue:point')?.value ?? null, pool);
  }

  async function history(offset = 0, limit = 60) {
    await pendingWrites; return (await (await database()).getAllAsync<HistoryWork>(`${workSelect.replace('SELECT ', 'SELECT h.watched_at AS watchedAt,h.point_kind AS pointKind,h.point_value AS pointValue,')} JOIN mobile_history h ON h.work_id=w.id WHERE h.watched_at>0 ORDER BY h.watched_at DESC,w.id DESC LIMIT ? OFFSET ?`, Math.max(60, Math.floor(limit)), offset)).map(normalize);
  }
  async function historyIds() { await pendingWrites; return (await (await database()).getAllAsync<{ id: string }>('SELECT work_id id FROM mobile_history h JOIN library_works w ON w.id=h.work_id WHERE h.watched_at>0 ORDER BY h.watched_at DESC,w.id DESC')).map(row => row.id); }
  function removeHistory(id?: string) { return transaction(db => local.removeHistory(db, id)); }
  async function databaseBytes() { await pendingWrites; const db = await database(); const size = await db.getFirstAsync<{ page_size: number }>('PRAGMA page_size'); const pages = await db.getFirstAsync<{ page_count: number }>('PRAGMA page_count'); return (size?.page_size ?? 0) * (pages?.page_count ?? 0); }
  async function accountOverview() {
    await pendingWrites; const db = await database();
    const [totals, extra] = await Promise.all([counts(), db.getFirstAsync<{ folders: number; history: number; searches: number }>(`SELECT (SELECT count(*) FROM (${folderSelect})) folders,(SELECT count(*) FROM mobile_history h JOIN library_works w ON w.id=h.work_id WHERE h.watched_at>0) history,(SELECT count(*) FROM mobile_searches) searches`)]);
    return { ...totals, ...(extra ?? { folders: 0, history: 0, searches: 0 }) };
  }
  function clearLibrary() { return transaction(local.clearLibraryData); }
  async function counts() {
    await pendingWrites;
    return await (await database()).getFirstAsync<{ all: number; likes: number; favorites: number }>(
      `SELECT count(*) AS 'all',COALESCE(sum(${effectiveLike}),0) AS likes,COALESCE(sum(${effectiveSave}),0) AS favorites ${from}`,
    ) ?? { all: 0, likes: 0, favorites: 0 };
  }
  async function readState(key: string) { await pendingWrites; return (await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM mobile_state WHERE key=?', key))?.value ?? null; }
  function writeState(key: string, value: unknown) { return write(async () => { await (await database()).runAsync('INSERT INTO mobile_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }); }
  async function readBookmark(key: string): Promise<string | null> {
    const [rawQueue, rawPoint] = await Promise.all([readState(`queue:${key}`), readState(`point:${key}`)]);
    try {
      const q = JSON.parse(rawQueue ?? 'null'); const p = JSON.parse(rawPoint ?? 'null');
      if (!q || !Array.isArray(q.ids)) return null;
      const index = q.ids.indexOf(p?.id);
      const value = JSON.stringify({ ...q, index: Math.max(0, index), point: index >= 0 ? p.point : null });
      return parseSession(value) ? value : null;
    } catch { return null; }
  }
  function writeBookmarkQueue(key: string, session: Session) { return write(async () => {
    const db = await database();
    await db.withExclusiveTransactionAsync(async tx => {
      if (!await tx.getFirstAsync('SELECT 1 FROM library_works WHERE id=?', session.ids[session.index] ?? '')) return;
      for (const [entry, value] of [[`queue:${key}`, { ids: session.ids, mode: session.mode }], [`point:${key}`, { id: session.ids[session.index], point: session.point }]] as const) {
        await tx.runAsync('INSERT INTO mobile_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', entry, JSON.stringify(value));
      }
    });
  }); }
  async function writeBookmarkPoint(key: string, id: string, point: Point | null) { await write(async () => { await (await database()).runAsync('INSERT INTO mobile_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM library_works WHERE id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `point:${key}`, JSON.stringify({ id, point }), id); }); }
  async function dates(scope: Scope) {
    await pendingWrites;
    const query = whereScope(scope, true);
    const rows = await (await database()).getAllAsync<{ value: string | null }>(`SELECT DISTINCT strftime('%Y-%m',w.published_at/1000.0,'unixepoch','+8 hours') value ${from} ${query.where} ORDER BY value DESC`, query.values);
    const years = new Map<number, number[]>();
    for (const { value } of rows) if (value) { const [year, month] = value.split('-').map(Number); years.set(year, [...(years.get(year) ?? []), month]); }
    return { years: [...years].map(([year, months]) => ({ year, months })), unknown: rows.some(row => row.value === null) };
  }

  async function duplicateCount(library: LibraryImport) { await pendingWrites; return countDuplicates(library, await database()); }
  return { database, importCollection, duplicateCount, page, queueIds, work, mark, undoSaved, folders, groups, createFolder, editFolder, assignGroups, resetLocal, searches, addSearch, removeSearch, visit, updateWatchPoint, continuation, history, historyIds, removeHistory, databaseBytes, accountOverview, clearLibrary, counts, readState, writeState, readBookmark, writeBookmarkQueue, writeBookmarkPoint, dates };
}
export type MobileStore = ReturnType<typeof createStore>;
export type HistoryWork = Work & { watchedAt: number; pointKind: string | null; pointValue: number | null };
