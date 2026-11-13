import { folderLink, folderSelect, parseSession, restoreSession, workFrom, workSelect, type Point, type Scope, type Session } from './model.ts';

type Value = string | number | null;
export type QueryDb = {
  runAsync: (sql: string, values?: Value[]) => Promise<unknown>;
  getFirstAsync: <T>(sql: string, values?: Value[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, values?: Value[]) => Promise<T[]>;
};
export type Folder = { id: string; title: string; local: number; count: number };
export type SaveUndo = { id: string; token: string; saved: number | null; reset: boolean; members: string[] };
export type Continuation = { token: string; session: Session; scope: Scope; title: string };
export function validName(value: string) { const name = value.trim(); if (!name || [...name].length > 40) throw new Error('请输入 1–40 个字符。'); return name; }
async function exists(db: QueryDb, id: string) { if (!await db.getFirstAsync('SELECT 1 FROM library_works WHERE id=?', [id])) throw new Error('作品已不在内容库中。'); }
async function stamp(db: QueryDb, id: string) {
  const token = (await db.getFirstAsync<{ token: string }>('SELECT lower(hex(randomblob(16))) token'))!.token;
  await db.runAsync("INSERT INTO mobile_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [`saved-change:${id}`, token]); return token;
}
export async function readFolders(db: QueryDb) {
  return db.getAllAsync<Folder>(`SELECT f.*, (SELECT count(*) ${workFrom} WHERE COALESCE(m.saved,EXISTS(SELECT 1 FROM library_memberships b WHERE b.work_id=w.id AND b.source='favorites'))=1 AND ${folderLink}) count FROM (${folderSelect}) f ORDER BY f.title,f.id`);
}
export async function createFolder(db: QueryDb, title: string) {
  const name = validName(title); const id = (await db.getFirstAsync<{ id: string }>("SELECT 'local:'||lower(hex(randomblob(16))) id"))!.id;
  await db.runAsync('INSERT INTO mobile_folders(id,title,is_local) VALUES(?,?,1)', [id, name]); return id;
}
export async function editFolder(db: QueryDb, id: string, title: string | null) {
  if (!await db.getFirstAsync(`SELECT 1 FROM (${folderSelect}) WHERE id=?`, [id])) throw new Error('收藏夹已不存在。');
  if (title === null) await db.runAsync('INSERT INTO mobile_folders(id,deleted) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET deleted=1', [id]);
  else await db.runAsync('INSERT INTO mobile_folders(id,title) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title', [id, validName(title)]);
}
export async function workGroups(db: QueryDb, id: string) {
  return (await db.getAllAsync<{ id: string }>(`SELECT f.id ${workFrom} CROSS JOIN (${folderSelect}) f WHERE w.id=? AND COALESCE(m.saved,EXISTS(SELECT 1 FROM library_memberships b WHERE b.work_id=w.id AND b.source='favorites'))=1 AND ${folderLink}`, [id])).map(row => row.id);
}
// These operations run inside the caller's transaction, preserving all-or-nothing changes.
export async function setSaved(db: QueryDb, id: string, saved: boolean): Promise<SaveUndo | null> {
  await exists(db, id);
  const before = await db.getFirstAsync<{ saved: number | null }>('SELECT saved FROM mobile_marks WHERE work_id=?', [id]);
  const effective = await db.getFirstAsync<{ saved: number }>(`${workSelect} WHERE w.id=?`, [id]);
  const undo = !saved ? { id, token: '', saved: before?.saved ?? null, reset: Boolean(await db.getFirstAsync('SELECT 1 FROM mobile_group_resets WHERE work_id=?', [id])), members: (await db.getAllAsync<{ folder_id: string }>('SELECT folder_id FROM mobile_folder_memberships WHERE work_id=?', [id])).map(row => row.folder_id) } : null;
  if (!saved || !effective?.saved) {
    await db.runAsync('INSERT OR IGNORE INTO mobile_group_resets VALUES(?)', [id]);
    await db.runAsync('DELETE FROM mobile_folder_memberships WHERE work_id=?', [id]);
  }
  await db.runAsync('INSERT INTO mobile_marks(work_id,saved) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET saved=excluded.saved', [id, saved ? 1 : 0]);
  const token = await stamp(db, id); return undo ? { ...undo, token } : null;
}
export async function undoSaved(db: QueryDb, undo: SaveUndo) {
  const current = await db.getFirstAsync<{ value: string }>('SELECT value FROM mobile_state WHERE key=?', [`saved-change:${undo.id}`]);
  if (current?.value !== undo.token || !await db.getFirstAsync('SELECT 1 FROM library_works WHERE id=?', [undo.id])) return false;
  await db.runAsync('UPDATE mobile_marks SET saved=? WHERE work_id=?', [undo.saved, undo.id]);
  await db.runAsync('DELETE FROM mobile_group_resets WHERE work_id=?', [undo.id]);
  if (undo.reset) await db.runAsync('INSERT INTO mobile_group_resets VALUES(?)', [undo.id]);
  await db.runAsync('DELETE FROM mobile_folder_memberships WHERE work_id=?', [undo.id]);
  for (const id of undo.members) await db.runAsync('INSERT INTO mobile_folder_memberships VALUES(?,?)', [id, undo.id]);
  await stamp(db, undo.id); return true;
}
export async function assignGroups(db: QueryDb, id: string, groups: string[]) {
  await exists(db, id); const unique = [...new Set(groups)];
  for (const group of unique) if (!await db.getFirstAsync(`SELECT 1 FROM (${folderSelect}) WHERE id=?`, [group])) throw new Error('收藏夹已变更，请重新选择。');
  await db.runAsync('INSERT INTO mobile_marks(work_id,saved) VALUES(?,1) ON CONFLICT(work_id) DO UPDATE SET saved=1', [id]);
  await db.runAsync('INSERT OR IGNORE INTO mobile_group_resets VALUES(?)', [id]);
  await db.runAsync('DELETE FROM mobile_folder_memberships WHERE work_id=?', [id]);
  for (const group of unique) await db.runAsync('INSERT INTO mobile_folder_memberships VALUES(?,?)', [group, id]);
  await stamp(db, id);
}
export async function resetLocal(db: QueryDb, kind: 'likes' | 'favorites' | 'groups' | 'all') {
  if (kind === 'likes' || kind === 'all') await db.runAsync('UPDATE mobile_marks SET liked=NULL');
  if (kind === 'favorites' || kind === 'all') await db.runAsync('UPDATE mobile_marks SET saved=NULL');
  if (kind === 'groups' || kind === 'all') {
    for (const table of ['mobile_folder_memberships', 'mobile_group_resets', 'mobile_folders']) await db.runAsync(`DELETE FROM ${table}`);
  }
  if (kind !== 'likes') await db.runAsync("DELETE FROM mobile_state WHERE key LIKE 'saved-change:%'");
}
export async function addSearch(db: QueryDb, text: string, now = Date.now()) {
  const term = text.trim(); if (!term) return;
  await db.runAsync('INSERT INTO mobile_searches VALUES(?,?) ON CONFLICT(term) DO UPDATE SET used_at=excluded.used_at', [term.slice(0, 200), now]);
  await db.runAsync('DELETE FROM mobile_searches WHERE term NOT IN (SELECT term FROM mobile_searches ORDER BY used_at DESC,term LIMIT 20)');
}
export function pointFrom(kind: unknown, value: unknown): Point | null { return (kind === 'video' || kind === 'gallery') && typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { kind, value: kind === 'gallery' ? Math.floor(value) : value } : null; }
export async function visit(db: QueryDb, token: string, id: string, point: Point | null, snapshot?: Omit<Continuation, 'token'>, now = Date.now()) {
  if (!await db.getFirstAsync('SELECT 1 FROM library_works WHERE id=?', [id])) return;
  await db.runAsync('INSERT INTO mobile_history VALUES(?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET watched_at=excluded.watched_at,point_kind=excluded.point_kind,point_value=excluded.point_value', [id, now, point?.kind ?? null, point?.value ?? null]);
  if (snapshot) {
    await db.runAsync("INSERT INTO mobile_state VALUES('continue:queue',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify({ token, ids: snapshot.session.ids, mode: snapshot.session.mode, scope: snapshot.scope, title: snapshot.title })]);
    await db.runAsync("INSERT INTO mobile_state VALUES('continue:owner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [token]);
  }
  const owner = await db.getFirstAsync<{ value: string }>("SELECT value FROM mobile_state WHERE key='continue:owner'");
  if (owner?.value !== token) return;
  await db.runAsync("INSERT INTO mobile_state VALUES('continue:point',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify({ id, point })]);
}
export async function updateWatchPoint(db: QueryDb, token: string, id: string, point: Point) {
  await db.runAsync('UPDATE mobile_history SET point_kind=?,point_value=? WHERE work_id=?', [point.kind, point.value, id]);
  const owner = await db.getFirstAsync<{ value: string }>("SELECT value FROM mobile_state WHERE key='continue:owner'");
  const p = await db.getFirstAsync<{ value: string }>("SELECT value FROM mobile_state WHERE key='continue:point'");
  try { if (owner?.value !== token || JSON.parse(p?.value ?? '{}').id !== id) return; } catch { return; }
  await db.runAsync("UPDATE mobile_state SET value=? WHERE key='continue:point'", [JSON.stringify({ id, point })]);
}
export async function removeHistory(db: QueryDb, id?: string) {
  await db.runAsync(id ? 'DELETE FROM mobile_history WHERE work_id=?' : 'DELETE FROM mobile_history', id ? [id] : []);
  const p = await db.getFirstAsync<{ value: string }>("SELECT value FROM mobile_state WHERE key='continue:point'");
  let matches = !id; try { matches ||= JSON.parse(p?.value ?? '{}').id === id; } catch { /* Corrupt state can be discarded. */ }
  if (matches) await db.runAsync("DELETE FROM mobile_state WHERE key IN ('continue:queue','continue:point','continue:owner')");
}
export async function clearLibraryData(db: QueryDb) {
  for (const table of ['mobile_history','mobile_folder_memberships','mobile_group_resets','mobile_folders','mobile_marks','library_folder_works','library_folders','library_memberships','review_bookmark','library_works','mobile_searches']) await db.runAsync(`DELETE FROM ${table}`);
  await db.runAsync("DELETE FROM mobile_state WHERE key NOT IN ('preferences','nickname')");
}
export function decodeContinuation(queue: string | null, position: string | null, pool: string[]): Continuation | null {
  try {
    const q = JSON.parse(queue ?? '{}'); const p = JSON.parse(position ?? '{}'); const index = q.ids.indexOf(p.id);
    if (typeof q.token !== 'string' || q.token === 'legacy' || index < 0 || !parseSession(JSON.stringify({ ...q, index, point: p.point }))) return null;
    const session = restoreSession(JSON.stringify({ ...q, index, point: p.point }), pool, 'ordered');
    if (!session.ids.length || session.ids[session.index] !== p.id) return null;
    // The saved ID snapshot is authoritative; continuation is independent of later filters/marks.
    return { token: q.token, session, scope: { source: 'all' }, title: typeof q.title === 'string' ? q.title : '继续观看' };
  } catch { return null; }
}
