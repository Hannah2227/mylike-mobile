import { deepEqual, equal, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { decodeLibrary } from '../src/library-format.ts';

const first = {
  id: '7637322941528689935',
  title: '海边',
  author: '作者',
  publishedAt: '2026-05-08T10:00:00Z',
  kind: 'video',
  coverUrl: 'https://p3-pc.douyinpic.com/cover.jpg?x=a%2Fb',
};
const v2 = {
  format: 'mylike.library',
  version: 2,
  source: { kind: 'douyin.likes', label: '我的喜欢' },
  exportedAt: '2026-11-08T04:00:00.123Z',
  order: 'desktop-liked',
};

test('v2 keeps exact work IDs, order, and safe cover addresses while deduplicating', () => {
  const second = {
    ...first, id: '7637322941528689936', kind: 'live-gallery', publishedAt: null,
    coverUrl: 'https://douyinpic.com.example.test/cover.jpg',
  };
  const file = decodeLibrary(JSON.stringify({ ...v2, items: [first, second, first] }));
  equal(file.source, 'likes');
  equal(file.duplicateRows, 1);
  deepEqual(file.works.map(({ id, kind, sourceOrder, coverUrl }) => [id, kind, sourceOrder, coverUrl]), [
    [first.id, 'video', 0, first.coverUrl],
    [second.id, 'live-gallery', 1, null],
  ]);
});

test('v3 imports favorites and retains multiple folder memberships for one work', () => {
  const second = { ...first, id: '7637322941528689936' };
  const v3 = {
    ...v2, version: 3, source: { kind: 'douyin.favorites', label: '我的收藏' }, order: 'desktop-favorites',
    items: [first, second],
    folders: [
      { id: 'a'.repeat(64), title: '旅行', workIds: [first.id, first.id, second.id] },
      { id: 'b'.repeat(64), title: '摄影', workIds: [first.id] },
      { id: 'c'.repeat(64), title: '空收藏夹', workIds: [] },
    ],
  };
  const file = decodeLibrary(JSON.stringify(v3));
  equal(file.source, 'favorites');
  equal(file.works[0].coverUrl, first.coverUrl);
  deepEqual(file.folders.map(({ workIds }) => workIds), [[first.id, second.id], [first.id], []]);
  throws(() => decodeLibrary(JSON.stringify({ ...v3, version: 2 })), /清单来源/);
  throws(() => decodeLibrary(JSON.stringify({ ...v3, folders: [{ ...v3.folders[0], workIds: ['9'] }] })),
    /收藏夹或其作品关系无效/);
});

test('obsolete v1 files require a fresh desktop export', () => {
  throws(() => decodeLibrary(JSON.stringify({
    ...v2, version: 1, source: { label: '旧版' },
    items: [{ id: first.id, title: first.title, author: first.author, publishedAt: 1700000000,
      mediaType: 'gallery', isLive: true, collectedAt: 1700000001234 }],
  })), /当前桌面端重新导出/);
});

test('unsupported versions and bad rows fail the entire preview', () => {
  throws(() => decodeLibrary(JSON.stringify({ ...v2, version: 99, items: [first] })), /暂不支持/);
  throws(() => decodeLibrary(JSON.stringify({ ...v2, items: [first, { ...first, id: Number(first.id) }] })), /第 2 条作品无效/);
  throws(() => decodeLibrary(JSON.stringify({ ...v2, items: [{ ...first, publishedAt: '2026-02-30T10:00:00Z' }] })), /日期无效/);
});
