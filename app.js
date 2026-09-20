const DEFAULT_INTERESTS = [
  'Large Language Models',
  'Machine Learning',
  'Probabilistic AI',
  'Multimodal Learning',
];

const INTEREST_CATALOG = [
  { id: 'machine-learning', label: 'Machine Learning', keywords: ['machine learning', 'deep learning', 'neural network', 'representation learning'] },
  { id: 'llm', label: 'Large Language Models', keywords: ['large language model', 'llm', 'language model', 'transformer', 'foundation model', 'instruction tuning'] },
  { id: 'generative-ai', label: 'Generative AI', keywords: ['generative ai', 'generative model', 'diffusion', 'text-to-image', 'text to image', 'flow matching'] },
  { id: 'computer-vision', label: 'Computer Vision', keywords: ['computer vision', 'vision', 'image', 'visual', 'object detection', 'segmentation', 'cs.cv'] },
  { id: 'multimodal', label: 'Multimodal Learning', keywords: ['multimodal', 'multi-modal', 'vision language', 'vision-language', 'vlm', 'cross-modal', 'cross modal'] },
  { id: 'nlp', label: 'NLP', keywords: ['natural language processing', 'nlp', 'language understanding', 'text generation', 'cs.cl'] },
  { id: 'probabilistic-ai', label: 'Probabilistic AI', keywords: ['probabilistic', 'probabilistic circuit', 'probabilistic circuits', 'bayesian', 'graphical model', 'uncertainty'] },
  { id: 'knowledge-graphs', label: 'Knowledge Graphs', keywords: ['knowledge graph', 'knowledge graphs', 'graph reasoning', 'entity linking', 'relation extraction'] },
  { id: 'reinforcement-learning', label: 'Reinforcement Learning', keywords: ['reinforcement learning', 'rl', 'policy learning', 'reward model', 'agentic reinforcement'] },
  { id: 'agents', label: 'AI Agents', keywords: ['ai agent', 'agents', 'agentic', 'tool use', 'tool-use', 'multi-agent', 'multi agent'] },
  { id: 'reasoning', label: 'Reasoning', keywords: ['reasoning', 'chain of thought', 'chain-of-thought', 'planning', 'inference time', 'test-time compute'] },
  { id: 'ai-safety', label: 'AI Safety & Alignment', keywords: ['ai safety', 'alignment', 'robustness', 'adversarial', 'interpretability', 'mechanistic interpretability', 'responsible ai'] },
  { id: 'robotics', label: 'Robotics', keywords: ['robotics', 'robot', 'embodied ai', 'embodied', 'manipulation', 'navigation', 'cs.ro'] },
  { id: 'optimization', label: 'Optimization', keywords: ['optimization', 'gradient descent', 'optimizer', 'loss landscape', 'training dynamics'] },
  { id: 'graphs', label: 'Graph ML', keywords: ['graph neural network', 'gnn', 'graph learning', 'graph representation'] },
  { id: 'ai-for-science', label: 'AI for Science', keywords: ['ai for science', 'scientific machine learning', 'biology', 'drug discovery', 'materials', 'climate'] },
  { id: 'remote-sensing', label: 'Remote Sensing & GeoAI', keywords: ['remote sensing', 'satellite', 'earth observation', 'geospatial', 'geoai', 'sar', 'hyperspectral'] },
  { id: 'biomedical-ai', label: 'Biomedical AI', keywords: ['biomedical', 'medical ai', 'medical imaging', 'healthcare', 'clinical', 'ehr', 'electronic health record'] },
  { id: 'federated-learning', label: 'Federated Learning', keywords: ['federated learning', 'federated', 'privacy preserving', 'privacy-preserving', 'distributed learning'] },
  { id: 'causal-ml', label: 'Causal ML', keywords: ['causal machine learning', 'causal inference', 'causality', 'counterfactual'] },
];

const account = new RadarAccount({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});

const state = {
  data: { papers: [], blogs: [], videos: [], generated_at: null },
  kind: 'papers',
  mode: 'new',
  query: '',
  source: 'all',
  favorites: account.favorites,
  interests: account.profile.interests,
};

const els = {
  feed: document.querySelector('#feed'),
  empty: document.querySelector('#emptyState'),
  emptyText: document.querySelector('#emptyText'),
  template: document.querySelector('#cardTemplate'),
  search: document.querySelector('#searchInput'),
  source: document.querySelector('#sourceFilter'),
  title: document.querySelector('#sectionTitle'),
  subtitle: document.querySelector('#sectionSubtitle'),
  visible: document.querySelector('#visibleCount'),
  preferredCount: document.querySelector('#preferredCount'),
  lastUpdated: document.querySelector('#lastUpdated'),
  interestsButton: document.querySelector('#interestsButton'),
  interestSummary: document.querySelector('#interestSummary'),
  modal: document.querySelector('#interestModal'),
  interestGrid: document.querySelector('#interestGrid'),
  closeModal: document.querySelector('#closeInterestModal'),
  saveInterests: document.querySelector('#saveInterests'),
  selectDefaults: document.querySelector('#selectDefaults'),
  clearInterests: document.querySelector('#clearInterests'),
};

function cleanText(value = '') {
  const parsed = new DOMParser().parseFromString(String(value), 'text/html');
  return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function itemId(item) {
  return item.id || item.url;
}

function updateFavoriteCount() {
  els.preferredCount.textContent = Object.keys(state.favorites).length;
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown date';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function relativeUpdated(dateString) {
  if (!dateString) return 'Last update unavailable';
  const d = new Date(dateString);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Updated ${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Updated ${hrs}h ago`;
  return `Updated ${formatDate(dateString)}`;
}

function populateCounts() {
  for (const kind of ['papers', 'blogs', 'videos']) {
    const count = state.data[kind].length;
    document.querySelector(`#${kind === 'papers' ? 'paper' : kind === 'blogs' ? 'blog' : 'video'}Count`).textContent = count;
    document.querySelector(`#${kind}Badge`).textContent = count;
  }
  els.lastUpdated.textContent = relativeUpdated(state.data.generated_at);
}

function itemSources(item) {
  const values = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [item.source];
  return [...new Set(values.filter(Boolean))];
}

function populateSources(items = null) {
  const current = els.source.value;
  const pool = items || state.data[state.kind];
  const sources = [...new Set(pool.flatMap(itemSources))].sort();
  els.source.replaceChildren(new Option('All sources', 'all'), ...sources.map(source => new Option(source, source)));
  els.source.value = sources.includes(current) ? current : 'all';
  state.source = els.source.value;
}

function catalogById(id) {
  return INTEREST_CATALOG.find(topic => topic.id === id);
}

function textForItem(item) {
  return [
    item.title,
    item.summary,
    item.source,
    ...itemSources(item),
    ...(item.authors || []),
    ...(item.tags || []),
    ...(item.topics || []),
  ].join(' ').toLowerCase();
}

function containsKeyword(text, keyword) {
  const key = keyword.toLowerCase();
  if (key.length <= 3 && /^[a-z0-9]+$/i.test(key)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(key);
}

function interestScore(item) {
  if (!state.interests.length) return { score: 0, matched: [] };
  const text = textForItem(item);
  const matched = [];
  let score = 0;

  for (const id of state.interests) {
    const topic = catalogById(id);
    if (!topic) continue;
    let topicScore = 0;
    const title = (item.title || '').toLowerCase();
    const tags = [...(item.tags || []), ...(item.topics || [])].join(' ').toLowerCase();
    for (const keyword of topic.keywords) {
      if (containsKeyword(title, keyword)) topicScore += 6;
      else if (containsKeyword(tags, keyword)) topicScore += 4;
      else if (containsKeyword(text, keyword)) topicScore += 2;
    }
    if (topicScore > 0) {
      score += topicScore;
      matched.push(topic.label);
    }
  }

  const published = new Date(item.published || 0).getTime();
  if (published && Date.now() - published < 7 * 86400000) score += 1;

  // Small quality signals help break ties without overwhelming topical relevance.
  const hfUpvotes = Number(item.metrics?.hf_upvotes || 0);
  if (hfUpvotes > 0) score += Math.min(3, Math.log2(hfUpvotes + 1) / 3);
  const citations = Number(item.metrics?.citation_count || 0);
  if (citations > 0) score += Math.min(2, Math.log10(citations + 1));
  return { score, matched };
}

function baseItemsForMode() {
  if (state.mode === 'preferred') {
    return Object.values(state.favorites).filter(item => item._kind === state.kind);
  }

  if (state.mode === 'foryou') {
    if (!state.interests.length) return [];
    return state.data[state.kind]
      .map(item => ({ ...item, _interest: interestScore(item) }))
      .filter(item => item._interest.matched.length > 0)
      .sort((a, b) => {
        if (b._interest.score !== a._interest.score) return b._interest.score - a._interest.score;
        return new Date(b.published || 0) - new Date(a.published || 0);
      });
  }

  return state.data[state.kind];
}

function filteredItems() {
  const query = state.query.toLowerCase().trim();
  const base = baseItemsForMode();
  const filtered = base
    .filter(item => state.source === 'all' || itemSources(item).includes(state.source))
    .filter(item => {
      if (!query) return true;
      return textForItem(item).includes(query);
    });

  if (state.mode === 'foryou') return filtered;
  return filtered.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
}

function makeTag(label, className = '') {
  const span = document.createElement('span');
  span.className = `tag ${className}`.trim();
  span.textContent = label;
  return span;
}

function updateInterestUI() {
  const topics = state.interests.map(catalogById).filter(Boolean);
  if (!topics.length) {
    els.interestSummary.textContent = 'Choose interests';
    els.interestsButton.classList.add('attention');
    return;
  }
  els.interestsButton.classList.remove('attention');
  els.interestSummary.textContent = topics.length === 1 ? topics[0].label : `${topics.length} interests`;
}

function render() {
  document.querySelector('#feedRefreshControls').classList.toggle('hidden', state.kind === 'videos');
  const refresh = refreshStates[state.kind];
  document.querySelector('#refreshFeed').disabled = Boolean(refresh?.busy);
  document.querySelector('#refreshFeed').textContent = refresh?.busy ? 'Refreshing…' : `Refresh ${state.kind} ↻`;
  document.querySelector('#feedRefreshStatus').textContent = refresh?.message || '';
  const channelsActive = state.kind === 'videos' && state.mode === 'channels';
  document.querySelector('#myChannelsTab').classList.toggle('hidden', state.kind !== 'videos');
  document.querySelector('#channelView').classList.toggle('hidden', !channelsActive);
  document.querySelector('.feed-header').classList.toggle('hidden', channelsActive);
  document.querySelector('.control-row').classList.toggle('hidden', channelsActive);
  els.feed.classList.toggle('hidden', channelsActive);
  channelView.active = channelsActive;
  if (channelsActive) { els.empty.classList.add('hidden'); channelView.render(); return; }

  const modeBase = baseItemsForMode();
  populateSources(modeBase.length ? modeBase : state.data[state.kind]);
  const items = filteredItems();
  els.feed.innerHTML = '';
  els.empty.classList.toggle('hidden', items.length > 0);
  els.visible.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  const singular = state.kind === 'papers' ? 'paper' : state.kind === 'blogs' ? 'blog post' : 'video';
  const plural = state.kind === 'papers' ? 'papers' : state.kind;

  if (state.mode === 'new') {
    els.title.textContent = `Newest ${plural}`;
    els.subtitle.textContent = 'Newest items appear on top.';
    els.emptyText.textContent = 'Try changing your search or source filter.';
  } else if (state.mode === 'preferred') {
    els.title.textContent = `Preferred ${plural}`;
    els.subtitle.textContent = `Your personally saved ${plural}.`;
    els.emptyText.textContent = `Star a ${singular} and it will appear here.`;
  } else {
    els.title.textContent = `${plural[0].toUpperCase()}${plural.slice(1)} for you`;
    els.subtitle.textContent = state.interests.length
      ? 'Ranked by how closely each item matches your selected interests.'
      : 'Choose your research interests to build a personalized feed.';
    els.emptyText.textContent = state.interests.length
      ? 'No strong matches yet. Try adding more interests or check New.'
      : 'Choose a few topics and this feed will personalize itself.';
  }

  for (const item of items) {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector('.card');
    const typePill = node.querySelector('.type-pill');
    const source = node.querySelector('.source');
    const time = node.querySelector('time');
    const fav = node.querySelector('.favorite-btn');
    const title = node.querySelector('.title-link');
    const summary = node.querySelector('.summary');
    const authors = node.querySelector('.authors');
    const tags = node.querySelector('.tags');
    const open = node.querySelector('.open-link');
    const matchLine = node.querySelector('.match-line');

    card.dataset.id = itemId(item);
    typePill.textContent = state.kind === 'papers' ? 'paper' : state.kind === 'blogs' ? 'blog' : 'video';
    const sources = itemSources(item);
    source.textContent = sources.length ? sources.join(' · ') : 'Unknown source';
    time.dateTime = item.published || '';
    time.textContent = formatDate(item.published);
    title.textContent = cleanText(item.title || 'Untitled');
    title.href = safeLink(item.url);
    summary.textContent = cleanText(item.summary || '');
    if (!summary.textContent) summary.classList.add('hidden');

    if (item.authors?.length) {
      authors.textContent = item.authors.slice(0, 8).join(', ') + (item.authors.length > 8 ? ' et al.' : '');
      authors.classList.remove('hidden');
    }

    if (state.mode === 'foryou' && item._interest?.matched?.length) {
      matchLine.textContent = `Matches: ${item._interest.matched.slice(0, 3).join(' · ')}`;
      matchLine.classList.remove('hidden');
    }

    (item.tags || []).slice(0, 5).forEach(tag => tags.appendChild(makeTag(tag)));
    if (state.kind === 'papers') {
      const hfUpvotes = Number(item.metrics?.hf_upvotes || 0);
      if (hfUpvotes > 0) tags.appendChild(makeTag(`▲ ${hfUpvotes} HF`, 'signal-tag'));
      const citations = Number(item.metrics?.citation_count || 0);
      if (citations > 0) tags.appendChild(makeTag(`${citations} citations`, 'signal-tag'));
    }
    open.href = safeLink(item.url);

    const id = itemId(item);
    const isFavorite = Boolean(state.favorites[id]);
    fav.textContent = isFavorite ? '★' : '☆';
    fav.classList.toggle('active', isFavorite);
    fav.setAttribute('aria-label', isFavorite ? 'Remove from preferred' : 'Add to preferred');
    fav.title = isFavorite ? 'Remove from preferred' : 'Add to preferred';
    fav.disabled = !account.ready || account.busy;
    fav.addEventListener('click', async () => {
      const snapshot = { ...item, _kind: state.kind };
      delete snapshot._interest;
      await account.toggleFavorite(id, snapshot);
    });

    els.feed.appendChild(node);
  }
}

function openInterestModal() {
  els.interestGrid.innerHTML = '';
  INTEREST_CATALOG.forEach(topic => {
    const label = document.createElement('label');
    label.className = 'interest-option';
    label.innerHTML = `
      <input type="checkbox" value="${topic.id}" ${state.interests.includes(topic.id) ? 'checked' : ''}>
      <span class="interest-check">✓</span>
      <span>${topic.label}</span>
    `;
    els.interestGrid.appendChild(label);
  });
  els.modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeInterestModal() {
  els.modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

async function saveModalInterests() {
  const interests = [...els.interestGrid.querySelectorAll('input:checked')].map(input => input.value);
  if (await account.saveProfile({ interests })) closeInterestModal();
}

function setDefaultInterests() {
  const ids = DEFAULT_INTERESTS
    .map(label => INTEREST_CATALOG.find(topic => topic.label === label)?.id)
    .filter(Boolean);
  els.interestGrid.querySelectorAll('input').forEach(input => { input.checked = ids.includes(input.value); });
}

function bindUI() {
  document.querySelectorAll('.main-tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.main-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.kind = btn.dataset.kind;
    if (state.kind === 'videos') state.mode = 'channels';
    else if (state.mode === 'channels') state.mode = 'new';
    document.querySelectorAll('.sub-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === state.mode));
    state.source = 'all';
    render();
  }));

  document.querySelectorAll('.sub-tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
    if (state.mode === 'foryou' && !state.interests.length) openInterestModal();
    render();
  }));

  els.search.addEventListener('input', e => { state.query = e.target.value; render(); });
  els.source.addEventListener('change', e => { state.source = e.target.value; render(); });

  els.interestsButton.addEventListener('click', openInterestModal);
  els.closeModal.addEventListener('click', closeInterestModal);
  els.saveInterests.addEventListener('click', saveModalInterests);
  els.selectDefaults.addEventListener('click', setDefaultInterests);
  els.clearInterests.addEventListener('click', () => {
    els.interestGrid.querySelectorAll('input').forEach(input => { input.checked = false; });
  });
  els.modal.addEventListener('click', event => {
    if (event.target === els.modal) closeInterestModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !els.modal.classList.contains('hidden')) closeInterestModal();
  });

  const themeButton = document.querySelector('#themeButton');
  themeButton.addEventListener('click', () => {
    const theme = account.profile.theme === 'dark' ? 'light' : 'dark';
    account.saveProfile({ theme });
  });
}

async function loadData() {
  try {
    const response = await fetch(`data/feed.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.data = {
      papers: payload.papers || [],
      blogs: payload.blogs || [],
      videos: payload.videos || [],
      channelVideos: payload.channel_videos || payload.videos || [],
      generated_at: payload.generated_at || null,
    };
  } catch (error) {
    console.error('Could not load feed:', error);
    els.empty.classList.remove('hidden');
    els.emptyText.textContent = 'The feed could not be loaded. Run the fetch script or check data/feed.json.';
  }
  populateCounts();
  updateFavoriteCount();
  updateInterestUI();
  render();
}

const refreshStates = { papers: { busy: false, message: '' }, blogs: { busy: false, message: '' } };
async function refreshFeed() {
  const kind = state.kind;
  const status = refreshStates[kind];
  if (!status || status.busy) return;
  status.busy = true;
  status.message = `Fetching fresh ${kind} from sources…`;
  render();
  try {
    await initialFeedLoad;
    const config = window.RADAR_CONFIG;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw Error('Live refresh has not been configured.');
    const response = await fetch(`${config.supabaseUrl}/functions/v1/refresh-feed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey },
      body: JSON.stringify({ kind }), signal: AbortSignal.timeout(45000),
    });
    if (response.status === 404) throw Error('Live refresh is not deployed yet. Deploy the refresh-feed function in Supabase.');
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Sources are unavailable. Please try again.');
    if (!Array.isArray(data.items) || !data.items.length) throw Error('No fresh items returned. Existing content has been kept.');
    // Merge rather than remove content belonging to temporarily unavailable sources.
    const merged = new Map();
    for (const item of [...data.items, ...state.data[kind]]) {
      const date = Date.parse(item.published);
      if (!item.title || !/^https?:\/\//.test(item.url) || !Number.isFinite(date) || date > Date.now() + 86400000) continue;
      const key = item.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || item.url;
      if (!merged.has(key)) merged.set(key, item);
    }
    state.data[kind] = [...merged.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const checked = new Date(data.fetched_at).toLocaleTimeString();
    status.message = `${data.cached ? 'Recently checked' : 'Updated'} at ${checked}.`;
    if (data.warnings?.length) status.message += ` Some sources unavailable: ${data.warnings.join(', ')}. Previous items kept.`;
    populateCounts();
  } catch (error) {
    status.message = `${error.name === 'TimeoutError' ? 'Refresh timed out. Try again.' : error.message} Existing content is still available.`;
  } finally { status.busy = false; render(); }
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch { return '#'; }
}

function updateAccountUI() {
  if (shownUserId !== (account.user?.id || null)) {
    shownUserId = account.user?.id || null;
    closeInterestModal();
    channelView.player.close();
    channelView.status.textContent = '';
    document.querySelector('#customChannel').value = '';
    document.querySelector('#displayName').blur();
  }
  state.favorites = account.favorites;
  state.interests = account.profile.interests;
  const locked = !account.ready || account.busy;
  document.querySelector('#accountStatus').textContent = account.message || 'Guest mode · Saved in this browser';
  document.querySelector('#interestSaveStatus').textContent = account.message;
  document.querySelector('#signInButton').classList.toggle('hidden', Boolean(account.user));
  document.querySelector('#signInButton').disabled = !account.client || locked;
  const configured = Boolean(window.RADAR_CONFIG?.supabaseUrl && window.RADAR_CONFIG?.supabasePublishableKey);
  document.querySelector('#signInButton').textContent = configured ? 'Sign in with GitHub' : 'Sign-in unavailable';
  document.querySelector('#signInButton').title = configured ? '' : 'The site owner has not enabled accounts yet. You can still browse as a guest.';
  document.querySelector('#accountProfile').classList.toggle('hidden', !account.user);
  document.querySelector('#accountName').textContent = account.profile.display_name || 'Your account';
  const name = document.querySelector('#displayName');
  if (document.activeElement !== name) name.value = account.profile.display_name;
  name.disabled = locked;
  document.querySelector('#saveProfile').disabled = locked;
  document.querySelector('#refreshAccount').disabled = account.busy;
  document.querySelector('#signOutButton').disabled = account.busy;
  els.saveInterests.disabled = locked;
  els.interestsButton.disabled = locked;
  document.querySelector('#themeButton').disabled = locked;
  document.documentElement.dataset.theme = account.profile.theme;
  document.querySelector('#themeButton').textContent = account.profile.theme === 'dark' ? '☀' : '☾';
  document.querySelector('#interestPrivacy').textContent = account.user
    ? 'Your interests are saved to your account.' : 'Guest interests are saved only in this browser.';
  updateFavoriteCount();
  updateInterestUI();
  render();
}

async function startAccounts() {
  const config = window.RADAR_CONFIG;
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    account.emit('Guest mode · Account sign-in is not enabled on this site yet');
    return;
  }
  account.ready = false;
  account.emit('Connecting to your account…');
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.102.0');
    await account.init(config, createClient);
  } catch (error) {
    account.emit('Account connection failed. Reload the page to try again.');
    console.error('Could not load account client', error);
  }
}

const channelView = new YouTubeChannels(account, { score: interestScore, videos: () => state.data.channelVideos || state.data.videos });
bindUI();
document.querySelector('#channelInterests').addEventListener('click', openInterestModal);
document.querySelector('#signInButton').addEventListener('click', () => {
  account.signIn().catch(() => account.emit('Sign-in failed. Please try again.'));
});
document.querySelector('#signOutButton').addEventListener('click', () => {
  closeInterestModal();
  account.signOut().catch(() => account.emit('Could not sign out. Please try again.'));
});
document.querySelector('#refreshAccount').addEventListener('click', () => account.load());
document.querySelector('#profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const display_name = document.querySelector('#displayName').value.trim().slice(0, 80);
  if (await account.saveProfile({ display_name })) document.querySelector('#displayName').blur();
});
// Close any unsaved interest selection when a different account signs in or out.
let shownUserId = null;
account.onChange = updateAccountUI;
document.querySelector('#refreshFeed').addEventListener('click', refreshFeed);
const initialFeedLoad = loadData();
startAccounts();
