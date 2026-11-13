import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { clearAuthorCache, parseGuestAuthor, readGuestAuthor } from '../src/guest-author.ts';
const secUid = 'MS4wLjABAAAA' + 'a'.repeat(60);
const body = JSON.stringify({ status_code: 0, user_info: { sec_uid: secUid, nickname: ' 作者 ', signature: '公开简介', avatar_medium: { url_list: ['http://unsafe.test/a', 'https://images.example.test/avatar'] }, aweme_count: 8 } });
test('guest profiles validate the author identity and expose only actual basic fields', () => {
  deepEqual(parseGuestAuthor(body, secUid), { secUid, nickname: '作者', signature: '公开简介', avatarUrl: 'https://images.example.test/avatar' });
  throws(() => parseGuestAuthor(body, secUid + 'b'), /标识不匹配/);
  throws(() => parseGuestAuthor('{"status_code":0,"user_info":{}}', secUid), /为空/);
  throws(() => parseGuestAuthor('{"status_code":5}', secUid), /游客暂时/);
  throws(() => parseGuestAuthor('', secUid), /响应无效/);
});
test('guest profile requests omit credentials, cache a validated result and are cancellable', async context => {
  clearAuthorCache(); const request = context.mock.method(globalThis, 'fetch', async () => new Response(body));
  await readGuestAuthor(secUid); await readGuestAuthor(secUid); equal(request.mock.callCount(), 1);
  const [url, options] = request.mock.calls[0].arguments as unknown as [string, RequestInit];
  equal(new URL(url).searchParams.get('sec_uid'), secUid); equal(options.credentials, 'omit'); equal(new Headers(options.headers).has('cookie'), false);
  const controller = new AbortController(); controller.abort(); await rejects(readGuestAuthor(secUid, controller.signal), /取消/);
  await rejects(readGuestAuthor(secUid + '&id=1'), /标识无效/); equal(request.mock.callCount(), 1); clearAuthorCache();
});
