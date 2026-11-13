import type { SQLiteDatabase } from 'expo-sqlite';
import type { LibraryImport } from './library-format';

export const librarySchema = `
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS library_works (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          published_at INTEGER,
          kind TEXT NOT NULL,
          cover_url TEXT,
          source_order INTEGER,
          source_label TEXT NOT NULL,
          exported_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS library_published ON library_works(published_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS library_memberships (
          source TEXT NOT NULL,
          work_id TEXT NOT NULL REFERENCES library_works(id),
          PRIMARY KEY(source, work_id)
        );
        CREATE TABLE IF NOT EXISTS library_folders (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          exported_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS library_folder_works (
          folder_id TEXT NOT NULL REFERENCES library_folders(id),
          work_id TEXT NOT NULL REFERENCES library_works(id),
          PRIMARY KEY(folder_id, work_id)
        );
        CREATE TABLE IF NOT EXISTS review_bookmark (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          queue TEXT NOT NULL,
          work_id TEXT NOT NULL,
          point_kind TEXT,
          point_value REAL
        );
      `;

export async function duplicateCount(file: LibraryImport, db: SQLiteDatabase): Promise<number> {

  let count = 0;
  for (let offset = 0; offset < file.works.length; offset += 400) {
    const ids = file.works.slice(offset, offset + 400).map(({ id }) => id);
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM library_memberships
       WHERE source = ? AND work_id IN (${ids.map(() => '?').join(',')})`,
      [file.source, ...ids],
    );
    count += row?.count ?? 0;
  }
  return count;
}

export async function mergeLibrary(file: LibraryImport, db: SQLiteDatabase): Promise<void> {

  await db.withExclusiveTransactionAsync(async (txn) => {
    for (let offset = 0; offset < file.works.length; offset += 100) {
      const rows = file.works.slice(offset, offset + 100);
      const values = rows.flatMap((work) => [
        work.id, work.title, work.author, work.publishedAt, work.kind, work.coverUrl,
        work.sourceOrder, file.sourceLabel, file.exportedAt,
      ]);
      await txn.runAsync(`
        INSERT INTO library_works
          (id,title,author,published_at,kind,cover_url,source_order,source_label,exported_at)
        VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, author=excluded.author, published_at=excluded.published_at,
          kind=excluded.kind, cover_url=coalesce(excluded.cover_url,library_works.cover_url),
          source_order=coalesce(excluded.source_order,library_works.source_order),
          source_label=excluded.source_label, exported_at=excluded.exported_at
        WHERE excluded.exported_at >= library_works.exported_at`, values);
      await txn.runAsync(`
        INSERT OR IGNORE INTO library_memberships (source, work_id)
        VALUES ${rows.map(() => '(?,?)').join(',')}`,
        rows.flatMap((work) => [file.source, work.id]));
    }
    for (const { id, title, workIds } of file.folders) {
      await txn.runAsync(`
        INSERT INTO library_folders (id, title, exported_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, exported_at=excluded.exported_at
        WHERE excluded.exported_at >= library_folders.exported_at`, id, title, file.exportedAt);
      for (let offset = 0; offset < workIds.length; offset += 400) {
        const members = workIds.slice(offset, offset + 400);
        await txn.runAsync(`
          INSERT OR IGNORE INTO library_folder_works (folder_id, work_id)
          VALUES ${members.map(() => '(?,?)').join(',')}`, members.flatMap((workId) => [id, workId]));
      }
    }
  });
}
