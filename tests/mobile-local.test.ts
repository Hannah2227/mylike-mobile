import { deepEqual, equal, rejects } from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { mobileSchema, queueQuery, type Session } from '../src/mobile/model.ts';
import { addSearch, assignGroups, clearLibraryData, createFolder, decodeContinuation, editFolder, readFolders, removeHistory, resetLocal, setSaved, undoSaved, updateWatchPoint, validName, visit, workGroups, type QueryDb } from '../src/mobile/local-data.ts';

const id = '7637322941528689935'; const second = '7696196366620022011';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE library_works(id TEXT PRIMARY KEY,title TEXT,author TEXT,published_at INTEGER,kind TEXT,cover_url TEXT,source_order INTEGER);
    CREATE TABLE library_memberships(source TEXT,work_id TEXT,PRIMARY KEY(source,work_id));
    CREATE TABLE library_folders(id TEXT PRIMARY KEY,title TEXT,exported_at INTEGER);
    CREATE TABLE library_folder_works(folder_id TEXT,work_id TEXT,PRIMARY KEY(folder_id,work_id));
    CREATE TABLE review_bookmark(singleton INTEGER PRIMARY KEY,queue TEXT,work_id TEXT,point_kind TEXT,point_value REAL);${mobileSchema}`);
  sqlite.prepare('INSERT INTO library_works VALUES(?,?,?,?,?,?,?)').run(id, '视频', '同名作者', 1, 'video', null, null);
  sqlite.prepare('INSERT INTO library_works VALUES(?,?,?,?,?,?,?)').run(second, '图集', '同名作者', 2, 'gallery', null, null);
  sqlite.prepare('INSERT INTO library_memberships VALUES(?,?)').run('favorites', id);
  sqlite.prepare('INSERT INTO library_memberships VALUES(?,?)').run('likes', id);
  sqlite.exec("INSERT INTO library_folders VALUES('imported','原名',1);INSERT INTO library_folder_works VALUES('imported','7637322941528689935');");
  const db: QueryDb = {
    runAsync: async (sql, values = []) => sqlite.prepare(sql).run(...values),
    getFirstAsync: async <T>(sql: string, values: (string | number | null)[] = []) => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, values: (string | number | null)[] = []) => sqlite.prepare(sql).all(...values) as T[],
  };
  const inTransaction = async <T>(action: () => Promise<T>) => { sqlite.exec('BEGIN'); try { const value = await action(); sqlite.exec('COMMIT'); return value; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } };
  const queue = (folderId?: string) => { const q = queueQuery({ source: 'favorites', folderId }); return sqlite.prepare(q.sql).all(...q.values).map(row => row.id); };
  return { db, sqlite, inTransaction, queue, close: () => sqlite.close() };
}

test('folder renames/deletions survive reimport; same-name local folders stay separate', async () => {
  const f = fixture(); try {
    const local = await createFolder(f.db, '原名'); equal(local.startsWith('local:'), true); equal((await readFolders(f.db)).length, 2);
    await editFolder(f.db, 'imported', '本机名称'); f.sqlite.exec("UPDATE library_folders SET title='较新导入名',exported_at=2");
    equal((await readFolders(f.db)).find(row => row.id === 'imported')?.title, '本机名称');
    await editFolder(f.db, 'imported', null); f.sqlite.exec("INSERT OR IGNORE INTO library_folders VALUES('imported','原名',3)");
    deepEqual(f.queue(), [id]); deepEqual(f.queue('imported'), []); deepEqual(f.queue('unfiled'), [id]);
    equal((await readFolders(f.db))[0].id, local); equal(f.sqlite.prepare('SELECT title FROM library_folders').get()?.title, '较新导入名');
  } finally { f.close(); }
});
test('explicit membership is preserved, invalid folder changes roll back, and grouping implies local saved', async () => {
  const f = fixture(); try {
    const group = await createFolder(f.db, '本机夹');
    await f.inTransaction(() => assignGroups(f.db, id, [group, group])); deepEqual(await workGroups(f.db, id), [group]);
    f.sqlite.exec("INSERT INTO library_folders VALUES('new-import','新增导入夹',2);INSERT INTO library_folder_works VALUES('new-import','7637322941528689935');");
    deepEqual(f.queue('new-import'), []); deepEqual(f.queue(group), [id]); equal((await readFolders(f.db)).find(row => row.id === group)?.count, 1);
    await rejects(f.inTransaction(() => assignGroups(f.db, id, ['missing'])), /收藏夹/); deepEqual(await workGroups(f.db, id), [group]);
    await f.inTransaction(() => assignGroups(f.db, second, [group])); equal(f.queue(group).length, 2);
  } finally { f.close(); }
});
test('unsaving clears effective groups; immediate undo restores them and stale undo cannot overwrite later edits', async () => {
  const f = fixture(); try {
    const undo = await f.inTransaction(() => setSaved(f.db, id, false)); equal(Boolean(undo), true); deepEqual(f.queue(), []);
    equal(await undoSaved(f.db, undo!), true); deepEqual(await workGroups(f.db, id), ['imported']);
    const old = await setSaved(f.db, id, false); await setSaved(f.db, id, true); deepEqual(await workGroups(f.db, id), []);
    equal(await undoSaved(f.db, old!), false); deepEqual(f.queue('unfiled'), [id]);
    await assignGroups(f.db, id, ['imported']); const another = await setSaved(f.db, id, false); await assignGroups(f.db, id, []);
    equal(await undoSaved(f.db, another!), false); deepEqual(await workGroups(f.db, id), []);
  } finally { f.close(); }
});
test('selective reset restores only the requested layer and preserves history, points and original import relations', async () => {
  const f = fixture(); try {
    await assignGroups(f.db, id, []); await editFolder(f.db, 'imported', null);
    f.sqlite.exec("UPDATE mobile_marks SET liked=0;INSERT INTO mobile_history VALUES('7637322941528689935',1,'video',12);INSERT INTO mobile_state VALUES('point:home:all','keep');");
    await resetLocal(f.db, 'groups'); deepEqual(await workGroups(f.db, id), ['imported']); equal(f.sqlite.prepare('SELECT liked FROM mobile_marks').get()?.liked, 0);
    await setSaved(f.db, id, false); await resetLocal(f.db, 'favorites'); deepEqual(f.queue(), [id]); deepEqual(await workGroups(f.db, id), []);
    await resetLocal(f.db, 'all'); deepEqual(await workGroups(f.db, id), ['imported']); equal(f.sqlite.prepare('SELECT liked FROM mobile_marks').get()?.liked, null);
    equal(f.sqlite.prepare('SELECT count(*) n FROM mobile_history').get()?.n, 1); equal(f.sqlite.prepare("SELECT value FROM mobile_state WHERE key='point:home:all'").get()?.value, 'keep');
    equal(f.sqlite.prepare('SELECT count(*) n FROM library_memberships').get()?.n, 2);
  } finally { f.close(); }
});
test('history deduplicates real visits, late progress cannot steal continuation or recreate cleared rows', async () => {
  const f = fixture(); try {
    const session: Session = { ids: [id, second], index: 0, mode: 'ordered', point: null };
    await visit(f.db, 'first', id, { kind: 'video', value: 5 }, { session, scope: { source: 'all' }, title: '回看' }, 1);
    await visit(f.db, 'second', second, { kind: 'gallery', value: 1 }, { session: { ...session, index: 1 }, scope: { source: 'all' }, title: '图集' }, 2);
    await updateWatchPoint(f.db, 'first', id, { kind: 'video', value: 8 });
    const p = f.sqlite.prepare("SELECT value FROM mobile_state WHERE key='continue:point'").get()?.value as string; equal(JSON.parse(p).id, second);
    await visit(f.db, 'second', second, { kind: 'gallery', value: 2 }, undefined, 3); equal(f.sqlite.prepare('SELECT count(*) n FROM mobile_history').get()?.n, 2);
    await removeHistory(f.db, second); await updateWatchPoint(f.db, 'second', second, { kind: 'gallery', value: 4 });
    equal(f.sqlite.prepare('SELECT count(*) n FROM mobile_history').get()?.n, 1); equal(f.sqlite.prepare("SELECT count(*) n FROM mobile_state WHERE key='continue:queue'").get()?.n, 0);
    await removeHistory(f.db); await updateWatchPoint(f.db, 'first', id, { kind: 'video', value: 9 }); equal(f.sqlite.prepare('SELECT count(*) n FROM mobile_history').get()?.n, 0);
  } finally { f.close(); }
});
test('search history is submitted-only storage, bounded, deduplicated and literal', async () => {
  const f = fixture(); try {
    for (let i = 0; i < 30; i++) await addSearch(f.db, `词 ${i}`, i);
    await addSearch(f.db, "%' OR 1=1", 31); await addSearch(f.db, '词 29', 32); await addSearch(f.db, '  ', 33);
    equal(f.sqlite.prepare('SELECT count(*) n FROM mobile_searches').get()?.n, 20); equal(f.sqlite.prepare('SELECT term FROM mobile_searches ORDER BY used_at DESC LIMIT 1').get()?.term, '词 29');
    equal(validName('  MyLike  '), 'MyLike');
  } finally { f.close(); }
});
test('clearing the library removes bookmarks and imported/local relations, keeps preferences and ignores late visits', async () => {
  const f = fixture(); try {
    await assignGroups(f.db, id, ['imported']); await addSearch(f.db, '词');
    await visit(f.db, 'active', id, { kind: 'video', value: 10 }, { session: { ids: [id], index: 0, mode: 'ordered', point: null }, scope: { source: 'all' }, title: '回看' });
    f.sqlite.exec("INSERT INTO mobile_state VALUES('nickname','\"MyLike\"'),('preferences','{}'),('migration:legacy','1');");
    await f.inTransaction(() => clearLibraryData(f.db));
    await visit(f.db, 'late', id, { kind: 'video', value: 15 }); await updateWatchPoint(f.db, 'active', id, { kind: 'video', value: 20 });
    for (const table of ['library_works','library_folders','library_memberships','mobile_folders','mobile_marks','mobile_history','mobile_searches']) equal(f.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get()?.n, 0);
    deepEqual(f.sqlite.prepare('SELECT key FROM mobile_state ORDER BY key').all().map(row => row.key), ['nickname','preferences']);
  } finally { f.close(); }
});
test('continuation restores only current mobile sessions and never substitutes a missing current work', () => {
  const q = { token: 'current', ids: [id, second], mode: 'ordered' }; const p = JSON.stringify({ id, point: { kind: 'video', value: 10 } });
  equal(decodeContinuation(JSON.stringify(q), p, [id, second])?.session.ids[0], id);
  equal(decodeContinuation(JSON.stringify(q), p, [second]), null);
  equal(decodeContinuation('{bad json', p, [id]), null);
  equal(decodeContinuation(JSON.stringify({ ...q, token: 'legacy' }), p, [id, second]), null);
});
