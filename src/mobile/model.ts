import type { LibraryFilter, LibraryWork } from '../library-format.ts';
import { publicationBounds, type PublicationPeriod } from '../library-period.ts';

export type Source = 'all' | 'likes' | 'favorites';
export type Scope = { source: Source; search?: string; filter?: LibraryFilter; period?: PublicationPeriod; folderId?: string | null; author?: string };
export type Work = LibraryWork & { liked: boolean; saved: boolean };
export type Point = { kind: 'video' | 'gallery'; value: number };
export type Session = { ids: string[]; index: number; mode: 'ordered' | 'shuffle'; point: Point | null };
export type Preferences = { auto: boolean; rate: number; clear: boolean };
export const defaultPreferences: Preferences = { auto: false, rate: 1, clear: false };
export const rates = [0.75, 1, 1.25, 1.5, 2];
export const mobileSchema = `
  CREATE TABLE IF NOT EXISTS mobile_marks (
    work_id TEXT PRIMARY KEY NOT NULL, liked INTEGER, saved INTEGER,
    CHECK(liked IS NULL OR liked IN (0,1)), CHECK(saved IS NULL OR saved IN (0,1))
  );
  CREATE TABLE IF NOT EXISTS mobile_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS mobile_folders (id TEXT PRIMARY KEY NOT NULL,title TEXT,is_local INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS mobile_group_resets (work_id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE IF NOT EXISTS mobile_folder_memberships (folder_id TEXT NOT NULL,work_id TEXT NOT NULL,PRIMARY KEY(folder_id,work_id));
  CREATE INDEX IF NOT EXISTS mobile_member_work ON mobile_folder_memberships(work_id);
  CREATE TABLE IF NOT EXISTS mobile_history (work_id TEXT PRIMARY KEY NOT NULL,watched_at INTEGER NOT NULL,point_kind TEXT,point_value REAL);
  CREATE INDEX IF NOT EXISTS mobile_recent ON mobile_history(watched_at DESC,work_id DESC);
  CREATE TABLE IF NOT EXISTS mobile_searches (term TEXT PRIMARY KEY NOT NULL,used_at INTEGER NOT NULL);
`;
const imported = (source: string) => `EXISTS(SELECT 1 FROM library_memberships b WHERE b.work_id=w.id AND b.source='${source}')`;
export const effectiveLike = `COALESCE(m.liked,${imported('likes')})`;
export const effectiveSave = `COALESCE(m.saved,${imported('favorites')})`;
export const workFrom = 'FROM library_works w LEFT JOIN mobile_marks m ON m.work_id=w.id';
export const workSelect = `SELECT w.id,w.title,w.author,w.published_at AS publishedAt,w.kind,w.cover_url AS coverUrl,w.source_order AS sourceOrder,${effectiveLike} AS liked,${effectiveSave} AS saved ${workFrom}`;
export const folderSelect = `SELECT f.id,COALESCE(o.title,f.title) title,0 local FROM library_folders f LEFT JOIN mobile_folders o ON o.id=f.id WHERE COALESCE(o.deleted,0)=0
  UNION ALL SELECT o.id,o.title,1 local FROM mobile_folders o WHERE o.is_local=1 AND o.deleted=0 AND NOT EXISTS(SELECT 1 FROM library_folders f WHERE f.id=o.id)`;
export const folderLink = `(EXISTS(SELECT 1 FROM mobile_folder_memberships b WHERE b.work_id=w.id AND b.folder_id=f.id)
  OR (NOT EXISTS(SELECT 1 FROM mobile_group_resets r WHERE r.work_id=w.id) AND EXISTS(SELECT 1 FROM library_folder_works b WHERE b.work_id=w.id AND b.folder_id=f.id)))`;

export function whereScope(scope: Scope, ignorePeriod = false) {
  const clauses = ['1=1']; const values: (string | number)[] = [];
  if (scope.source === 'likes') clauses.push(`${effectiveLike}=1`);
  else if (scope.source === 'favorites') clauses.push(`${effectiveSave}=1`);
  else if (scope.source !== 'all') throw new Error('未知内容来源');
  if (scope.search?.trim()) {
    clauses.push('(instr(lower(w.title),lower(?))>0 OR instr(lower(w.author),lower(?))>0)');
    values.push(scope.search.trim(), scope.search.trim());
  }
  if (scope.author !== undefined) { clauses.push('w.author=?'); values.push(scope.author); }
  if (scope.filter === 'video') clauses.push("w.kind='video'");
  if (scope.filter === 'gallery') clauses.push("w.kind IN ('gallery','live-gallery')");
  if (scope.folderId && scope.source === 'favorites') {
    if (scope.folderId === 'unfiled') clauses.push(`NOT EXISTS(SELECT 1 FROM (${folderSelect}) f WHERE ${folderLink})`);
    else { clauses.push(`EXISTS(SELECT 1 FROM (${folderSelect}) f WHERE f.id=? AND ${folderLink})`); values.push(scope.folderId); }
  }
  if (!ignorePeriod && scope.period === 'unknown') clauses.push("strftime('%Y-%m',w.published_at/1000.0,'unixepoch','+8 hours') IS NULL");
  else if (!ignorePeriod && scope.period && scope.period !== 'unknown') {
    clauses.push('w.published_at>=? AND w.published_at<?'); values.push(...publicationBounds(scope.period));
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, values };
}
export function queueQuery(scope: Scope) { const q = whereScope(scope); return { sql: `SELECT w.id ${workFrom} ${q.where} ORDER BY w.published_at DESC,w.id DESC`, values: q.values }; }

export function shuffled(ids: readonly string[], avoidFirst?: string, random = Math.random): string[] {
  const result = [...new Set(ids)];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1)))); [result[i], result[j]] = [result[j], result[i]]; }
  if (result.length > 1 && result[0] === avoidFirst) [result[0], result[1]] = [result[1], result[0]];
  return result;
}
export function parseSession(value: string | null): Session | null {
  if (!value) return null;
  try {
    const s = JSON.parse(value);
    if (!Array.isArray(s.ids) || !s.ids.length || s.ids.length > 100000 || !s.ids.every((id: unknown) => typeof id === 'string' && /^\d{1,30}$/.test(id)) || new Set(s.ids).size !== s.ids.length || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.ids.length || !['ordered', 'shuffle'].includes(s.mode)) return null;
    const point = s.point && ['video', 'gallery'].includes(s.point.kind) && Number.isFinite(s.point.value) && s.point.value >= 0 ? { kind: s.point.kind, value: s.point.kind === 'gallery' ? Math.floor(s.point.value) : s.point.value } : null;
    return { ids: s.ids, index: s.index, mode: s.mode, point };
  } catch { return null; }
}
export function restoreSession(value: string | null, pool: readonly string[], mode: Session['mode']): Session {
  const saved = parseSession(value); const allowed = new Set(pool);
  if (saved) {
    const ids = saved.ids.filter(id => allowed.has(id)); const id = saved.ids[saved.index]; const index = ids.indexOf(id);
    if (ids.length) return { ids, index: Math.max(0, index), mode: saved.mode, point: index >= 0 ? saved.point : null };
  }
  return { ids: mode === 'shuffle' ? shuffled(pool) : [...new Set(pool)], index: 0, mode, point: null };
}
export function parsePreferences(value: string | null): Preferences {
  try { const p = JSON.parse(value ?? '{}'); return { auto: p.auto === true, clear: p.clear === true, rate: rates.includes(p.rate) ? p.rate : 1 }; }
  catch { return { ...defaultPreferences }; }
}
export function swipeStep(distance: number, velocity: number, extent: number): -1 | 0 | 1 {
  'worklet';
  if (extent <= 0 || !Number.isFinite(distance) || !Number.isFinite(velocity)) return 0;
  const flick = Math.abs(distance) > 24 && Math.abs(velocity) > 750 && Math.sign(distance) === Math.sign(velocity);
  if (Math.abs(distance) < extent / 3 && !flick) return 0;
  return distance < 0 ? 1 : -1;
}
