/* Account data is kept in memory; only guest preferences use our localStorage keys.
 * Supabase stores its session separately and enforces ownership with database RLS.
 */
class RadarAccount {
  constructor(storage) {
    this.storage = storage;
    this.client = null;
    this.user = null;
    this.ready = true;
    this.busy = false;
    this.generation = 0;
    this.message = '';
    this.onChange = () => {};
    this.restoreGuest();
  }

  read(key, fallback) {
    try { return JSON.parse(this.storage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  restoreGuest() {
    const favorites = this.read('ai-radar-favorites', {});
    this.favorites = favorites && !Array.isArray(favorites) && typeof favorites === 'object'
      ? Object.fromEntries(Object.entries(favorites).filter(([, item]) => item && typeof item === 'object')) : {};
    const interests = this.read('ai-radar-interests', []);
    let theme = 'light';
    try { theme = this.storage.getItem('ai-radar-theme') === 'dark' ? 'dark' : 'light'; } catch {}
    const channels = this.read('ai-radar-youtube-channels', []);
    this.profile = { display_name: '', interests: Array.isArray(interests) ? interests : [], theme, youtube_channels: Array.isArray(channels) ? channels : [] };
  }

  emit(message = this.message) {
    this.message = message;
    this.onChange();
  }

  async init(config, createClient) {
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) return;
    this.ready = false;
    this.emit('Connecting to your account…');
    try {
      this.client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
      });
      // Do not await database work inside Supabase's auth callback.
      this.client.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT' || session?.user?.id !== this.user?.id) {
          this.changeUser(session?.user || null);
        }
      });
      const { error } = await this.client.auth.getSession();
      if (error) throw error;
    } catch (error) {
      this.ready = false;
      this.emit('Account connection failed. Reload the page to try again.');
      console.error('Account initialization failed', error);
    }
  }

  changeUser(user) {
    const generation = ++this.generation;
    this.user = user;
    this.busy = false;
    this.ready = !user;
    // Clear the previous account immediately, before any asynchronous work.
    this.favorites = {};
    this.profile = { display_name: '', interests: [], theme: 'light', youtube_channels: [] };
    if (!user) this.restoreGuest();
    this.emit(user ? 'Loading your profile…' : 'Guest mode · Saved in this browser');
    if (user) setTimeout(() => this.load(generation), 0);
  }

  async load(generation = this.generation) {
    if (!this.user || this.busy || generation !== this.generation) return;
    generation = ++this.generation;
    const user = this.user;
    this.ready = false;
    this.emit('Loading your profile…');
    try {
      const created = await this.client.from('radar_profiles').upsert({
        user_id: user.id,
        display_name: String(user.user_metadata?.user_name || user.user_metadata?.name || '').slice(0, 80),
      }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (created.error) throw created.error;
      const profile = await this.client.from('radar_profiles').select('*')
        .eq('user_id', user.id).single();
      if (profile.error) throw profile.error;
      const favorites = {};
      // PostgREST limits rows per request; page so large libraries are not truncated.
      for (let offset = 0; ; offset += 500) {
        const page = await this.client.from('radar_favorites').select('item_id,item')
          .eq('user_id', user.id).order('item_id').range(offset, offset + 499);
        if (page.error) throw page.error;
        for (const row of page.data) favorites[row.item_id] = row.item;
        if (page.data.length < 500) break;
        if (generation !== this.generation) return;
      }
      if (generation !== this.generation) return;
      this.profile = { ...profile.data, youtube_channels: profile.data.youtube_channels || [] };
      this.favorites = favorites;
      this.ready = true;
      this.emit('Your account is up to date');
    } catch (error) {
      if (generation !== this.generation) return;
      this.emit('Could not load your account. Check your connection and choose Refresh account.');
      console.error('Account load failed', error);
    }
  }

  async mutate(operation, apply) {
    if (!this.ready || this.busy) return false;
    const generation = this.generation;
    this.busy = true;
    this.emit('Saving…');
    try {
      await operation();
      if (generation !== this.generation) return false;
      apply();
      this.emit(this.user ? 'Saved to your account' : 'Saved in this browser');
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.emit('Could not save. Your changes were not applied here; check your connection and try again.');
        console.error('Account save failed', error);
      }
      return false;
    } finally {
      if (generation === this.generation) { this.busy = false; this.emit(); }
    }
  }

  async saveProfile(patch) {
    const user = this.user;
    const profile = { ...this.profile, ...patch };
    return this.mutate(async () => {
      if (user) {
        const result = await this.client.from('radar_profiles').update(patch)
          .eq('user_id', user.id).select('user_id').single();
        if (result.error) throw result.error;
      } else {
        if ('interests' in patch) this.storage.setItem('ai-radar-interests', JSON.stringify(profile.interests));
        if ('youtube_channels' in patch) this.storage.setItem('ai-radar-youtube-channels', JSON.stringify(profile.youtube_channels));
        if ('theme' in patch) this.storage.setItem('ai-radar-theme', profile.theme);
      }
    }, () => { this.profile = profile; });
  }

  async toggleFavorite(id, item) {
    const user = this.user;
    const removing = Object.hasOwn(this.favorites, id);
    const favorites = { ...this.favorites };
    if (removing) delete favorites[id];
    else favorites[id] = item;
    return this.mutate(async () => {
      if (user) {
        const table = this.client.from('radar_favorites');
        const result = removing
          ? await table.delete().eq('user_id', user.id).eq('item_id', id)
          : await table.upsert({ user_id: user.id, item_id: id, item }, { onConflict: 'user_id,item_id' });
        if (result.error) throw result.error;
      } else this.storage.setItem('ai-radar-favorites', JSON.stringify(favorites));
    }, () => { this.favorites = favorites; });
  }

  async signIn() {
    if (!this.client) return;
    const redirect = new URL(window.location.href);
    redirect.search = '';
    redirect.hash = '';
    const { error } = await this.client.auth.signInWithOAuth({
      provider: 'github', options: { redirectTo: redirect.href },
    });
    if (error) this.emit('Sign-in failed. Please try again.');
  }

  async signOut() {
    if (!this.client || this.busy) return;
    const { error } = await this.client.auth.signOut({ scope: 'local' });
    if (error) this.emit('Could not sign out. Check your connection and try again.');
  }
}

if (typeof module !== 'undefined') module.exports = { RadarAccount };
