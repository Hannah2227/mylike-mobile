import { deepEqual, equal, ok, rejects, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { parseMediaDetail, resolveMedia } from '../src/douyin.ts';

const SAMPLE_ID = '7637322941528689935';
const mediaUrl = 'https://media.example.test/play?signature=a%2Fb';
const detailBody = `{"status_code":0,"aweme_detail":{"aweme_id":${SAMPLE_ID},"desc":"测试",` +
  `"video":{"play_addr":{"url_list":["http://media.example.test/insecure","${mediaUrl}","${mediaUrl}"]}}}}`;

test('keeps real presentation metadata without inventing missing public counts', () => {
  const value = parseMediaDetail(JSON.stringify({ status_code: 0, aweme_detail: { aweme_id: SAMPLE_ID, video: { play_addr: { url_list: [mediaUrl] } },
    author: { nickname: '作者', sec_uid: 'MS4wLjABAAAA' + 'a'.repeat(60), avatar_thumb: { url_list: ['http://unsafe.test/a', 'https://images.example.test/avatar'] } },
    music: { title: '配乐' }, statistics: { digg_count: 0, comment_count: 12, collect_count: -1, share_count: 'unknown' },
  } }), SAMPLE_ID);
  equal(value.authorAvatar, 'https://images.example.test/avatar');
  equal(value.authorSecUid, 'MS4wLjABAAAA' + 'a'.repeat(60));
  deepEqual(value.statistics, { likes: 0, comments: 12 });
});

test('rejects an invalid work ID before making a request', async (context) => {
  const request = context.mock.method(globalThis, 'fetch', async () => new Response(detailBody));
  await rejects(resolveMedia(`${SAMPLE_ID}&aid=1`), /作品 ID 无效/);
  equal(request.mock.callCount(), 0);
});

test('preserves the exact numeric ID and signed HTTPS address', () => {
  deepEqual(parseMediaDetail(detailBody, SAMPLE_ID), { id: SAMPLE_ID, title: '测试', candidates: [mediaUrl] });
  const otherId = String(BigInt(SAMPLE_ID) + 1n);
  throws(() => parseMediaDetail(detailBody.replace(SAMPLE_ID, otherId), SAMPLE_ID), /不同的作品 ID/);
});

test('reads the public author name for the playback caption', () => {
  const body = JSON.stringify({ status_code: 0, aweme_detail: {
    aweme_id: SAMPLE_ID,
    video: { play_addr: { url_list: [mediaUrl] } },
    author: { nickname: ' 作者 ' },
  } });
  equal(parseMediaDetail(body, SAMPLE_ID).author, '作者');
});
test('keeps display dimensions for proportional fitting and omits invalid dimensions', () => {
  const body = (width: unknown, height: unknown) => JSON.stringify({ status_code: 0, aweme_detail: { aweme_id: SAMPLE_ID, video: { width, height, play_addr: { url_list: [mediaUrl] } } } });
  const portrait = parseMediaDetail(body(1080, 1920), SAMPLE_ID); ok('candidates' in portrait); deepEqual(portrait.size, { width: 1080, height: 1920 });
  const unknown = parseMediaDetail(body('1080', -1920), SAMPLE_ID); equal('size' in unknown, false);
});

test('keeps gallery pages in order and separates pictures, H.264 clips and album music', () => {
  const imageUrl = 'https://images.example.test/1.webp';
  const lastImageUrl = 'https://images.example.test/3.webp';
  const lastClip = 'https://media.example.test/clip-3?signature=a%2Fb';
  const otherClip = 'https://media.example.test/alternate.mp4';
  const albumMusic = 'https://media.example.test/music.m4a?signature=a%2Fb';
  const backupMusic = 'https://media.example.test/music-backup.m4a';
  const body = JSON.stringify({ status_code: 0, aweme_detail: {
    aweme_id: SAMPLE_ID,
    desc: '图集',
    video: { play_addr: { url_list: ['https://media.example.test/background-track'] } },
    music: {
      play_url: { url_list: [albumMusic, 'http://media.example.test/insecure'] },
      matched_pgc_sound: { play_url: { url_list: [albumMusic, backupMusic] } },
    },
    images: [
      { url_list: [imageUrl, imageUrl], video: {
        play_addr: { url_list: [otherClip] },
        play_addr_h264: { url_list: [mediaUrl] },
      } },
      { url_list: ['http://images.example.test/invalid'] },
      { url_list: [lastImageUrl], live_image: { url_list: [lastClip, lastClip, 'http://media.example.test/invalid'] } },
    ],
  } });
  deepEqual(parseMediaDetail(body, SAMPLE_ID), { id: SAMPLE_ID, title: '图集', musicCandidates: [albumMusic, backupMusic], images: [
    { candidates: [imageUrl], liveCandidates: [mediaUrl, otherClip] },
    { candidates: [], liveCandidates: [] },
    { candidates: [lastImageUrl], liveCandidates: [lastClip] },
  ] });
});

test('an HTTP 200 with no work data is not a successful lookup', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{"status_code":0}'));
  await rejects(resolveMedia(SAMPLE_ID), /没有作品数据/);
});


test('the guest detail request does not send credentials', async (context) => {
  const request = context.mock.method(globalThis, 'fetch', async () => new Response(detailBody));
  const video = await resolveMedia(SAMPLE_ID);
  const [url, options] = request.mock.calls[0].arguments as unknown as [string, RequestInit];
  equal(new URL(url).searchParams.get('aweme_id'), SAMPLE_ID);
  equal(options.credentials, 'omit');
  equal(new Headers(options.headers).has('cookie'), false);
  deepEqual(video, { id: SAMPLE_ID, title: '测试', candidates: [mediaUrl] });
});
