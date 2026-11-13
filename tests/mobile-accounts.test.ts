import { deepEqual, equal, rejects } from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { accountsSchema, addAccount, readAccounts, renameAccount, selectAccount } from '../src/mobile/accounts-data.ts';
import type { QueryDb } from '../src/mobile/local-data.ts';
import { createStore } from '../src/mobile/store-core.ts';

function memory() {
  const sqlite = new DatabaseSync(':memory:');
  const query: QueryDb = {
    runAsync: async (sql, values = []) => sqlite.prepare(sql).run(...values),
    getFirstAsync: async <T>(sql: string, values: (string | number | null)[] = []) => (sqlite.prepare(sql).get(...values) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, values: (string | number | null)[] = []) => sqlite.prepare(sql).all(...values) as T[],
  };
  return { sqlite, query };
}
test('local accounts preserve the original database, custom IDs and the selected account across reopening', async () => {
  const { sqlite, query } = memory(); sqlite.exec(accountsSchema);
  try {
    const initial = await readAccounts(query, '原有名称'); equal(initial.active.database, 'mylike-mobile.db'); equal(initial.active.label, '原有名称');
    const other = await addAccount(query, '第二个 ID', 'second-account'); equal(other.database, 'mylike-account-second-account.db');
    await selectAccount(query, other.id); await renameAccount(query, other.id, '修改后的 ID');
    const reopened = await readAccounts(query); equal(reopened.active.id, other.id); equal(reopened.active.label, '修改后的 ID'); equal(reopened.accounts.length, 2);
    equal((await selectAccount(query, 'default')).database, 'mylike-mobile.db');
    await rejects(selectAccount(query, 'missing'), /不存在/);
    equal((await readAccounts(query)).active.id, 'default');
  } finally { sqlite.close(); }
});
test('invalid and duplicate IDs cannot overwrite another account or choose a database path', async () => {
  const { sqlite, query } = memory(); sqlite.exec(accountsSchema);
  try {
    await readAccounts(query); await addAccount(query, 'Travel', 'travel-account');
    await rejects(addAccount(query, 'travel', 'duplicate-account'), /已被/);
    await rejects(renameAccount(query, 'default', 'TRAVEL'), /已被/);
    await rejects(addAccount(query, '危险路径', '../outside'), /标识/);
    await rejects(addAccount(query, '   ', 'empty-account'), /字符/);
    const value = await readAccounts(query); equal(value.accounts.length, 2); equal(value.active.id, 'default');
  } finally { sqlite.close(); }
});

function content() {
  const { sqlite } = memory();
  sqlite.exec(`CREATE TABLE library_works(id TEXT PRIMARY KEY,title TEXT,author TEXT,published_at INTEGER,kind TEXT,cover_url TEXT,source_order INTEGER);
    CREATE TABLE library_memberships(source TEXT,work_id TEXT,PRIMARY KEY(source,work_id));
    CREATE TABLE library_folders(id TEXT PRIMARY KEY,title TEXT,exported_at INTEGER);
    CREATE TABLE library_folder_works(folder_id TEXT,work_id TEXT,PRIMARY KEY(folder_id,work_id));
    CREATE TABLE review_bookmark(singleton INTEGER PRIMARY KEY,queue TEXT,work_id TEXT,point_kind TEXT,point_value REAL);`);
  type Value = string | number | null;
  const params = (values: unknown[]) => (Array.isArray(values[0]) ? values[0] : values) as Value[];
  const native = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    runAsync: async (sql: string, ...values: unknown[]) => sqlite.prepare(sql).run(...params(values)),
    getFirstAsync: async (sql: string, ...values: unknown[]) => sqlite.prepare(sql).get(...params(values)) ?? null,
    getAllAsync: async (sql: string, ...values: unknown[]) => sqlite.prepare(sql).all(...params(values)),
    withExclusiveTransactionAsync: async (action: (tx: unknown) => Promise<void>) => { sqlite.exec('BEGIN'); try { await action(native); sqlite.exec('COMMIT'); } catch (failure) { sqlite.exec('ROLLBACK'); throw failure; } },
  } as unknown as SQLiteDatabase;
  const store = createStore({ open: async () => native, mergeLibrary: async () => { throw new Error('Not used'); }, countDuplicates: async () => 0 });
  const seed = (id: string) => { sqlite.prepare('INSERT INTO library_works VALUES(?,?,?,?,?,?,?)').run(id, '作品', '作者', 1, 'video', null, null); sqlite.prepare('INSERT INTO library_memberships VALUES(?,?)').run('likes', id); };
  return { store, seed, sqlite };
}
test('independent stores isolate the same work, folders, search, progress and delayed writes across account switches', async () => {
  const a = content(); const b = content(); const id = '7637322941528689935';
  a.seed(id); b.seed(id);
  try {
    const folder = await a.store.createFolder('只属于 A'); await a.store.assignGroups(id, [folder]);
    await a.store.mark(id, 'liked', false); await a.store.addSearch('A 的关键词');
    const session = { ids: [id], index: 0, mode: 'ordered' as const, point: { kind: 'video' as const, value: 9 } };
    await a.store.writeBookmarkQueue('home:all', session);
    await a.store.visit('a-view', id, session.point, { session, scope: { source: 'all' }, title: 'A' });
    equal((await b.store.counts()).favorites, 0); equal((await b.store.counts()).likes, 1); deepEqual(await b.store.folders(), []); deepEqual(await b.store.searches(), []);
    deepEqual(await a.store.accountOverview(), { all: 1, likes: 0, favorites: 1, folders: 1, history: 1, searches: 1 });
    deepEqual(await b.store.accountOverview(), { all: 1, likes: 1, favorites: 0, folders: 0, history: 0, searches: 0 });
    equal(await b.store.readBookmark('home:all'), null); equal(await b.store.continuation(), null);
    // An old screen retains A's store, so cleanup cannot write into the selected B.
    const delayed = () => a.store.writeBookmarkPoint('home:all', id, { kind: 'video', value: 17 });
    await b.store.writeState('nickname', 'B'); await delayed();
    equal(JSON.parse((await a.store.readBookmark('home:all'))!).point.value, 17); equal(await b.store.readBookmark('home:all'), null);
    await b.store.clearLibrary(); equal((await a.store.counts()).all, 1); equal((await a.store.counts()).favorites, 1); equal((await b.store.counts()).all, 0);
    equal((await a.store.folders())[0].title, '只属于 A'); deepEqual(await a.store.searches(), ['A 的关键词']);
    equal((await a.store.continuation())?.title, 'A');
    await a.store.removeHistory(); equal((await a.store.accountOverview()).history, 0); equal(await a.store.continuation(), null); equal((await a.store.accountOverview()).searches, 1);
    await a.store.removeSearch(); equal((await a.store.accountOverview()).searches, 0); equal((await a.store.accountOverview()).all, 1);
  } finally { a.sqlite.close(); b.sqlite.close(); }
});
