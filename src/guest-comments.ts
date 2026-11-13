// Public guest reads only. This is a finite share preview, not a paginated feed.
import { mediaHeaders } from './douyin.ts';

export type GuestComment = {
  id: string; workId: string; text: string; nickname: string; avatar: string | null;
  createdAt: number | null; likes: number | null; replyCount: number | null; region: string | null;
};
export type GuestCommentPreview = {
  workId: string; items: GuestComment[]; coverage: 'preview';
  limitation: string; repliesAvailable: false;
};
export class GuestCommentError extends Error {
  readonly code: 'invalid' | 'restricted' | 'network' | 'timeout' | 'cancelled';
  constructor(code: GuestCommentError['code'], message: string) { super(message); this.code = code; }
}
const workPattern = /^[1-9]\d{15,19}$/;
const limitation = '游客分享接口仅提供有限预览，不支持已验证的翻页和楼中楼。';
const previewCache = new Map<string, { value: GuestCommentPreview; expires: number }>();
let cacheEpoch = 0;
export function clearGuestCommentCache() { cacheEpoch++; previewCache.clear(); }
export function cachedGuestComments(workId: string): GuestCommentPreview | null {
  const hit = previewCache.get(workId);
  if (hit && hit.expires > Date.now()) return hit.value;
  previewCache.delete(workId); return null;
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

function safeJson(body: string): unknown {
  // Match string tokens as a whole so quoted comment text cannot be rewritten.
  return JSON.parse(body.replace(
    /"(?:cid|uid|aweme_id|item_id|comment_id|reply_id)"\s*:\s*(\d{16,})(?=\s*[,}])|"(?:[^"\\]|\\.)*"/g,
    (token, digits: string | undefined) => digits ? token.replace(digits, `"${digits}"`) : token,
  ));
}
function avatarOf(user: Record<string, unknown> | undefined): string | null {
  const list = record(user?.avatar_thumb)?.url_list;
  if (!Array.isArray(list)) return null;
  for (const value of list) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return value;
    } catch { /* Ignore an invalid platform URL. */ }
  }
  return null;
}

export function parseGuestCommentPreview(body: string, workId: string): GuestCommentPreview {
  if (!workPattern.test(workId)) throw new GuestCommentError('invalid', '作品 ID 无效。');
  if (!body.trim()) throw new GuestCommentError('restricted', '评论接口返回空响应，不能判定作品没有评论。');
  let payload: Record<string, unknown> | undefined;
  try { payload = record(safeJson(body)); } catch { throw new GuestCommentError('invalid', '评论响应不是有效 JSON。'); }
  const status = record(payload?.status_code)?.StatusCode ?? payload?.status_code;
  if (status !== 0 || !Array.isArray(payload?.comments)) {
    throw new GuestCommentError('restricted', '游客接口未返回可用评论。');
  }
  const items: GuestComment[] = [];
  const seen = new Set<string>();
  for (const raw of payload.comments) {
    const row = record(raw);
    const id = text(row?.cid);
    // Reject the whole response instead of silently discarding mismatched items.
    if (!row || !/^\d{1,30}$/.test(id) || text(row.aweme_id) !== workId) {
      throw new GuestCommentError('invalid', '评论 ID 或所属作品不匹配，已停止展示。');
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const user = record(row.user);
    const timestamp = count(row.create_time ?? row.createTime);
    items.push({
      id, workId, text: text(row.text) || (Array.isArray(row.image_list) && row.image_list.length ? '[图片评论]' : '[暂不支持的评论内容]'),
      nickname: text(user?.nickname) || '未知用户', avatar: avatarOf(user),
      createdAt: timestamp !== null && timestamp <= 8_640_000_000_000 ? timestamp * 1000 : null,
      likes: count(row.digg_count), replyCount: count(row.reply_comment_total), region: text(row.ip_label ?? row.ip_location) || null,
    });
  }
  return { workId, items, coverage: 'preview', limitation, repliesAvailable: false };
}

export async function fetchGuestCommentPreview(workId: string, signal?: AbortSignal, refresh = false): Promise<GuestCommentPreview> {
  if (!workPattern.test(workId)) throw new GuestCommentError('invalid', '作品 ID 无效。');
  if (signal?.aborted) throw new GuestCommentError('cancelled', '已取消评论读取。');
  if (!refresh) { const cached = cachedGuestComments(workId); if (cached) return cached; }
  const epoch = cacheEpoch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    const url = `https://www.iesdouyin.com/web/api/v2/comment/list/?aweme_id=${workId}`;
    const response = await fetch(url, {
      headers: { ...mediaHeaders, Accept: 'application/json' },
      credentials: 'omit', signal: controller.signal,
    });
    if (!response.ok) throw new GuestCommentError('restricted', `评论请求被拒绝（HTTP ${response.status}）。`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) throw new GuestCommentError('invalid', '评论响应过大。');
    if (controller.signal.aborted) throw new GuestCommentError(signal?.aborted ? 'cancelled' : 'timeout', '评论读取已中止。');
    const value = parseGuestCommentPreview(body, workId);
    if (epoch === cacheEpoch) {
      if (previewCache.size >= 8) previewCache.delete(previewCache.keys().next().value!);
      previewCache.set(workId, { value, expires: Date.now() + 120000 });
    }
    return value;
  } catch (error) {
    if (signal?.aborted) throw new GuestCommentError('cancelled', '已取消评论读取。');
    if (controller.signal.aborted) throw new GuestCommentError('timeout', '评论读取超时，请重试。');
    if (error instanceof GuestCommentError) throw error;
    throw new GuestCommentError('network', '评论读取失败，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
