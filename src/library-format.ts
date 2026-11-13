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
export type LibrarySource = 'likes' | 'favorites';
export type LibraryFolder = { id: string; title: string };
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
  version: 2 | 3;
  exportedAt: number;
  source: LibrarySource;
  sourceLabel: string;
  works: LibraryWork[];
  folders: (LibraryFolder & { workIds: string[] })[];
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

function kindOf(row: Record<string, unknown>): WorkKind {
  if (row.kind === 'video' || row.kind === 'gallery' || row.kind === 'live-gallery') {
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
  if (version !== 2 && version !== 3) throw new Error('暂不支持这个清单版本，请使用当前桌面端重新导出。');
  const source = record(file.source);
  const favorites = version === 3;
  const expectedKind = favorites ? 'douyin.favorites' : 'douyin.likes';
  const expectedOrder = favorites ? 'desktop-favorites' : 'desktop-liked';
  if (typeof source.label !== 'string' || source.label.length > 160 ||
      source.kind !== expectedKind || file.order !== expectedOrder)
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
      const kind = kindOf(row);
      const publishedAt = row.publishedAt === null ? null : utc(row.publishedAt);
      if (!byId.has(row.id)) {
        byId.set(row.id, {
          id: row.id,
          title: row.title,
          author: row.author,
          publishedAt,
          kind,
          coverUrl: allowedCover(row.coverUrl),
          sourceOrder: version === 2 ? index : null,
        });
      }
    } catch (error) {
      throw new Error(`第 ${index + 1} 条作品无效：${error instanceof Error ? error.message : '字段有误。'}`);
    }
  }
  const folders: LibraryImport['folders'] = [];
  if (favorites) {
    if (!Array.isArray(file.folders)) throw new Error('收藏夹列表无效。');
    const ids = new Set<string>();
    for (const raw of file.folders) {
      const { id, title, workIds } = record(raw);
      if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id) || ids.has(id) ||
          typeof title !== 'string' || !Array.isArray(workIds) ||
          workIds.some((workId) => typeof workId !== 'string' || !byId.has(workId)))
        throw new Error('收藏夹或其作品关系无效。');
      ids.add(id);
      folders.push({ id, title, workIds: [...new Set<string>(workIds)] });
    }
  }
  return {
    version,
    exportedAt,
    source: favorites ? 'favorites' : 'likes',
    sourceLabel: source.label,
    works: [...byId.values()],
    folders,
    duplicateRows: file.items.length - byId.size,
  };
}
