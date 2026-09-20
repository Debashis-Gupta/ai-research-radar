import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, normalize, handler } from '../supabase/functions/refresh-feed/index.ts';

test('RSS and Atom preserve titles, links, dates and plain text summaries', () => {
  const rss = parseFeed('<rss><channel><item><title><![CDATA[AI &amp; ML]]></title><link>https://example.org/blog</link><pubDate>Wed, 10 Sep 2025 12:00:00 GMT</pubDate><description><![CDATA[<p>Learning</p>]]></description></item></channel></rss>', 'Blog');
  assert.equal(rss[0].title, 'AI & ML'); assert.equal(rss[0].summary, 'Learning');
  const atom = parseFeed('<feed><entry><title>Paper</title><link rel="alternate" href="https://arxiv.org/abs/1234.56789"/><published>2025-09-10T12:00:00Z</published><author><name>Alice</name></author></entry></feed>', 'arXiv');
  assert.equal(atom[0].url, 'https://arxiv.org/abs/1234.56789'); assert.deepEqual(atom[0].authors, ['Alice']);
  assert.throws(() => parseFeed('<html>Unavailable</html>', 'Blog'));
});

test('normalization excludes invalid/future dates and unsafe links, deduplicates and sorts', () => {
  const base = { id: 'x', source: 'A', sources: ['A'], title: 'Old', url: 'https://example.org/a', published: '2025-01-01', summary: '', tags: [], authors: [] };
  const result = normalize([base, { ...base, source: 'B', sources: ['B'] }, { ...base, title: 'Future', published: '2045-01-01' }, { ...base, title: 'Bad', published: 'invalid' }, { ...base, title: 'Unsafe', url: 'javascript:alert(1)' }, { ...base, title: 'New', published: '2025-09-01' }], Date.parse('2025-09-11'));
  assert.deepEqual(result.map(i => i.title), ['New', 'Old']); assert.deepEqual(result[1].sources, ['A', 'B']);
});

test('request validation, partial failures, cache and all-source failure', async t => {
  assert.equal((await handler(new Request('https://test', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(new Request('https://test'))).status, 405);
  const post = body => new Request('https://test', { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await handler(post({ kind: 'videos' }))).status, 400);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    if (String(url).includes('openai.com')) return new Response('<rss><channel><item><title>Test article</title><link>https://example.org/test</link><pubDate>2025-01-01</pubDate></item></channel></rss>');
    return new Response('Unavailable', { status: 503 });
  });
  const first = await handler(post({ kind: 'blogs' }));
  assert.equal(first.status, 200);
  const data = await first.json(); assert.equal(data.items.length, 1); assert.equal(data.warnings.length, 3);
  const count = calls;
  assert.equal((await (await handler(post({ kind: 'blogs' }))).json()).cached, true);
  assert.equal(calls, count);
  assert.equal((await handler(post({ kind: 'papers' }))).status, 502);
});
