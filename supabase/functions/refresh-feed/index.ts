// Fixed upstream sources only; no database access or caller-supplied URLs.
import config from '../../../sources.json' with { type: 'json' };
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, content-type, authorization, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const secret = (name: string) => typeof Deno === 'undefined' ? '' : Deno.env.get(name) || '';
export function text(value: unknown): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, key) => entities[key])
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, value) => { const n = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match; })
    .replace(/\s+/g, ' ').trim();
}
function item(source: string, title: unknown, url: string, published: unknown, summary: unknown, authors: string[] = []) {
  return { id: `live-${url}`, source, sources: [source], title: text(title), url, published: String(published || ''), summary: text(summary).slice(0, 500), authors, tags: config.interest_keywords.filter(k => text(`${title} ${summary}`).toLowerCase().includes(k)).slice(0, 5) };
}
export function parseFeed(xml: string, source: string) {
  if (!/<(?:rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw Error('Invalid feed');
  return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(([, , entry]) => {
    const field = (tag: string) => entry.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '';
    const links = [...entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
    const alternate = links.find(([, attrs]) => !/\brel=/.test(attrs) || /\brel=["']alternate["']/.test(attrs));
    const url = text(field('link') || alternate?.[1].match(/\bhref=["']([^"']+)/)?.[1] || field('id'));
    return item(source, field('title'), url, text(field('published') || field('pubDate') || field('dc:date') || field('updated')), field('summary') || field('description') || field('content:encoded'), [...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map(m => text(m[1])));
  });
}
export function normalize(items: ReturnType<typeof item>[], now = Date.now()) {
  const unique = new Map<string, ReturnType<typeof item>>();
  for (const value of items) {
    const date = Date.parse(value.published);
    if (!value.title || !/^https?:\/\//.test(value.url) || !Number.isFinite(date) || date > now + 86400000) continue;
    value.published = new Date(date).toISOString();
    const key = value.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || value.url;
    const existing = unique.get(key);
    if (existing) existing.sources = [...new Set([...existing.sources, ...value.sources])];
    else unique.set(key, value);
  }
  return [...unique.values()].sort((a, b) => b.published.localeCompare(a.published));
}
async function upstream(url: string, extraHeaders = {}) {
  const response = await fetch(url, { headers: extraHeaders, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Upstream HTTP ${response.status}`);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8_000_000) throw Error('Feed too large'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
const json = async (url: string, extraHeaders = {}) => JSON.parse(await upstream(url, extraHeaders));
const queryURL = (base: string, params: Record<string, string>) => `${base}?${new URLSearchParams(params)}`;
export async function collect(kind: 'papers' | 'blogs') {
  const jobs: { name: string; run: () => Promise<ReturnType<typeof item>[]> }[] = [];
  if (kind === 'blogs') {
    for (const blog of config.blogs) jobs.push({ name: blog.name, run: async () => parseFeed(await upstream(blog.feed), blog.name) });
  } else {
    const sources = config.paper_sources;
    if (sources.arxiv.enabled) jobs.push({ name: 'arXiv', run: async () => parseFeed(await upstream(queryURL('https://export.arxiv.org/api/query', { search_query: sources.arxiv.categories.map(c => `cat:${c}`).join(' OR '), start: '0', max_results: String(Math.min(200, sources.arxiv.limit)), sortBy: 'submittedDate', sortOrder: 'descending' })), 'arXiv') });
    if (sources.huggingface.enabled) jobs.push({ name: 'Hugging Face', run: async () => {
      const data = await json(queryURL('https://huggingface.co/api/daily_papers', { sort: 'publishedAt', limit: String(sources.huggingface.limit) }));
      return data.map((row: any) => item('Hugging Face', row.paper.title, `https://arxiv.org/abs/${row.paper.id}`, row.paper.publishedAt || row.publishedAt, row.paper.summary, (row.paper.authors || []).map((a: any) => a.name)));
    } });
    if (sources.semantic_scholar.enabled) jobs.push({ name: 'Semantic Scholar', run: async () => {
      const cfg = sources.semantic_scholar;
      const since = new Date(Date.now() - cfg.days_back * 86400000).toISOString().slice(0, 10);
      const key = secret('SEMANTIC_SCHOLAR_API_KEY');
      const data = await json(queryURL('https://api.semanticscholar.org/graph/v1/paper/search/bulk', { query: cfg.query, fields: 'title,url,abstract,authors,publicationDate,externalIds', sort: 'publicationDate:desc', publicationDateOrYear: `${since}:`, fieldsOfStudy: 'Computer Science' }), key ? { 'x-api-key': key } : {});
      if (!Array.isArray(data.data)) throw Error('Invalid source response');
      return data.data.slice(0, cfg.limit).map((p: any) => item('Semantic Scholar', p.title, p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : p.url, p.publicationDate, p.abstract, (p.authors || []).map((a: any) => a.name)));
    } });
    if (sources.openalex.enabled) for (const term of sources.openalex.queries) jobs.push({ name: `OpenAlex (${term})`, run: async () => {
      const cfg = sources.openalex;
      const since = new Date(Date.now() - cfg.days_back * 86400000).toISOString().slice(0, 10);
      const key = secret('OPENALEX_API_KEY');
      const data = await json(queryURL('https://api.openalex.org/works', { search: term, filter: `from_publication_date:${since},to_publication_date:${new Date().toISOString().slice(0, 10)}`, sort: 'publication_date:desc', per_page: String(cfg.per_query), ...(key ? { api_key: key } : {}) }));
      if (!Array.isArray(data.results)) throw Error('Invalid source response');
      return data.results.map((p: any) => { const words: string[] = []; for (const [word, positions] of Object.entries(p.abstract_inverted_index || {})) for (const pos of positions as number[]) if (pos >= 0 && pos < 10000) words[pos] = word;
        return item('OpenAlex', p.title, p.primary_location?.landing_page_url || p.doi || p.id, p.publication_date, words.join(' '), (p.authorships || []).map((a: any) => a.author?.display_name).filter(Boolean)); });
    } });
  }
  const results = await Promise.allSettled(jobs.map(job => job.run()));
  const warnings: string[] = []; const items: ReturnType<typeof item>[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value);
    else warnings.push(jobs[index].name);
  });
  const cleaned = normalize(items).slice(0, config.limits[kind]);
  if (!cleaned.length) throw Error('No fresh items could be retrieved. Please try again later.');
  return { items: cleaned, warnings, fetched_at: new Date().toISOString() };
}
// Best-effort cache and request coalescing per warm worker, not a global quota.
const cache = new Map<string, { expires: number; data: Awaited<ReturnType<typeof collect>> }>();
const pending = new Map<string, Promise<Awaited<ReturnType<typeof collect>>>>();
export async function handler(request: Request) {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  let kind: 'papers' | 'blogs';
  try { const raw = await request.text(); if (raw.length > 512) return reply({ error: 'Request too large.' }, 413); const body = JSON.parse(raw); if (!['papers', 'blogs'].includes(body.kind)) return reply({ error: 'Choose papers or blogs.' }, 400); kind = body.kind; }
  catch { return reply({ error: 'Invalid request.' }, 400); }
  const existing = cache.get(kind);
  if (existing && existing.expires > Date.now()) return reply({ ...existing.data, cached: true });
  try {
    if (!pending.has(kind)) pending.set(kind, collect(kind).then(data => { cache.set(kind, { expires: Date.now() + 60000, data }); return data; }).finally(() => pending.delete(kind)));
    return reply({ ...await pending.get(kind), cached: false });
  } catch { return reply({ error: 'Sources are unavailable. Your existing content has been kept; try again shortly.' }, 502); }
}
if (typeof Deno !== 'undefined') Deno.serve(handler);
