import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelReference, parseChannelFeed, handler } from '../supabase/functions/youtube-channel/index.ts';
const id = 'UCbfYPyITQ-7l4upoX8nvctg';
test('channel references accept IDs, handles, and YouTube channel URLs', () => {
  for (const input of [id, `https://www.youtube.com/channel/${id}/videos`]) assert.equal(channelReference(input), id);
  for (const input of ['@statquest', 'youtube.com/@statquest/videos', 'https://m.youtube.com/@statquest']) assert.equal(channelReference(input), '@statquest');
});
test('rejects arbitrary hosts, credentials, ports, and video URLs', () => {
  for (const value of ['https://youtube.com.evil.example/@x', 'https://localhost/', 'https://youtube.com:123/@test', 'https://user@youtube.com/@test', 'https://youtube.com/watch?v=abc', 'https://youtu.be/abcdefghijk', 'not-a-channel']) assert.throws(() => channelReference(value));
});
test('RSS parsing returns latest-first thumbnails with decoded titles', () => {
  const xml = `<feed><title>Research &amp; Learning</title>
  <entry><yt:videoId>abcdefghijk</yt:videoId><title>Neural &lt;networks&gt;</title><published>2026-01-01T00:00:00Z</published><media:group><media:description>Learn &#65;I</media:description></media:group></entry>
  <entry><yt:videoId>lmnopqrstuv</yt:videoId><title><![CDATA[Latest video]]></title><published>2026-02-01T00:00:00Z</published></entry></feed>`;
  const data = parseChannelFeed(xml, id);
  assert.equal(data.name, 'Research & Learning');
  assert.equal(data.videos[0].title, 'Latest video');
  assert.equal(data.videos[1].title, 'Neural <networks>');
  assert.equal(data.videos[1].summary, 'Learn AI');
  assert.equal(data.videos[0].thumbnail, 'https://i.ytimg.com/vi/lmnopqrstuv/hqdefault.jpg');
  assert.throws(() => parseChannelFeed('<html>Blocked</html>', id));
});
test('public endpoint supports preflight and rejects invalid requests before fetching', async () => {
  assert.equal((await handler(new Request('http://test/', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(new Request('http://test/'))).status, 405);
  const invalid = await handler(new Request('http://test/', { method: 'POST', body: JSON.stringify({ channel: 'http://127.0.0.1/' }) }));
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /YouTube/);
});
