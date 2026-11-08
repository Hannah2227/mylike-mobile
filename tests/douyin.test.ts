import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { test } from 'node:test';

import { parseDetail, parseInput, parseMediaDetail, resolveVideo, SAMPLE_ID } from '../src/douyin.ts';

const mediaUrl = 'https://media.example.test/play?signature=a%2Fb';
const detailBody = `{"status_code":0,"aweme_detail":{"aweme_id":${SAMPLE_ID},"desc":"测试",` +
  `"video":{"play_addr":{"url_list":["http://media.example.test/insecure","${mediaUrl}","${mediaUrl}"]}}}}`;

test('recognizes an ID inside share text and rejects an unrelated host', () => {
  deepEqual(parseInput(`抖音分享：https://www.douyin.com/video/${SAMPLE_ID}，复制打开`), { id: SAMPLE_ID });
  deepEqual(parseInput('分享 https://v.douyin.com/example/'), { url: 'https://v.douyin.com/example/' });
  throws(() => parseInput(`https://douyin.com.example.test/video/${SAMPLE_ID}`));
});

test('preserves the exact numeric ID and signed HTTPS address', () => {
  deepEqual(parseDetail(detailBody, SAMPLE_ID), { id: SAMPLE_ID, title: '测试', candidates: [mediaUrl] });
  const otherId = String(BigInt(SAMPLE_ID) + 1n);
  throws(() => parseDetail(detailBody.replace(SAMPLE_ID, otherId), SAMPLE_ID), /不同的作品 ID/);
});

test('reads the public author name for the playback caption', () => {
  const body = JSON.stringify({ status_code: 0, aweme_detail: {
    aweme_id: SAMPLE_ID,
    video: { play_addr: { url_list: [mediaUrl] } },
    author: { nickname: ' 作者 ' },
  } });
  equal(parseMediaDetail(body, SAMPLE_ID).author, '作者');
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
  throws(() => parseDetail(body, SAMPLE_ID), /已取到图集详情/);
});

test('an HTTP 200 with no work data is not a successful lookup', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{"status_code":0}'));
  const logs: string[] = [];
  await rejects(resolveVideo(SAMPLE_ID, (message) => logs.push(message)), /没有作品数据/);
  equal(logs.some((message) => message.startsWith('取链成功')), false);
});

test('the guest detail request does not send credentials', async (context) => {
  const request = context.mock.method(globalThis, 'fetch', async () => new Response(detailBody));
  const video = await resolveVideo(SAMPLE_ID, () => undefined);
  const [url, options] = request.mock.calls[0].arguments as unknown as [string, RequestInit];
  equal(new URL(url).searchParams.get('aweme_id'), SAMPLE_ID);
  equal(options.credentials, 'omit');
  equal(new Headers(options.headers).has('cookie'), false);
  deepEqual(video.candidates, [mediaUrl]);
});
