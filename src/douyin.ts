const DETAIL_HOST = 'api.amemv.com';
const MOBILE_AGENT =
  'Mozilla/5.0 (Linux; Android 13; 2210132C Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
const WORK_ID = /^[1-9]\d{15,19}$/;
const REQUEST_TIMEOUT = 12_000;

export const mediaHeaders = {
  'User-Agent': MOBILE_AGENT,
  Referer: 'https://www.douyin.com/',
};

type RecordValue = Record<string, unknown>;
type VideoResult = {
  id: string;
  title: string;
  candidates: string[];
  author?: string;
};

type GalleryResult = {
  id: string;
  title: string;
  images: { candidates: string[]; liveCandidates: string[] }[];
  musicCandidates: string[];
  author?: string;
};

export type MediaResult = VideoResult | GalleryResult;

class DouyinError extends Error {}

function object(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function httpsUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url;
  } catch {
    // Ignore invalid URLs returned by the platform.
  }
  return undefined;
}

function mediaUrls(...lists: unknown[]): string[] {
  const candidates = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      // Keep the exact signed URL returned by the platform.
      if (typeof value === 'string' && httpsUrl(value)) candidates.add(value);
    }
  }
  return [...candidates].slice(0, 8);
}

function displayText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseMediaDetail(body: string, id: string): MediaResult {
  let payload: RecordValue | undefined;
  try {
    // Preserve bare 19-digit work IDs before JSON.parse rounds them to Numbers.
    const safeBody = body.replace(
      /"aweme_id"\s*:\s*(\d{16,})(?=\s*[,}])|"(?:[^"\\]|\\.)*"/g,
      (token, digits: string | undefined) => (digits ? `"aweme_id":"${digits}"` : token),
    );
    payload = object(JSON.parse(safeBody));
  } catch {
    throw new DouyinError('详情响应不是 JSON，可能是验证页或接口限制。');
  }
  if (payload?.status_code !== 0 && payload?.status_code !== '0') {
    const code = payload?.status_code;
    const status = typeof code === 'number' || (typeof code === 'string' && /^-?\d+$/.test(code))
      ? String(code)
      : '缺失';
    throw new DouyinError(`抖音未返回成功状态（status_code: ${status}）。`);
  }
  const detail = object(payload.aweme_detail);
  if (!detail) throw new DouyinError('详情响应没有作品数据，游客请求可能未获放行。');
  if (detail.aweme_id !== id) throw new DouyinError('详情返回了不同的作品 ID，已停止播放。');
  const title = typeof detail.desc === 'string' && detail.desc.trim() ? detail.desc.trim() : '抖音视频';
  const author = displayText(object(detail.author)?.nickname);
  const common = { id, title, ...(author && { author }) };
  if (Array.isArray(detail.images) && detail.images.length > 0) {
    const images = detail.images.map((value) => {
      const image = object(value);
      const video = object(image?.video);
      return {
        candidates: mediaUrls(image?.url_list, object(image?.display_image)?.url_list),
        liveCandidates: mediaUrls(
          object(video?.play_addr_h264)?.url_list,
          object(video?.play_addr)?.url_list,
          object(video?.play_addr_lowbr)?.url_list,
          object(image?.live_image)?.url_list,
          video?.url_list,
          Array.isArray(image?.urls) ? object(image.urls[0])?.url_list : undefined,
        ),
      };
    });
    if (!images.some((image) => image.candidates.length))
      throw new DouyinError('已取到图集详情，但没有可用的 HTTPS 图片地址。');
    const music = object(detail.music);
    const matchedSound = object(music?.matched_pgc_sound);
    const musicCandidates = mediaUrls(
      object(music?.play_url)?.url_list, music?.url_list, object(matchedSound?.play_url)?.url_list,
    );
    return { ...common, images, musicCandidates };
  }
  const video = object(detail.video);
  const candidates = mediaUrls(object(video?.play_addr_h264)?.url_list, object(video?.play_addr)?.url_list);
  if (!candidates.length) throw new DouyinError('已取到详情，但没有可用的 HTTPS 视频地址。');
  return { ...common, candidates };
}

export async function resolveMedia(id: string, signal?: AbortSignal): Promise<MediaResult> {
  if (!WORK_ID.test(id)) throw new DouyinError('作品 ID 无效。');
  if (signal?.aborted) throw new DouyinError('已取消取链。');

  const url = `https://${DETAIL_HOST}/aweme/v1/aweme/detail/` +
    `?aweme_id=${id}&aid=6383&device_platform=web&version_code=190500&version_name=19.5.0`;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': MOBILE_AGENT, Accept: 'application/json, text/plain, */*' },
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) throw new DouyinError(`详情请求被拒绝（HTTP ${response.status}）。`);
    const body = await response.text();
    if (!body.trim()) throw new DouyinError('详情响应为空。');
    return parseMediaDetail(body, id);
  } catch (error) {
    if (signal?.aborted) throw new DouyinError('已取消取链。');
    if (controller.signal.aborted) throw new DouyinError('详情请求超时（12 秒）。');
    if (error instanceof DouyinError) throw error;
    throw new DouyinError('详情请求失败，请检查手机能否访问抖音。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export function redactMediaUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[媒体地址]').slice(0, 300);
}
