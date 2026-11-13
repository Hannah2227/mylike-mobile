import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';
import { decodeLibrary } from '../src/library-format.ts';
import { duplicateCount, librarySchema, mergeLibrary } from '../src/library-data.ts';
import { accountsSchema, addAccount, readAccounts, selectAccount } from '../src/mobile/accounts-data.ts';
import type { QueryDb } from '../src/mobile/local-data.ts';
import { parseSession, shuffled, type Session } from '../src/mobile/model.ts';
import { createStore } from '../src/mobile/store-core.ts';

const A = '7637322941528689935'; const B = '7637322941528689936'; const C = '7637322941528689937';
const travel = 'a'.repeat(64); const photos = 'b'.repeat(64); const empty = 'c'.repeat(64);
const video = { id: A, title: '海边%_视频', author: '作者甲', kind: 'video', publishedAt: '2026-05-08T10:00:00Z', coverUrl: null };
const album = { ...video, id: B, title: '实况图集', kind: 'live-gallery', publishedAt: '2026-06-08T10:00:00Z' };
const picture = { ...video, id: C, title: '静态图集', author: '作者乙', kind: 'gallery', publishedAt: null };
const likes = () => decodeLibrary(JSON.stringify({ format: 'mylike.library', version: 2, exportedAt: '2026-11-12T04:00:00Z', source: { kind: 'douyin.likes', label: '我的喜欢' }, order: 'desktop-liked', items: [video, album] }));
const favorites = () => decodeLibrary(JSON.stringify({ format: 'mylike.library', version: 3, exportedAt: '2026-11-12T05:00:00Z', source: { kind: 'douyin.favorites', label: '我的收藏' }, order: 'desktop-favorites', items: [video, picture], folders: [
  { id: travel, title: '旅行', workIds: [A] }, { id: photos, title: '摄影', workIds: [A, C] }, { id: empty, title: '空夹', workIds: [] },
] }));

function connect(path = ':memory:', initialize = true) {
  const sqlite = new DatabaseSync(path);
  if (initialize) sqlite.exec(librarySchema);
  type Value = string | number | null;
  const params = (values: unknown[]) => (Array.isArray(values[0]) ? values[0] : values) as Value[];
  const native = {
    execAsync: async (sql: string) => { sqlite.exec(sql); },
    runAsync: async (sql: string, ...values: unknown[]) => sqlite.prepare(sql).run(...params(values)),
    getFirstAsync: async (sql: string, ...values: unknown[]) => { const row = sqlite.prepare(sql).get(...params(values)); return row ? { ...row } : null; },
    getAllAsync: async (sql: string, ...values: unknown[]) => sqlite.prepare(sql).all(...params(values)).map(row => ({ ...row })),
    withExclusiveTransactionAsync: async (action: (tx: unknown) => Promise<void>) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try { await action(native); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as SQLiteDatabase;
  const store = createStore({ open: async () => native, mergeLibrary, countDuplicates: duplicateCount });
  return { sqlite, native, store, query: native as unknown as QueryDb };
}

test('desktop v2/v3 decoding, actual SQL import, source duplicates, folders and search filters work together', async () => {
  const db = connect(); const { store } = db;
  try {
    await store.importCollection(likes()); equal(await store.duplicateCount(likes()), 2); equal(await store.duplicateCount(favorites()), 0);
    await store.importCollection(favorites()); deepEqual(await store.counts(), { all: 3, likes: 2, favorites: 2 });
    deepEqual(await store.queueIds({ source: 'all' }), [B, A, C]);
    deepEqual(await store.queueIds({ source: 'all', search: '%' }), [A]);
    deepEqual(await store.queueIds({ source: 'all', search: '作者乙' }), [C]);
    deepEqual(await store.queueIds({ source: 'all', filter: 'gallery' }), [B, C]);
    deepEqual(await store.queueIds({ source: 'all', period: { year: 2026, month: 5 } }), [A]);
    deepEqual(await store.queueIds({ source: 'all', period: { year: 2026 } }), [B, A]);
    deepEqual(await store.queueIds({ source: 'all', period: 'unknown' }), [C]);
    deepEqual(await store.queueIds({ source: 'favorites', folderId: travel }), [A]);
    equal((await store.folders()).find(folder => folder.id === empty)?.count, 0);
    deepEqual((await store.groups(A)).sort(), [travel, photos].sort());
    await store.mark(A, 'liked', false); await store.mark(A, 'saved', false);
    await store.editFolder(travel, '本机改名'); await store.editFolder(photos, null);
    await store.importCollection(likes()); await store.importCollection(favorites());
    equal(await store.duplicateCount(favorites()), 2); equal((await store.work(A))?.liked, false); equal((await store.work(A))?.saved, false);
    equal((await store.folders()).find(folder => folder.id === travel)?.title, '本机改名');
    equal((await store.folders()).some(folder => folder.id === photos), false);
    deepEqual(await store.queueIds({ source: 'favorites', folderId: 'unfiled' }), [C]);
    throws(() => decodeLibrary('{broken json'), /./); deepEqual(await store.counts(), { all: 3, likes: 1, favorites: 1 });
  } finally { db.sqlite.close(); }
});

test('failed imports roll back works, source relationships and folders, and a subsequent retry succeeds', async () => {
  const db = connect();
  try {
    await db.store.importCollection(likes());
    db.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON library_folder_works WHEN NEW.work_id='${C}' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END;`);
    await rejects(db.store.importCollection(favorites()), /simulated disk failure/);
    deepEqual(await db.store.counts(), { all: 2, likes: 2, favorites: 0 });
    deepEqual(await db.store.folders(), []); equal(await db.store.work(C), null); equal(await db.store.duplicateCount(favorites()), 0);
    db.sqlite.exec('DROP TRIGGER fail_import'); await db.store.importCollection(favorites());
    deepEqual(await db.store.counts(), { all: 3, likes: 2, favorites: 2 });
  } finally { db.sqlite.close(); }
});

test('large imports cross SQL batch boundaries and random playback uses the complete filtered queue', async () => {
  const db = connect();
  try {
    const file = decodeLibrary(JSON.stringify({ format: 'mylike.library', version: 2, exportedAt: '2026-11-12T04:00:00Z', source: { kind: 'douyin.likes', label: '批量' }, order: 'desktop-liked', items: Array.from({ length: 405 }, (_, index) => ({ ...video, id: String(7637322941528689935n + BigInt(index)) })) }));
    await db.store.importCollection(file); equal(await db.store.duplicateCount(file), 405);
    equal((await db.store.page({ source: 'all' })).items.length, 60);
    const ids = await db.store.queueIds({ source: 'likes', period: { year: 2026, month: 5 } }); equal(ids.length, 405);
    const random = shuffled(ids, ids[0], () => 0.5); equal(random.length, 405); deepEqual([...random].sort(), [...ids].sort());
    await db.store.importCollection(file); deepEqual(await db.store.counts(), { all: 405, likes: 405, favorites: 0 });
  } finally { db.sqlite.close(); }
});

test('real disk reopening preserves accounts, local overrides, video/gallery progress and continuation', async () => {
  const root = resolve('dist/regression-tests'); mkdirSync(root, { recursive: true }); const directory = mkdtempSync(join(root, 'reopen-'));
  const active = new Set<ReturnType<typeof connect>>();
  const open = (name: string) => { const db = connect(join(directory, name)); active.add(db); return db; };
  const close = (db: ReturnType<typeof connect>) => { db.sqlite.close(); active.delete(db); };
  try {
    let registry = open('mylike-accounts.db'); registry.sqlite.exec(accountsSchema);
    equal((await readAccounts(registry.query)).active.database, 'mylike-mobile.db');
    const account = await addAccount(registry.query, 'B', 'second-account'); await selectAccount(registry.query, account.id);
    let a = open('mylike-mobile.db'); let b = open(account.database);
    await a.store.importCollection(likes()); await a.store.importCollection(favorites()); await b.store.importCollection(likes());
    await a.store.mark(A, 'liked', false); await a.store.mark(A, 'saved', false);
    const folder = await a.store.createFolder('本机夹'); await a.store.assignGroups(C, [folder]);
    await a.store.writeState('preferences', { auto: true, rate: 1.5, clear: false }); await a.store.addSearch('A 的搜索');
    const gallery: Session = { ids: [B, A, C], index: 0, mode: 'shuffle', point: { kind: 'gallery', value: 2 } };
    await a.store.writeBookmarkQueue('home:all', gallery);
    await a.store.visit('watch-a', B, gallery.point!, { session: gallery, scope: { source: 'all' }, title: '推荐' });
    await a.store.updateWatchPoint('watch-a', B, { kind: 'gallery', value: 3 });
    await a.store.writeBookmarkPoint('home:all', B, { kind: 'gallery', value: 3 });
    const videoSession: Session = { ids: [A, B], index: 0, mode: 'ordered', point: { kind: 'video', value: 12.5 } };
    await b.store.writeBookmarkQueue('home:likes', videoSession);
    close(a); close(b); close(registry);
    registry = open('mylike-accounts.db'); equal((await readAccounts(registry.query)).active.id, account.id);
    a = open('mylike-mobile.db'); b = open(account.database);
    deepEqual(await a.store.counts(), { all: 3, likes: 1, favorites: 1 }); deepEqual(await b.store.counts(), { all: 2, likes: 2, favorites: 0 });
    deepEqual(await a.store.groups(C), [folder]); equal((await a.store.folders()).find(row => row.id === folder)?.title, '本机夹');
    deepEqual(parseSession(await a.store.readBookmark('home:all'))?.point, { kind: 'gallery', value: 3 });
    deepEqual(parseSession(await b.store.readBookmark('home:likes'))?.point, { kind: 'video', value: 12.5 });
    deepEqual((await a.store.continuation())?.session.point, { kind: 'gallery', value: 3 }); equal(await b.store.continuation(), null);
    equal(JSON.parse((await a.store.readState('preferences'))!).rate, 1.5); equal((await a.store.searches())[0], 'A 的搜索'); deepEqual(await b.store.searches(), []);
    await a.store.importCollection(favorites()); equal((await a.store.work(A))?.saved, false); deepEqual(await a.store.groups(C), [folder]);
    await b.store.clearLibrary(); deepEqual(await a.store.counts(), { all: 3, likes: 1, favorites: 1 });
  } finally {
    for (const db of active) db.sqlite.close();
    // Only generated files in this test's newly created directory; no recursive removal.
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory);
  }
});

test('opening the released v1 database keeps its works and old bookmark without guessing like membership', async () => {
  const db = connect(':memory:', false);
  try {
    db.sqlite.exec(`CREATE TABLE library_works(id TEXT PRIMARY KEY NOT NULL,title TEXT NOT NULL,author TEXT NOT NULL,published_at INTEGER,kind TEXT NOT NULL,cover_url TEXT,source_order INTEGER,source_label TEXT NOT NULL,exported_at INTEGER NOT NULL);
      CREATE TABLE review_bookmark(singleton INTEGER PRIMARY KEY CHECK(singleton=1),queue TEXT NOT NULL,work_id TEXT NOT NULL,point_kind TEXT,point_value REAL);`);
    db.sqlite.prepare('INSERT INTO library_works VALUES(?,?,?,?,?,?,?,?,?)').run(A, '旧内容', '原作者', null, 'video', null, 0, '原清单', 1);
    db.sqlite.prepare('INSERT INTO review_bookmark VALUES(1,?,?,?,?)').run(JSON.stringify({ ids: [A], mode: 'ordered' }), A, 'video', 12.75);
    const bookmark = db.sqlite.prepare('SELECT * FROM review_bookmark').get();
    db.sqlite.exec(librarySchema); deepEqual(await db.store.counts(), { all: 1, likes: 0, favorites: 0 });
    deepEqual(await db.store.queueIds({ source: 'all' }), [A]); equal((await db.store.work(A))?.title, '旧内容');
    equal(await db.store.readBookmark('home:all'), null); equal(await db.store.continuation(), null);
    deepEqual(db.sqlite.prepare('SELECT * FROM review_bookmark').get(), bookmark);
    await db.store.importCollection(likes()); deepEqual(await db.store.counts(), { all: 2, likes: 2, favorites: 0 });
    deepEqual(db.sqlite.prepare('SELECT * FROM review_bookmark').get(), bookmark);
  } finally { db.sqlite.close(); }
});
