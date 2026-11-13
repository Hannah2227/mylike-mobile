import { librarySchema, duplicateCount as countImportedDuplicates, mergeLibrary as mergeImportedLibrary } from './library-data';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { LibraryFilter, LibraryFolder, LibraryImport, LibrarySource, LibraryWork } from './library-format';
import { publicationBounds, type PublicationPeriod } from './library-period';

export const LIBRARY_PAGE_SIZE = 60;
const workColumns = 'id,title,author,published_at AS publishedAt,kind,cover_url AS coverUrl,source_order AS sourceOrder';
const workOrder = 'published_at DESC,id DESC';
const publicationMonth = "strftime('%Y-%m', published_at / 1000.0, 'unixepoch', '+8 hours')";

export type LibraryScope = {
  source: LibrarySource;
  folderId: string | null;
  search: string;
  filter: LibraryFilter;
  period: PublicationPeriod;
};
export type PublicationDates = { years: { year: number; months: number[] }[]; unknown: boolean };

export type ReviewPoint = { kind: 'video' | 'gallery'; value: number };
export type ReviewQueue = { ids: string[]; mode: 'ordered' | 'shuffle' };
export type ReviewBookmark = { queue: ReviewQueue; index: number; point: ReviewPoint | null };

const openings = new Map<string, Promise<SQLiteDatabase>>();

export function openLibrary(name = 'mylike-mobile.db'): Promise<SQLiteDatabase> {
  if (!/^mylike-(?:mobile|account-[a-z0-9-]+)\.db$/.test(name)) return Promise.reject(new Error('无效的内容库名称'));
  const existing = openings.get(name); if (existing) return existing;
  const opening = (async () => {
    const db = await openDatabaseAsync(name);
    try {
      await db.execAsync(librarySchema);
      return db;
    } catch (error) {
      await db.closeAsync().catch(() => {});
      throw error;
    }
  })().catch((error) => {
    openings.delete(name);
    throw error;
  });
  openings.set(name, opening); return opening;
}

export async function duplicateCount(file: LibraryImport, db?: SQLiteDatabase): Promise<number> {
  return countImportedDuplicates(file, db ?? await openLibrary());
}

export async function mergeLibrary(file: LibraryImport, db?: SQLiteDatabase): Promise<void> {
  return mergeImportedLibrary(file, db ?? await openLibrary());
}

function libraryFilter({ source, folderId, search, filter, period }: LibraryScope) {
  const parts = ['EXISTS(SELECT 1 FROM library_memberships WHERE source=? AND work_id=library_works.id)'];
  const values: (string | number)[] = [source];
  if (source === 'favorites' && folderId !== null) {
    parts.push('EXISTS(SELECT 1 FROM library_folder_works WHERE folder_id=? AND work_id=library_works.id)');
    values.push(folderId);
  }
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
  return { where: 'WHERE ' + parts.join(' AND '), values };
}

export async function readFavoriteFolders() {
  const db = await openLibrary();
  return db.getAllAsync<LibraryFolder>('SELECT id,title FROM library_folders ORDER BY title,id');
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
