import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { LibraryFilter, LibraryImport, LibraryWork } from './library-format';
import { publicationBounds, type PublicationPeriod } from './library-period';

export const LIBRARY_PAGE_SIZE = 60;
const workColumns = 'id,title,author,published_at AS publishedAt,kind,cover_url AS coverUrl,source_order AS sourceOrder';
const workOrder = 'published_at DESC,id DESC';
const publicationMonth = "strftime('%Y-%m', published_at / 1000.0, 'unixepoch', '+8 hours')";

export type LibraryScope = { search: string; filter: LibraryFilter; period: PublicationPeriod };
export type PublicationDates = { years: { year: number; months: number[] }[]; unknown: boolean };

export type ReviewPoint = { kind: 'video' | 'gallery'; value: number };
export type ReviewQueue = { ids: string[]; mode: 'ordered' | 'shuffle' };
export type ReviewBookmark = { queue: ReviewQueue; index: number; point: ReviewPoint | null };

let opening: Promise<SQLiteDatabase> | undefined;

export function openLibrary(): Promise<SQLiteDatabase> {
  return opening ??= (async () => {
    const db = await openDatabaseAsync('mylike-mobile.db');
    try {
      await db.execAsync(`
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
        CREATE TABLE IF NOT EXISTS review_bookmark (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          queue TEXT NOT NULL,
          work_id TEXT NOT NULL,
          point_kind TEXT,
          point_value REAL
        );
      `);
      return db;
    } catch (error) {
      await db.closeAsync().catch(() => {});
      throw error;
    }
  })().catch((error) => {
    opening = undefined;
    throw error;
  });
}

export async function duplicateCount(file: LibraryImport): Promise<number> {
  const db = await openLibrary();
  let count = 0;
  for (let offset = 0; offset < file.works.length; offset += 400) {
    const ids = file.works.slice(offset, offset + 400).map(({ id }) => id);
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM library_works WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    count += row?.count ?? 0;
  }
  return count;
}

export async function mergeLibrary(file: LibraryImport): Promise<void> {
  const db = await openLibrary();
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
    }
  });
}

function libraryFilter({ search, filter, period }: LibraryScope) {
  const parts: string[] = [];
  const values: (string | number)[] = [];
  if (search) {
    parts.push('(instr(lower(title),lower(?))>0 OR instr(lower(author),lower(?))>0)');
    values.push(search, search);
  }
  if (filter === 'video') parts.push("kind='video'");
  if (filter === 'gallery') parts.push("kind IN ('gallery','live-gallery')");
  if (period === 'unknown') {
    parts.push(`${publicationMonth} IS NULL`);
  } else if (period) {
    parts.push('published_at >= ? AND published_at < ?');
    values.push(...publicationBounds(period));
  }
  return { where: parts.length ? 'WHERE ' + parts.join(' AND ') : '', values };
}

export async function readLibraryPage(scope: LibraryScope, offset: number) {
  const db = await openLibrary();
  const { where, values } = libraryFilter(scope);
  const items = await db.getAllAsync<LibraryWork>(
    `SELECT ${workColumns} FROM library_works ${where} ORDER BY ${workOrder} LIMIT ? OFFSET ?`,
    [...values, LIBRARY_PAGE_SIZE, offset],
  );
  const count = offset === 0
    ? await db.getFirstAsync<{ total: number }>(`SELECT count(*) AS total FROM library_works ${where}`, values)
    : null;
  return { items, total: count?.total ?? null };
}

export async function readPublicationDates(scope: LibraryScope): Promise<PublicationDates> {
  const db = await openLibrary();
  const { where, values } = libraryFilter({ ...scope, period: null });
  const rows = await db.getAllAsync<{ month: string | null }>(
    `SELECT DISTINCT ${publicationMonth} AS month FROM library_works ${where} ORDER BY month DESC`, values,
  );
  const years = new Map<number, number[]>();
  let unknown = false;
  for (const { month } of rows) {
    if (month === null) {
      unknown = true;
      continue;
    }
    const [year, number] = month.split('-').map(Number);
    const months = years.get(year);
    if (months) months.push(number);
    else years.set(year, [number]);
  }
  return { years: [...years].map(([year, months]) => ({ year, months: months.reverse() })), unknown };
}

export function shuffleWorkIds(ids: readonly string[], avoidFirst?: string) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (shuffled.length > 1 && shuffled[0] === avoidFirst) {
    const j = 1 + Math.floor(Math.random() * (shuffled.length - 1));
    [shuffled[0], shuffled[j]] = [shuffled[j], shuffled[0]];
  }
  return shuffled;
}

export async function readReviewQueue(scope: LibraryScope, mode: ReviewQueue['mode']): Promise<ReviewQueue> {
  const db = await openLibrary();
  const { where, values } = libraryFilter(scope);
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM library_works ${where} ORDER BY ${workOrder}`, values,
  );
  const ids = rows.map(({ id }) => id);
  return { ids: mode === 'shuffle' ? shuffleWorkIds(ids) : ids, mode };
}

export async function readLibraryWork(id: string) {
  const db = await openLibrary();
  return db.getFirstAsync<LibraryWork>(`SELECT ${workColumns} FROM library_works WHERE id = ?`, id);
}

export async function readReviewBookmark(): Promise<ReviewBookmark | null> {
  const db = await openLibrary();
  const row = await db.getFirstAsync<{
    queue: string; work_id: string; point_kind: ReviewPoint['kind'] | null; point_value: number | null;
  }>('SELECT queue,work_id,point_kind,point_value FROM review_bookmark WHERE singleton = 1');
  if (!row) return null;
  let queue: ReviewQueue;
  try {
    queue = JSON.parse(row.queue);
  } catch {
    return null;
  }
  if (!Array.isArray(queue?.ids) || (queue.mode !== 'ordered' && queue.mode !== 'shuffle')) return null;
  const index = queue.ids.indexOf(row.work_id);
  if (index < 0) return null;
  const point = row.point_value !== null && Number.isFinite(row.point_value) && row.point_value >= 0 &&
    (row.point_kind === 'video' || row.point_kind === 'gallery')
    ? { kind: row.point_kind, value: row.point_value } : null;
  return { queue, index, point };
}

export async function writeReviewQueue(queue: ReviewQueue, workId: string) {
  const db = await openLibrary();
  await db.runAsync(`
    INSERT INTO review_bookmark (singleton,queue,work_id) VALUES (1,?,?)
    ON CONFLICT(singleton) DO UPDATE SET
      queue=excluded.queue,work_id=excluded.work_id,point_kind=NULL,point_value=NULL
  `, JSON.stringify(queue), workId);
}

export async function writeReviewPosition(workId: string) {
  const db = await openLibrary();
  await db.runAsync('UPDATE review_bookmark SET work_id=?,point_kind=NULL,point_value=NULL WHERE singleton=1', workId);
}

export async function writeReviewPoint(workId: string, point: ReviewPoint) {
  const db = await openLibrary();
  await db.runAsync('UPDATE review_bookmark SET point_kind=?,point_value=? WHERE singleton=1 AND work_id=?',
    point.kind, point.value, workId);
}
