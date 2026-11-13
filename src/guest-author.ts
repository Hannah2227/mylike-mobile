import { mediaHeaders } from './douyin.ts';

export type GuestAuthor = { secUid: string; nickname: string; signature: string; avatarUrl: string | null };
const SEC_UID = /^MS4wLjAB[A-Za-z0-9_-]{8,248}$/;
const cache = new Map<string, { value: GuestAuthor; expires: number }>();
export function validAuthorKey(value: unknown): value is string { return typeof value === 'string' && SEC_UID.test(value); }
class AuthorReadError extends Error {}
export function parseGuestAuthor(body: string, secUid: string): GuestAuthor {
  if (!validAuthorKey(secUid)) throw new AuthorReadError('作者标识无效。');
  let data;
  try { data = JSON.parse(body); } catch { throw new AuthorReadError('作者资料响应无效。'); }
  if (data?.status_code !== 0 && data?.status_code !== '0') throw new AuthorReadError('游客暂时无法读取作者资料。');
  const user = data.user_info;
  if (!user || user.sec_uid !== secUid || typeof user.nickname !== 'string' || !user.nickname.trim()) throw new AuthorReadError('作者资料为空或标识不匹配。');
  let avatarUrl: string | null = null;
  for (const candidate of [...(Array.isArray(user.avatar_medium?.url_list) ? user.avatar_medium.url_list : []), ...(Array.isArray(user.avatar_thumb?.url_list) ? user.avatar_thumb.url_list : [])]) {
    if (typeof candidate !== 'string') continue;
    try { const url = new URL(candidate); if (url.protocol === 'https:' && !url.username && !url.password) { avatarUrl = candidate; break; } } catch { /* Try the next safe URL. */ }
  }
  return { secUid, nickname: user.nickname.trim().slice(0, 100), signature: typeof user.signature === 'string' ? user.signature.trim().slice(0, 2000) : '', avatarUrl };
}
export async function readGuestAuthor(secUid: string, signal?: AbortSignal): Promise<GuestAuthor> {
  if (!validAuthorKey(secUid)) throw new AuthorReadError('作者标识无效。');
  if (signal?.aborted) throw new AuthorReadError('已取消读取。');
  const cached = cache.get(secUid); if (cached && cached.expires > Date.now()) return cached.value;
  const controller = new AbortController(); const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 10000);
  try {
    const response = await fetch(`https://www.iesdouyin.com/web/api/v2/user/info/?sec_uid=${encodeURIComponent(secUid)}`, { method: 'GET', credentials: 'omit', headers: { ...mediaHeaders, Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new AuthorReadError(`作者资料暂不可读（HTTP ${response.status}）。`);
    const value = parseGuestAuthor(await response.text(), secUid);
    if (controller.signal.aborted) throw new AuthorReadError('已取消读取。');
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(secUid, { value, expires: Date.now() + 120000 }); return value;
  } catch (failure) { if (failure instanceof AuthorReadError) throw failure; throw new AuthorReadError(controller.signal.aborted ? '作者资料请求已取消或超时。' : '作者资料请求失败，请重试。'); }
  finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
}
export function clearAuthorCache() { cache.clear(); }
