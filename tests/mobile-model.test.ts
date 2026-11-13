import { deepEqual, equal } from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { mobileSchema, parsePreferences, parseSession, queueQuery, restoreSession, shuffled, swipeStep, whereScope, workSelect } from '../src/mobile/model.ts';

test('local overrides survive reimport, remain independent, and do not remove all works', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE library_works(id TEXT PRIMARY KEY,title TEXT,author TEXT,published_at INTEGER,kind TEXT,cover_url TEXT,source_order INTEGER);
      CREATE TABLE library_memberships(source TEXT,work_id TEXT,PRIMARY KEY(source,work_id));CREATE TABLE library_folder_works(folder_id TEXT,work_id TEXT);${mobileSchema}`);
    db.exec("INSERT INTO library_works VALUES('7637322941528689935','a','user',0,'video',NULL,NULL);INSERT INTO library_memberships VALUES('likes','7637322941528689935');");
    const result = (source: 'all' | 'likes' | 'favorites') => { const q = whereScope({ source }); return db.prepare(`${workSelect} ${q.where}`).all(...q.values); };
    equal(result('likes').length, 1); equal(result('favorites').length, 0);
    db.exec("INSERT INTO mobile_marks VALUES('7637322941528689935',0,1);INSERT OR IGNORE INTO library_memberships VALUES('likes','7637322941528689935');");
    equal(result('likes').length, 0); equal(result('favorites').length, 1); equal(result('all').length, 1);
    equal(db.prepare('SELECT count(*) n FROM library_memberships').get()?.n, 1);
  } finally { db.close(); }
});
test('queue restore keeps the snapshot, ignores new imports, and repairs a missing current work', () => {
  const saved = JSON.stringify({ ids: ['1','2','3'], index: 1, mode: 'shuffle', point: { kind: 'video', value: 12 } });
  deepEqual(restoreSession(saved, ['1','2','3','4'], 'shuffle'), { ids: ['1','2','3'], index: 1, mode: 'shuffle', point: { kind: 'video', value: 12 } });
  deepEqual(restoreSession(saved, ['1','3','4'], 'shuffle'), { ids: ['1','3'], index: 0, mode: 'shuffle', point: null });
  equal(parseSession('{"ids":["1","1"],"index":0,"mode":"shuffle"}'), null);
});
test('shuffling does not repeat within a round or at the round boundary', () => {
  const ids = ['1','2','3','2']; const result = shuffled(ids, '1', () => 0.999);
  equal(result.length, 3); equal(new Set(result).size, 3); equal(result[0] === '1', false);
  deepEqual(shuffled(['1'], '1'), ['1']);
});
test('date filtering binds Beijing month bounds and treats search as literal text', () => {
  const q = whereScope({ source: 'all', search: "%' OR 1=1", period: { year: 2024, month: 2 }, filter: 'gallery' });
  equal(q.where.includes("%' OR"), false);
  deepEqual(q.values, ["%' OR 1=1", "%' OR 1=1", Date.parse('2024-01-31T16:00:00Z'), Date.parse('2024-02-29T16:00:00Z')]);
  equal(whereScope({ source: 'all', period: 'unknown' }).where.includes('IS NULL'), true);
});
test('cancelled short drags and opposite flicks do not advance; malformed preferences recover', () => {
  equal(swipeStep(0, 0, 0), 0);
  equal(swipeStep(20, 1200, 800), 0); equal(swipeStep(-50, 900, 800), 0); equal(swipeStep(-50, -900, 800), 1); equal(swipeStep(300, 0, 800), -1);
  deepEqual(parsePreferences('{"rate":100,"auto":true,"clear":false}'), { rate: 1, auto: true, clear: false });
});

test('the native queue query reads all 10000 works, deduplicates sources, and honors local overrides', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE library_works(id TEXT PRIMARY KEY,title TEXT,author TEXT,published_at INTEGER,kind TEXT,cover_url TEXT,source_order INTEGER);
      CREATE TABLE library_memberships(source TEXT,work_id TEXT,PRIMARY KEY(source,work_id)); CREATE TABLE library_folder_works(folder_id TEXT,work_id TEXT); ${mobileSchema} BEGIN;`);
    const insert = db.prepare('INSERT INTO library_works VALUES(?,?,?,?,?,?,?)');
    const membership = db.prepare('INSERT INTO library_memberships VALUES(?,?)');
    for (let i = 0; i < 10000; i++) {
      const id = String(7637322941528689935n + BigInt(i)); insert.run(id, '作品', '作者', i, 'video', null, null);
      if (i % 2 === 0) membership.run('likes', id); if (i % 3 === 0) membership.run('favorites', id);
    }
    db.exec("INSERT INTO mobile_marks VALUES('7637322941528689935',0,NULL); COMMIT;");
    const read = (source: 'all' | 'likes' | 'favorites') => { const q = queueQuery({ source }); return db.prepare(q.sql).all(...q.values).map(row => String(row.id)); };
    const all = read('all'); equal(all.length, 10000); equal(new Set(all).size, 10000); equal(read('likes').length, 4999); equal(read('favorites').length, 3334);
    const shuffledAll = shuffled(all); equal(shuffledAll.length, 10000); equal(new Set(shuffledAll).size, 10000);
  } finally { db.close(); }
});
