// Public channel suggestions; account selections are stored separately.
const CHANNEL_SUGGESTIONS = [
  { channel_id: 'UCbfYPyITQ-7l4upoX8nvctg', name: 'Two Minute Papers', description: 'Short research highlights and new AI capabilities.' },
  { channel_id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown', description: 'Visual foundations: linear algebra, probability, and neural networks.' },
  { channel_id: 'UCZHmQk67mSJgfCCTn7xBfew', name: 'Yannic Kilcher', description: 'Technical paper discussions and AI news.' },
  { channel_id: 'UCHB9VepY6kYvZjj0Bgxnpbw', name: 'Henry AI Labs', description: 'Machine learning research and applications.' },
  { channel_id: 'UCtYLUTtgS3k1Fg4y5tAhLbw', name: 'StatQuest', description: 'Step-by-step statistics and machine learning explanations.' },
  { channel_id: 'UCXUPKJO5MZQN11PqgIvyuvQ', name: 'Andrej Karpathy', description: 'Build neural networks and language models from scratch.' },
];

class YouTubeChannels {
  constructor(account, options) {
    this.account = account;
    this.options = options;
    this.cache = new Map();
    this.queue = [];
    this.running = 0;
    this.pending = false;
    this.active = false;
    this.filter = 'all';
    this.panel = document.querySelector('#channelView');
    this.rows = document.querySelector('#channelRows');
    this.manager = document.querySelector('#channelManager');
    this.status = document.querySelector('#channelStatus');
    this.player = document.querySelector('#videoPlayer');
    document.querySelector('#customChannelForm').addEventListener('submit', event => {
      event.preventDefault();
      this.add({ handle: document.querySelector('#customChannel').value.trim() });
    });
    document.querySelector('#channelVideoFilter').addEventListener('change', event => {
      this.filter = event.target.value; this.render();
    });
    document.querySelector('#refreshChannels').addEventListener('click', async event => {
      const button = event.currentTarget;
      const selected = this.selected();
      if (!selected.length) { this.status.textContent = 'Follow a channel first to fetch its videos.'; return; }
      const generation = this.account.generation;
      button.disabled = true; button.textContent = 'Refreshing…';
      try {
        for (const channel of selected) { const entry = this.cache.get(channel.channel_id); if (entry) entry.loaded = 0; }
        await Promise.all(selected.map(channel => this.load(channel)));
        if (generation === this.account.generation) {
          const failed = selected.filter(channel => this.cache.get(channel.channel_id)?.error).length;
          this.status.textContent = failed ? `${failed} channel(s) could not refresh. Previously loaded videos are still available.` : 'Videos updated from the latest available channel feeds.';
        }
      } finally { button.disabled = false; button.textContent = 'Refresh videos ↻'; this.render(); }
    });
    document.querySelector('#closeVideo').addEventListener('click', () => this.player.close());
    this.player.addEventListener('close', () => {
      document.querySelector('#videoFrame').replaceChildren();
      this.lastPlayButton?.focus();
    });
  }

  selected() {
    return (this.account.profile.youtube_channels || []).filter(channel => /^UC[\w-]{22}$/.test(channel.channel_id));
  }

  element(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  button(text, action, className = 'text-btn') {
    const button = this.element('button', text, className);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  async fetchChannel(reference) {
    const config = window.RADAR_CONFIG;
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error('Channel lookup is unavailable. You can follow the suggested channels with saved videos.');
    const response = await fetch(`${config.supabaseUrl}/functions/v1/youtube-channel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey },
      body: JSON.stringify({ channel: reference }), signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404) throw new Error('Live video lookup is not deployed. Deploy the youtube-channel function in Supabase.');
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Channel lookup is unavailable. Please try again later.');
    if (!/^UC[\w-]{22}$/.test(data.channel_id) || !Array.isArray(data.videos)) throw new Error('The channel returned an invalid response.');
    return data;
  }

  async add(channel) {
    if (this.pending || this.account.busy || !this.account.ready) return;
    if (this.selected().length >= 30) { this.status.textContent = 'You can follow up to 30 channels. Remove one to add another.'; return; }
    const generation = this.account.generation;
    this.pending = true;
    this.status.textContent = channel.channel_id ? 'Saving channel…' : 'Finding channel…';
    this.render();
    try {
      if (!channel.channel_id) {
        const result = await this.fetchChannel(channel.handle);
        channel = { channel_id: result.channel_id, name: result.name };
        this.cache.set(channel.channel_id, { ...result, loaded: Date.now() });
      }
      if (generation !== this.account.generation) return;
      if (this.selected().some(existing => existing.channel_id === channel.channel_id)) {
        this.status.textContent = 'You already follow this channel.'; return;
      }
      const saved = await this.account.saveProfile({ youtube_channels: [...this.selected(), { channel_id: channel.channel_id, name: channel.name }] });
      if (generation !== this.account.generation) return;
      this.status.textContent = saved ? `Following ${channel.name}.` : 'Could not save this channel. Please try again. If this keeps happening, the site owner may need to enable channel preferences.';
      if (saved) document.querySelector('#customChannel').value = '';
    } catch (error) {
      if (generation === this.account.generation) this.status.textContent = error.message || 'Could not find this channel.';
    } finally { this.pending = false; this.render(); }
  }

  async remove(channel) {
    if (this.pending) return;
    const saved = await this.account.saveProfile({ youtube_channels: this.selected().filter(item => item.channel_id !== channel.channel_id) });
    this.status.textContent = saved ? `Removed ${channel.name}.` : 'Could not remove the channel. Please try again.';
  }

  fallback(channel) {
    return this.options.videos().filter(video => video.channel_id === channel.channel_id || video.source === channel.name);
  }

  load(channel) {
    const cached = this.cache.get(channel.channel_id);
    if (cached && (cached.loading || Date.now() - cached.loaded < 15 * 60_000)) return cached.promise;
    const entry = { loading: true, videos: cached?.videos?.length ? cached.videos : this.fallback(channel), loaded: Date.now() };
    this.cache.set(channel.channel_id, entry);
    entry.promise = this.enqueue(() => this.fetchChannel(channel.channel_id)).then(data => Object.assign(entry, data, { loading: false }))
      .catch(error => { entry.loading = false; entry.error = error.message || 'Live refresh unavailable.'; })
      .finally(() => { if (this.active) this.render(); });
    return entry.promise;
  }

  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.running < 3 && this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      this.running++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { this.running--; this.drain(); });
    }
  }

  play(video, button) {
    const id = this.videoId(video);
    if (!id) return;
    this.lastPlayButton = button;
    document.querySelector('#videoTitle').textContent = video.title;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?playsinline=1`;
    iframe.title = video.title;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    document.querySelector('#videoFrame').replaceChildren(iframe);
    document.querySelector('#watchOnYouTube').href = `https://www.youtube.com/watch?v=${id}`;
    this.player.showModal();
  }

  videoId(video) {
    if (/^[\w-]{11}$/.test(video.video_id)) return video.video_id;
    try { const url = new URL(video.url); const id = url.searchParams.get('v'); return /^[\w-]{11}$/.test(id) ? id : null; }
    catch { return null; }
  }

  render() {
    if (!this.active) return;
    const selected = this.selected();
    const locked = !this.account.ready || this.account.busy || this.pending;
    document.querySelector('#channelCount').textContent = `${selected.length} followed`;
    document.querySelector('#addChannel').disabled = locked;
    document.querySelector('#customChannel').disabled = locked;
    document.querySelector('#channelInterests').disabled = locked;
    const suggestions = document.querySelector('#channelSuggestions');
    suggestions.replaceChildren();
    for (const suggestion of CHANNEL_SUGGESTIONS) {
      const followed = selected.find(channel => suggestion.channel_id ? channel.channel_id === suggestion.channel_id : channel.name === suggestion.name);
      const card = this.element('article', '', 'channel-suggestion');
      card.append(this.element('strong', suggestion.name), this.element('p', suggestion.description));
      const action = this.button(followed ? 'Following ✓ · Remove' : '+ Follow', () => followed ? this.remove(followed) : this.add(suggestion));
      action.disabled = locked;
      action.setAttribute('aria-label', `${followed ? 'Unfollow' : 'Follow'} ${suggestion.name}`);
      card.append(action); suggestions.append(card);
    }
    const scrollPositions = new Map([...this.rows.querySelectorAll('.video-strip')].map(row => [row.dataset.channel, row.scrollLeft]));
    const expandedChannels = new Set([...this.rows.querySelectorAll('.channel-more[open]')].map(list => list.dataset.channel));
    this.rows.replaceChildren();
    if (!selected.length) {
      this.rows.append(this.element('p', 'Choose channels above to build your own video library.', 'channel-empty'));
      this.manager.open = true;
    }
    for (const channel of selected) {
      this.load(channel);
      const entry = this.cache.get(channel.channel_id);
      let videos = (entry?.videos || this.fallback(channel)).filter(video => this.videoId(video));
      videos = [...videos].sort((a, b) => new Date(b.published) - new Date(a.published));
      if (this.filter === 'interests') videos = videos.filter(video => this.options.score(video).matched.length);
      const row = this.element('section', '', 'channel-row');
      const header = this.element('div', '', 'channel-row-header');
      const heading = this.element('h3', channel.name);
      const actions = this.element('div', '', 'channel-row-actions');
      const link = this.element('a', 'YouTube ↗', 'open-link');
      link.href = `https://www.youtube.com/channel/${channel.channel_id}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const remove = this.button('Remove', () => this.remove(channel)); remove.disabled = locked;
      remove.setAttribute('aria-label', `Remove ${channel.name}`);
      header.append(heading, actions); actions.append(link, remove); row.append(header);
      if (entry?.loading) row.append(this.element('p', 'Checking for new videos…', 'channel-note'));
      else if (entry?.error) row.append(this.element('p', `${entry.error} ${videos.length ? 'Showing previously loaded videos.' : 'Try Refresh videos, or open this channel on YouTube.'}`, 'channel-note'));
      else if (entry?.fetched_at) row.append(this.element('p', `Latest available uploads · Checked ${new Date(entry.fetched_at).toLocaleString()}`, 'channel-note'));
      if (!videos.length && !entry?.error && !entry?.loading) row.append(this.element('p', this.filter === 'interests' ? 'No recent videos match your interests. Choose All recent videos to see this channel’s uploads.' : 'This channel has no recent videos in its public feed.', 'channel-note'));
      const strip = this.element('div', '', 'video-strip');
      strip.dataset.channel = channel.channel_id;
      strip.tabIndex = 0;
      strip.setAttribute('aria-label', `${channel.name} videos. Scroll horizontally for more.`);
      const previous = this.button('←', () => strip.scrollBy({ left: -strip.clientWidth * .85, behavior: 'smooth' }), 'icon-btn');
      const next = this.button('→', () => strip.scrollBy({ left: strip.clientWidth * .85, behavior: 'smooth' }), 'icon-btn');
      previous.setAttribute('aria-label', `Previous ${channel.name} videos`); next.setAttribute('aria-label', `More ${channel.name} videos`);
      actions.append(previous, next);
      for (const video of videos.slice(0, 10)) {
        const tile = this.element('article', '', 'video-tile');
        const play = this.button('', () => this.play(video, play), 'video-thumbnail');
        play.setAttribute('aria-label', `Play ${video.title}`);
        const img = document.createElement('img');
        img.src = `https://i.ytimg.com/vi/${this.videoId(video)}/hqdefault.jpg`; img.alt = ''; img.loading = 'lazy'; img.width = 480; img.height = 360;
        img.addEventListener('error', () => { img.hidden = true; }, { once: true });
        play.append(img, this.element('span', '▶', 'play-overlay'));
        const title = this.button(video.title, () => this.play(video, title), 'video-title');
        const meta = this.element('div', '', 'video-meta');
        const date = new Date(video.published);
        meta.append(this.element('span', Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()));
        const existing = Object.values(this.account.favorites).find(item => item.url === video.url || this.videoId(item) === this.videoId(video));
        const favorite = this.button(existing ? '★' : '☆', () => this.account.toggleFavorite(existing?.id || video.id, { ...video, _kind: 'videos' }), 'favorite-btn');
        favorite.disabled = locked; favorite.setAttribute('aria-label', `${existing ? 'Unsave' : 'Save'} ${video.title}`);
        meta.append(favorite); tile.append(play, title, meta); strip.append(tile);
      }
      row.append(strip);
      if (videos.length > 10) {
        const more = this.element('details', '', 'channel-more');
        more.dataset.channel = channel.channel_id;
        more.open = expandedChannels.has(channel.channel_id);
        const summary = this.element('summary', `Show more (${videos.length - 10})`);
        summary.setAttribute('aria-label', `Show more videos from ${channel.name}`);
        more.addEventListener('toggle', () => {
          summary.textContent = more.open ? 'Show less' : `Show more (${videos.length - 10})`;
          summary.setAttribute('aria-label', `${more.open ? 'Show fewer' : 'Show more'} videos from ${channel.name}`);
        });
        const list = this.element('ol', '', 'channel-video-list');
        list.start = 11;
        for (const video of videos.slice(10)) {
          const item = this.element('li', '');
          const title = this.element('a', video.title, 'channel-video-link');
          title.href = `https://www.youtube.com/watch?v=${this.videoId(video)}`;
          title.addEventListener('click', event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            this.play(video, title);
          });
          const date = new Date(video.published);
          item.append(title);
          if (!Number.isNaN(date.getTime())) {
            const time = this.element('time', date.toLocaleDateString());
            time.dateTime = date.toISOString();
            item.append(time);
          }
          list.append(item);
        }
        more.append(summary, list, this.element('p', 'Showing available recent uploads. Visit the channel on YouTube for its full archive.', 'channel-note'));
        row.append(more);
      }
      this.rows.append(row);
      strip.scrollLeft = scrollPositions.get(channel.channel_id) || 0;
    }
  }
}
