// Public YouTube metadata only. No database access, credentials, or arbitrary URLs.
const CHANNEL_ID = /^UC[\w-]{22}$/;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const cache = new Map<string, { expires: number; data: unknown }>();

export function channelReference(input: string): string {
  let value = input.trim();
  if (value.length > 250) throw new Error('Channel address is too long.');
  if (/^(www\.|m\.)?youtube\.com\//i.test(value)) value = 'https://' + value;
  if (value.startsWith('https://') || value.startsWith('http://')) {
    const url = new URL(value);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.port || url.username || url.password) {
      throw new Error('Use a YouTube channel URL, @handle, or channel ID.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    value = parts[0] === 'channel' ? parts[1] || '' : parts[0] || '';
  }
  if (CHANNEL_ID.test(value) || /^@[\p{L}\p{N}_.\-·]{3,100}$/u.test(value)) return value;
  throw new Error('Use a YouTube @handle or a /channel/UC… URL, not a video or playlist link.');
}

function xmlText(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, numeric, named) => {
      if (named) return entities[named.toLowerCase()];
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

export function parseChannelFeed(xml: string, id: string) {
  if (!/<feed[\s>]/.test(xml)) throw new Error('YouTube did not return a channel feed.');
  const head = xml.split('<entry>')[0];
  const name = xmlText(head.match(/<title>([\s\S]*?)<\/title>/)?.[1] || id);
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
    const videoId = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1];
    if (!videoId) return [];
    const text = (tag: string) => xmlText(entry.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || '');
    return [{ id: `youtube-${videoId}`, video_id: videoId, channel_id: id, source: name,
      title: text('title'), summary: text('media:description').slice(0, 500),
      published: text('published'), url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, tags: [] }];
  }).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 15);
  return { channel_id: id, name, videos, fetched_at: new Date().toISOString() };
}

async function youtubeText(url: string, maximum: number): Promise<string> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('YouTube could not load this channel. Check the address or try again later.');
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('YouTube returned an unexpectedly large response.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export async function handler(request: Request): Promise<Response> {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 1024) return reply({ error: 'Request too large.' }, 413);
    const body = JSON.parse(raw);
    if (typeof body.channel !== 'string') return reply({ error: 'A channel address is required.' }, 400);
    const reference = channelReference(body.channel);
    const cached = cache.get(reference);
    if (cached && cached.expires > Date.now()) return reply(cached.data);
    let id = reference;
    if (!CHANNEL_ID.test(id)) {
      const html = await youtubeText(`https://www.youtube.com/${encodeURIComponent(reference)}`, 4_000_000);
      // Read channel-level metadata, never a recommended video's channelId.
      id = html.match(/"externalId"\s*:\s*"(UC[\w-]{22})"/)?.[1]
        || html.match(/<link[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] || '';
      if (!CHANNEL_ID.test(id)) throw new Error('Could not resolve this handle. Try its /channel/UC… URL instead.');
    }
    const data = parseChannelFeed(await youtubeText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, 512_000), id);
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(reference, { expires: Date.now() + 60_000, data });
    return reply(data);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Could not load this channel.' }, 400);
  }
}

// Allows the same parsing/validation code to be tested with Node's TypeScript support.
if (typeof Deno !== 'undefined') Deno.serve(handler);
