const DETAIL_HOST = 'api.amemv.com';
const MOBILE_AGENT =
  'Mozilla/5.0 (Linux; Android 13; 2210132C Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
const WORK_ID = /^[1-9]\d{15,19}$/;
const REQUEST_TIMEOUT = 12_000;

export const SAMPLE_ID = '7637322941528689935';
export const mediaHeaders = {
  'User-Agent': MOBILE_AGENT,
  Referer: 'https://www.douyin.com/',
};

type RecordValue = Record<string, unknown>;
type Report = (message: string) => void;

export type VideoResult = {
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

class ProbeError extends Error {}

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

function shareUrl(value: unknown): URL | undefined {
  const url = httpsUrl(value);
  if (url && /^(?:[a-z0-9-]+\.)*(?:douyin\.com|iesdouyin\.com)$/i.test(url.hostname)) {
    return url;
  }
  return undefined;
}

function idFromUrl(url: URL): string | undefined {
  const pathId = url.pathname.match(/\/(?:video|note)\/([1-9]\d{15,19})(?:\/|$)/)?.[1];
  if (pathId) return pathId;
  for (const key of ['aweme_id', 'modal_id', 'item_id']) {
    const value = url.searchParams.get(key);
    if (value && WORK_ID.test(value)) return value;
  }
  return undefined;
}

export function parseInput(value: string): { id: string } | { url: string } {
  const text = value.trim();
  if (WORK_ID.test(text)) return { id: text };

  for (const match of text.matchAll(/https:\/\/[^\s<>"'，。；！？）】]+/gi)) {
    const url = shareUrl(match[0].replace(/[.,;!?]+$/, ''));
    if (!url) continue;
    const id = idFromUrl(url);
    if (id) return { id };
    if (url.hostname === 'v.douyin.com') return { url: url.href };
  }
  throw new ProbeError('请输入抖音分享链接、作品长链接，或作品 ID。');
}

async function resolveId(value: string, report: Report): Promise<string> {
  const target = parseInput(value);
  if ('id' in target) return target.id;

  report('短链：正在跟随抖音分享链接的跳转');
  return withRequest(target.url, '短链', async (response) => {
    const url = shareUrl(response.url);
    const id = url && idFromUrl(url);
    report(`短链：HTTP ${response.status}，${url?.hostname ?? '未识别跳转地址'}`);
    if (!id) throw new ProbeError('短链跳转后没有作品 ID，请改用长链接或 ID。');
    return id;
  });
}

async function withRequest<T>(
  url: string,
  stage: string,
  read: (response: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new ProbeError('已取消取链。');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': MOBILE_AGENT, Accept: 'application/json, text/plain, */*' },
      credentials: 'omit',
      signal: controller.signal,
    });
    return await read(response);
  } catch (error) {
    if (controller.signal.aborted) throw new ProbeError(`${stage}请求超时（12 秒）。`);
    if (error instanceof ProbeError) throw error;
    throw new ProbeError(`${stage}请求失败，检查 iPhone 能否访问抖音网络。`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
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
    throw new ProbeError('详情响应不是 JSON，可能是验证页或接口限制。');
  }
  if (payload?.status_code !== 0 && payload?.status_code !== '0') {
    const code = payload?.status_code;
    const status = typeof code === 'number' || (typeof code === 'string' && /^-?\d+$/.test(code))
      ? String(code)
      : '缺失';
    throw new ProbeError(`抖音未返回成功状态（status_code: ${status}）。`);
  }
  const detail = object(payload.aweme_detail);
  if (!detail) throw new ProbeError('详情响应没有作品数据；游客请求可能未获放行。');
  if (detail.aweme_id !== id) throw new ProbeError('详情返回了不同的作品 ID，已停止播放。');
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
      throw new ProbeError('已取到图集详情，但没有可用的 HTTPS 图片地址。');
    const music = object(detail.music);
    const matchedSound = object(music?.matched_pgc_sound);
    const musicCandidates = mediaUrls(
      object(music?.play_url)?.url_list, music?.url_list, object(matchedSound?.play_url)?.url_list,
    );
    return { ...common, images, musicCandidates };
  }
  const video = object(detail.video);
  const candidates = mediaUrls(object(video?.play_addr_h264)?.url_list, object(video?.play_addr)?.url_list);
  if (!candidates.length) throw new ProbeError('已取到详情，但没有可用的 HTTPS 视频地址。');
  return { ...common, candidates };
}

function requireVideo(result: MediaResult): VideoResult {
  if ('images' in result)
    throw new ProbeError(`已取到图集详情（${result.images.length} 张图）；本次请用普通视频测试。`);
  return result;
}

export function parseDetail(body: string, id: string): VideoResult {
  return requireVideo(parseMediaDetail(body, id));
}

export async function resolveMedia(value: string, report: Report, signal?: AbortSignal): Promise<MediaResult> {
  const id = await resolveId(value, report);
  report(`作品 ID：${id}`);
  const url = `https://${DETAIL_HOST}/aweme/v1/aweme/detail/` +
    `?aweme_id=${id}&aid=6383&device_platform=web&version_code=190500&version_name=19.5.0`;
  report(`详情：GET ${DETAIL_HOST}（游客）`);
  return withRequest(url, '详情', async (response) => {
    report(`详情：HTTP ${response.status}`);
    if (!response.ok) throw new ProbeError(`详情请求被拒绝（HTTP ${response.status}）。`);
    const body = await response.text();
    if (!body.trim()) throw new ProbeError('详情响应为空；HTTP 200 不代表取链成功。');
    return parseMediaDetail(body, id);
  }, signal);
}

export async function resolveVideo(value: string, report: Report): Promise<VideoResult> {
  const result = requireVideo(await resolveMedia(value, report));
  report(`取链成功：${result.candidates.length} 个视频地址`);
  return result;
}

export function redactMediaUrls(message: string): string {
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[媒体地址]').slice(0, 300);
}
