import { equal, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { publicWorkLink, shareText } from '../src/mobile/sharing.ts';
test('sharing uses the public work page and rejects URL or query injection', () => {
  const id = '7696196366620022011'; const video = publicWorkLink(id, false); const gallery = publicWorkLink(id, true);
  equal(video, `https://www.douyin.com/video/${id}`); equal(gallery, `https://www.douyin.com/note/${id}`);
  for (const value of ['https://example.test', `${id}?token=private`, `${id}/extra`, '123']) throws(() => publicWorkLink(value, false));
  equal(shareText('  作品标题  ', video), `作品标题\n${video}`); equal(shareText('', gallery), `抖音作品\n${gallery}`);
});
