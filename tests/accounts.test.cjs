const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RadarAccount } = require('../accounts.js');

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function mockClient() {
  const db = { radar_profiles: [], radar_favorites: [] };
  const client = {
    db, failure: false,
    from(table) {
      let action = 'select', payload, options = {}, filters = [], single = false, range;
      const query = {
        select() { return this; },
        eq(key, value) { filters.push(row => row[key] === value); return this; },
        single() { single = true; return this; },
        order() { return this; },
        range(start, end) { range = [start, end]; return this; },
        update(value) { action = 'update'; payload = value; return this; },
        upsert(value, opts) { action = 'upsert'; payload = value; options = opts; return this; },
        delete() { action = 'delete'; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (client.failure) return { error: new Error('Network unavailable') };
            let rows = db[table].filter(row => filters.every(f => f(row)));
            if (action === 'upsert') {
              const existing = db[table].find(row => row.user_id === payload.user_id &&
                (table === 'radar_profiles' || row.item_id === payload.item_id));
              if (existing && !options.ignoreDuplicates) Object.assign(existing, payload);
              if (!existing) db[table].push({ interests: [], theme: 'light', ...payload });
            } else if (action === 'update') {
              rows.forEach(row => Object.assign(row, payload));
            } else if (action === 'delete') {
              db[table] = db[table].filter(row => !rows.includes(row));
            }
            if (range) rows = rows.slice(range[0], range[1] + 1);
            return { data: structuredClone(single ? rows[0] : rows), error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

async function signedIn(account, id) {
  account.changeUser({ id, user_metadata: { user_name: id } });
  await account.load();
  assert.equal(account.ready, true);
}

test('guest preferences persist, but never become another account’s data', async () => {
  const local = storage();
  const account = new RadarAccount(local);
  await account.saveProfile({ interests: ['llm'], theme: 'dark' });
  await account.toggleFavorite('guest-paper', { id: 'guest-paper', _kind: 'papers' });
  account.client = mockClient();
  await signedIn(account, 'alice');
  assert.deepEqual(account.favorites, {});
  assert.deepEqual(account.profile.interests, []);
  await account.saveProfile({ interests: ['computer-vision'], display_name: 'Alice' });
  await account.toggleFavorite('alice-paper', { id: 'alice-paper', _kind: 'papers' });
  await signedIn(account, 'bob');
  assert.deepEqual(account.favorites, {});
  assert.deepEqual(account.profile.interests, []);
  await signedIn(account, 'alice');
  assert.equal(account.profile.display_name, 'Alice');
  assert.deepEqual(account.profile.interests, ['computer-vision']);
  assert.ok(account.favorites['alice-paper']);
  account.changeUser(null);
  assert.deepEqual(account.profile.interests, ['llm']);
  assert.equal(account.profile.theme, 'dark');
  assert.deepEqual(Object.keys(account.favorites), ['guest-paper']);
});

test('failed saves preserve the last confirmed state and allow retry', async t => {
  t.mock.method(console, 'error', () => {});
  const account = new RadarAccount(storage());
  account.client = mockClient();
  await signedIn(account, 'alice');
  account.client.failure = true;
  assert.equal(await account.saveProfile({ interests: ['llm'] }), false);
  assert.deepEqual(account.profile.interests, []);
  assert.equal(await account.toggleFavorite('p', { id: 'p' }), false);
  assert.deepEqual(account.favorites, {});
  assert.equal(account.busy, false);
  account.client.failure = false;
  assert.equal(await account.toggleFavorite('p', { id: 'p' }), true);
  assert.ok(account.favorites.p);
  assert.equal(await account.toggleFavorite('p', { id: 'p' }), true);
  assert.deepEqual(account.favorites, {});
  assert.deepEqual(account.client.db.radar_favorites, []);
});

test('a save finishing after sign-out cannot overwrite guest data', async () => {
  const account = new RadarAccount(storage());
  account.client = mockClient();
  await signedIn(account, 'alice');
  let finish;
  const operation = account.mutate(() => new Promise(resolve => { finish = resolve; }), () => {
    account.favorites = { private: {} };
  });
  account.changeUser(null);
  finish();
  assert.equal(await operation, false);
  assert.deepEqual(account.favorites, {});
  assert.equal(account.busy, false);
});

test('failed loads block edits until a successful refresh', async t => {
  t.mock.method(console, 'error', () => {});
  const account = new RadarAccount(storage());
  account.client = mockClient();
  account.client.failure = true;
  account.changeUser({ id: 'alice' });
  await account.load();
  assert.equal(account.ready, false);
  assert.equal(await account.saveProfile({ interests: ['llm'] }), false);
  account.client.failure = false;
  await account.load();
  assert.equal(account.ready, true);
});

test('large favorite libraries load all pages', async () => {
  const account = new RadarAccount(storage());
  account.client = mockClient();
  account.client.db.radar_favorites = Array.from({ length: 1003 }, (_, index) => ({
    user_id: 'alice', item_id: `p${index}`, item: { id: `p${index}` },
  }));
  await signedIn(account, 'alice');
  assert.equal(Object.keys(account.favorites).length, 1003);
});

test('profile creation does not reset an existing profile', async () => {
  const account = new RadarAccount(storage());
  account.client = mockClient();
  await signedIn(account, 'alice');
  await account.saveProfile({ display_name: 'Custom name', interests: ['llm'], theme: 'dark' });
  await account.load();
  assert.equal(account.profile.display_name, 'Custom name');
  assert.deepEqual(account.profile.interests, ['llm']);
  assert.equal(account.profile.theme, 'dark');
});

test('unavailable browser storage reports failure without applying a save', async t => {
  t.mock.method(console, 'error', () => {});
  const account = new RadarAccount({ getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } });
  assert.equal(await account.saveProfile({ interests: ['llm'] }), false);
  assert.deepEqual(account.profile.interests, []);
});

test('channel selections persist per account and restore the separate guest selection', async () => {
  const local = storage();
  const account = new RadarAccount(local);
  const guest = [{ channel_id: 'UCbfYPyITQ-7l4upoX8nvctg', name: 'Guest channel' }];
  const alice = [{ channel_id: 'UCYO_jab_esuFRV4b17AJtAw', name: 'Alice channel' }];
  await account.saveProfile({ youtube_channels: guest });
  assert.deepEqual(new RadarAccount(local).profile.youtube_channels, guest);
  account.client = mockClient();
  await signedIn(account, 'alice');
  assert.deepEqual(account.profile.youtube_channels, []);
  await account.saveProfile({ youtube_channels: alice });
  await signedIn(account, 'bob');
  assert.deepEqual(account.profile.youtube_channels, []);
  await signedIn(account, 'alice');
  assert.deepEqual(account.profile.youtube_channels, alice);
  account.changeUser(null);
  assert.deepEqual(account.profile.youtube_channels, guest);
});
