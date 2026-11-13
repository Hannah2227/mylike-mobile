import { deepEqual, equal, rejects, throws } from 'node:assert/strict';
import { test } from 'node:test';
import { cachedGuestComments, clearGuestCommentCache, fetchGuestCommentPreview, parseGuestCommentPreview } from '../src/guest-comments.ts';

const id = '7696196366620022011';
const cid = '7696871298211840810';
const row = { cid, aweme_id: id, text: '评论', createTime: 1700000000, reply_comment_total: 72, user: { nickname: '用户' } };
const body = (comments = [row]) => JSON.stringify({ status_code: { StatusCode: 0 }, comments });

test('share comments are explicitly a partial preview, including an empty result', () => {
  const page = parseGuestCommentPreview(body(), id);
  equal(page.items[0].id, cid);
  equal(page.items[0].createdAt, 1700000000000);
  equal(page.items[0].replyCount, 72);
  equal(page.coverage, 'preview');
  equal(page.repliesAvailable, false);
  equal('nextCursor' in page, false);
  equal(parseGuestCommentPreview(body([]), id).coverage, 'preview');
});
test('preserves bare 19-digit IDs without editing JSON-like comment text', () => {
  const input = body([{ ...row, text: '字面量 "cid":7696871298211840810' }])
    .replace(`"cid":"${cid}"`, `"cid":${cid}`).replace(`"aweme_id":"${id}"`, `"aweme_id":${id}`);
  const item = parseGuestCommentPreview(input, id).items[0];
  equal(item.id, cid);
  equal(item.workId, id);
  equal(item.text, '字面量 "cid":7696871298211840810');
});
test('rejects false empties, failed business statuses, unsafe IDs and different works', () => {
  for (const input of ['', '<html>验证</html>', '{"status_code":1,"comments":[]}', '{"status_code":0}',
    body([{ ...row, aweme_id: '7637322941528689935' }]), body([{ ...row, cid: '' }])]) {
    throws(() => parseGuestCommentPreview(input, id));
  }
});
test('deduplicates rows and keeps unsupported content visible without unsafe avatar URLs', () => {
  const page = parseGuestCommentPreview(body([{ ...row, text: '', user: { nickname: '' } }, row]), id);
  equal(page.items.length, 1);
  equal(page.items[0].text, '[暂不支持的评论内容]');
  equal(page.items[0].avatar, null);
});
test('guest reads have no cookie, cursor or fabricated signature', async context => {
  clearGuestCommentCache(); context.after(clearGuestCommentCache);
  const request = context.mock.method(globalThis, 'fetch', async () => new Response(body()));
  await fetchGuestCommentPreview(id);
  const [url, options] = request.mock.calls[0].arguments as unknown as [string, RequestInit];
  const query = new URL(url);
  equal(query.hostname, 'www.iesdouyin.com');
  deepEqual([...query.searchParams], [['aweme_id', id]]);
  equal(options.credentials, 'omit');
  equal(new Headers(options.headers).has('cookie'), false);
});

test('validated previews are reused, explicitly refreshed, expire and remain bounded', async context => {
  clearGuestCommentCache(); context.after(clearGuestCommentCache);
  let now = 100; context.mock.method(Date, 'now', () => now);
  const request = context.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const requested = new URL(String(url)).searchParams.get('aweme_id')!;
    return new Response(body([{ ...row, aweme_id: requested }]));
  });
  await fetchGuestCommentPreview(id); await fetchGuestCommentPreview(id); equal(request.mock.callCount(), 1);
  await fetchGuestCommentPreview(id, undefined, true); equal(request.mock.callCount(), 2);
  now += 120001; equal(cachedGuestComments(id), null); await fetchGuestCommentPreview(id); equal(request.mock.callCount(), 3);
  for (let i = 1; i <= 8; i++) await fetchGuestCommentPreview(String(BigInt(id) + BigInt(i)));
  equal(cachedGuestComments(id), null); equal(cachedGuestComments(String(BigInt(id) + 8n))?.items.length, 1);
});

test('failed refresh preserves the old preview and clearing cannot be undone by a late response', async context => {
  clearGuestCommentCache(); context.after(clearGuestCommentCache);
  let release!: (value: Response) => void; let late = false; let broken = false;
  context.mock.method(globalThis, 'fetch', async () => late ? new Promise<Response>(resolve => { release = resolve; }) : new Response(broken ? '{"status_code":1}' : body()));
  await fetchGuestCommentPreview(id); broken = true;
  await rejects(fetchGuestCommentPreview(id, undefined, true)); equal(cachedGuestComments(id)?.items[0].id, cid);
  late = true; const pending = fetchGuestCommentPreview(id, undefined, true); clearGuestCommentCache(); release(new Response(body())); await pending;
  equal(cachedGuestComments(id), null);
});
test('invalid and cancelled requests do not reach the network', async context => {
  const request = context.mock.method(globalThis, 'fetch', async () => new Response(body()));
  await rejects(fetchGuestCommentPreview(id + '&cursor=20'));
  await rejects(fetchGuestCommentPreview(id, AbortSignal.abort()), /已取消/);
  equal(request.mock.callCount(), 0);
});
