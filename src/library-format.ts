export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const MAX_LIBRARY_ITEMS = 100_000;
const coverDomains = [
  'douyinpic.com',
  'douyincdn.com',
  'douyinstatic.com',
  'byteimg.com',
  'ibytedtos.com',
  'bytecdn.cn',
  'pstatp.com',
];

export type WorkKind = 'video' | 'gallery' | 'live-gallery';
export type LibraryFilter = 'all' | 'video' | 'gallery';
export type LibraryWork = {
  id: string;
  title: string;
  author: string;
  publishedAt: number | null;
  kind: WorkKind;
  coverUrl: string | null;
  sourceOrder: number | null;
};
export type LibraryImport = {
  version: 1 | 2;
  exportedAt: number;
  sourceLabel: string;
  works: LibraryWork[];
  duplicateRows: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('清单字段格式有误。');
  return value as Record<string, unknown>;
}

function utc(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    throw new Error('日期不是 UTC ISO 8601 格式。');
  const time = Date.parse(value);
  const normalized = value.includes('.') ? value.replace(/\.(\d+)Z$/, (_, fraction: string) => '.' + fraction.padEnd(3, '0') + 'Z') : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString() !== normalized) throw new Error('日期无效。');
  return time;
}

function legacyPublishedAt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8640000000000)
    throw new Error('发布时间无效。');
  return value > 0 ? value * 1000 : null;
}

export function allowedCover(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      coverDomains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))
    ) return value;
  } catch {
    // Treat unsupported cover URLs as absent metadata.
  }
  return null;
}

function kindOf(row: Record<string, unknown>, version: 1 | 2): WorkKind {
  if (version === 1) {
    if (typeof row.isLive === 'boolean' && row.mediaType === 'gallery') return row.isLive ? 'live-gallery' : 'gallery';
    if (row.mediaType === 'video' && row.isLive === false) return 'video';
  } else if (row.kind === 'video' || row.kind === 'gallery' || row.kind === 'live-gallery') {
    return row.kind;
  }
  throw new Error('作品类型无效。');
}

export function decodeLibrary(text: string): LibraryImport {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('无法读取 JSON，请选择 MyLike 导出的清单。');
  }
  const file = record(value);
  if (file.format !== 'mylike.library') throw new Error('此文件不是 MyLike 清单。');
  const version = file.version;
  if (version !== 1 && version !== 2) throw new Error('暂不支持这个清单版本。');
  const source = record(file.source);
  if (typeof source.label !== 'string' || source.label.length > 160 ||
      (version === 2 && (source.kind !== 'douyin.likes' || file.order !== 'desktop-liked')))
    throw new Error('清单来源或顺序字段无效。');
  if (!Array.isArray(file.items) || file.items.length === 0) throw new Error('清单中没有作品。');
  if (file.items.length > MAX_LIBRARY_ITEMS) throw new Error('一次最多导入 10 万条作品。');
  const exportedAt = utc(file.exportedAt);
  const byId = new Map<string, LibraryWork>();
  for (const [index, raw] of file.items.entries()) {
    try {
      const row = record(raw);
      if (typeof row.id !== 'string' || !/^\d{1,30}$/.test(row.id) ||
          typeof row.title !== 'string' || typeof row.author !== 'string')
        throw new Error('缺少有效的作品 ID、标题或作者。');
      const kind = kindOf(row, version);
      const publishedAt = version === 1
        ? legacyPublishedAt(row.publishedAt)
        : row.publishedAt === null ? null : utc(row.publishedAt);
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          id: row.id,
          title: row.title,
          author: row.author,
          publishedAt,
          kind,
          coverUrl: version === 2 ? allowedCover(row.coverUrl) : null,
          sourceOrder: version === 2 ? index : null,
        });
      }
    } catch (error) {
      throw new Error(`第 ${index + 1} 条作品无效：${error instanceof Error ? error.message : '字段有误。'}`);
    }
  }
  return {
    version,
    exportedAt,
    sourceLabel: source.label,
    works: [...byId.values()],
    duplicateRows: file.items.length - byId.size,
  };
}
