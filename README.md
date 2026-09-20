# AI Research Radar

A calm, automatically updated AI/ML dashboard designed to replace low-value scrolling with useful research discovery.

## What it has

- **Papers** — recent papers combined from **arXiv, Hugging Face Daily Papers, Semantic Scholar, and OpenAlex**.
- **Blogs** — posts from curated AI research blogs.
- **Videos** — new uploads from curated technical YouTube channels using public channel feeds.
- **New tab** — newest content stacked newest-first.
- **For You tab** — choose research interests once and the dashboard ranks matching papers, blogs, and videos for you. Interests sync to your account when signed in, or stay in browser `localStorage` as a guest.
- **Preferred tab** — star anything you want to keep. Favorites sync across devices when signed in, or stay in browser `localStorage` as a guest.
- Search and source filtering.
- Multi-source paper deduplication: the same paper found by several services appears only once.
- Hugging Face upvotes and scholarly citation counts are shown when available and used only as small ranking tie-breakers.
- Light/dark mode, saved per account or guest browser.
- Optional GitHub sign-in, editable display names, and private account storage through Supabase.
- No database and no paid API key required for the default setup.
- GitHub Action refreshes the feed every 4 hours.
- GitHub Pages deployment workflow included.

## Paper sources

### arXiv
Provides the broad newest-first stream from selected AI/ML categories.

### Hugging Face Daily Papers
Adds community-curated/trending AI papers. The fetcher uses Hugging Face's official Daily Papers interface with `sort=trending`.

### Semantic Scholar
Adds recent Computer Science papers discovered through its Academic Graph bulk search. Most public API endpoints work without authentication, although a free API key can make access more reliable.

### OpenAlex
Adds another independent scholarly discovery index and citation metadata. The default number of calls is small enough for casual keyless use. A free key is optional.

When two or more sources refer to the same paper, AI Research Radar merges them by arXiv ID, DOI, or normalized title. The card can therefore show something like:

```text
Hugging Face Papers · arXiv · Semantic Scholar
```

instead of three duplicate cards.

## Architecture

```text
arXiv API ───────────────────┐
Hugging Face Daily Papers ───┤
Semantic Scholar ─────────────┤
OpenAlex ─────────────────────┼─> dedupe/merge ─┐
AI/ML RSS feeds ──────────────┤                 ├─> data/feed.json -> GitHub Pages
YouTube channel feeds ────────┘                 │
                                                └─ GitHub Action every 4 hours
```

The fetch happens in GitHub Actions instead of in the browser. This avoids CORS problems and keeps the website fast.

## Install on Android

After publishing, open the site in Chrome on Android and choose **⋮ → Add to
Home screen → Install**. An **Install app** button also appears on the site when
Chrome offers installation. The installed app opens in its own window and uses
the same GitHub Pages site and Supabase backend. No Android Studio or APK is
required. Sign-in, refreshing content, and video playback require internet;
this version does not add offline caching. If Chrome only offers a shortcut,
reload the published site and check that `manifest.webmanifest` and the PNG
files under `icons/` are deployed. Local changes do not reach your phone until
the GitHub Pages deployment succeeds.

## Run locally

From the project folder, create and activate the Conda environment:

```bash
conda env create -f environment.yml
conda activate ai-research-radar
python scripts/fetch_content.py
python -m http.server 8000
```

Then open `http://localhost:8000`.

`environment.yml` uses Python 3.12, matching GitHub Actions, and installs the
Python packages from `requirements.txt` using pip inside the Conda environment.
The frontend is plain HTML, CSS, and JavaScript; no Node.js build is needed.
Fetching content requires internet access and rewrites `data/feed.json`. You can
skip the fetch command to preview the existing feed.

For later sessions, run `conda activate ai-research-radar` before starting the
server. Stop the server with `Ctrl+C` and leave the environment with
`conda deactivate`.

After dependency changes, update the environment from the project folder:

```bash
conda env update -f environment.yml --prune
```

If your terminal does not recognize `conda activate`, run `conda init` for your
shell (for example, `conda init zsh` on macOS), then restart the terminal.
On Windows, you can use an Anaconda Prompt or Miniconda Prompt.

## Put it on GitHub

Create an empty repository on GitHub, then from this folder:

```bash
git init
git add .
git commit -m "Initial AI Research Radar"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ai-research-radar.git
git push -u origin main
```

### Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open **Actions** and manually run **Update AI Research Feed** once.
5. The **Deploy to GitHub Pages** workflow publishes the site.

After that, content refreshes automatically every 4 hours.

## Enable personal accounts on GitHub Pages

Your website stays at `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.
Supabase provides authentication and private storage; GitHub Pages continues to
serve the dashboard. No custom domain or Python web server is needed.
Without configuration, the site works in guest mode and sign-in is disabled.

### 1. Create the Supabase database

Create a project at [Supabase](https://supabase.com/dashboard). In its **SQL Editor**,
run [`supabase/schema.sql`](supabase/schema.sql) once. This creates profiles and
favorites with row-level security: authenticated users can read and change only
rows whose `user_id` matches their own account. Anonymous users have no access.
Use a fresh project or inspect existing tables first; this script deliberately
fails if these tables already exist instead of changing existing data.

### 2. Connect GitHub sign-in

1. In Supabase, open **Authentication → Sign In / Providers → GitHub** and copy
   the callback URL, typically `https://PROJECT_REF.supabase.co/auth/v1/callback`.
2. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
3. Set **Homepage URL** to your full GitHub Pages URL, including the repository
   path and trailing slash.
4. Set **Authorization callback URL** to the Supabase callback from step 1.
   This is different from the dashboard URL.
5. Generate a client secret. Enter the GitHub Client ID and secret in Supabase’s
   GitHub provider settings, enable the provider, and save.
6. Under Supabase **Authentication → URL Configuration**, set **Site URL** to
   your GitHub Pages URL. Add these exact **Redirect URLs**:

   ```text
   https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/
   https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/index.html
   http://localhost:8000/
   http://localhost:8000/index.html
   ```

   If you use another local hostname or port, add its exact URL too. Use the same
   browser tab to complete sign-in; the app uses the PKCE authentication flow.

Users authenticate on GitHub and return to the dashboard. Their first sign-in
creates a profile automatically; this site never asks for their GitHub password.
See [Supabase’s GitHub sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-github)
and [GitHub Pages usage limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

### 3. Configure and publish the dashboard

Find the Supabase **Project URL** and **publishable key** in the project’s
connection/API settings. Put only these public values in [`config.js`](config.js):

```javascript
window.RADAR_CONFIG = {
  supabaseUrl: 'https://PROJECT_REF.supabase.co',
  supabasePublishableKey: 'sb_publishable_YOUR_PUBLIC_KEY',
};
```

A legacy `anon` key also works. Never put a Supabase secret/service-role key,
GitHub client secret, access token, or password in this file or your repository.
The browser key is public by design; the database policies enforce privacy.

Commit and push the changed site files to your GitHub repository. The existing
Pages workflow publishes them. Supabase configuration requires no changes to the
Conda environment or the Python feed updater. The browser loads the pinned
Supabase JavaScript client from esm.sh only when accounts are configured.

### Account behavior

- The account menu lets users change their display name, refresh saved data, and sign out.
- Interests, full favorite snapshots, and theme are saved to the signed-in account.
- Guest preferences remain separate and are restored after sign-out.
- Saves take effect after storage confirms success. Failed saves show a message
  and can be retried; a failed account load disables changes until refresh succeeds.
- Other open tabs/devices load the latest settings on page reload or **Refresh
  account**. This version does not provide live updates between devices. For
  concurrent edits to the same preference, the last successful save wins.
- Signing out ends the session in the current browser; other devices stay signed in.
- The public feed remains public. Profiles and favorites are private to the user
  through database access rules; the Supabase project administrator can administer them.

### Verify your setup

1. Serve the site locally and sign in. Set your name, interests, theme, and a favorite.
2. Reload and verify that all four are retained.
3. Sign in to the same account in another browser and verify that the data loads.
4. Sign in with a different GitHub account in a separate browser profile. It should
   start with its own empty library and default preferences.
5. Sign out and confirm that the guest library returns.
6. In Supabase, verify that RLS is enabled on both `radar_profiles` and
   `radar_favorites`. Test cross-user read/write requests with each user’s own
   session: reads for another user must return no rows and writes must be denied.
   Do not use a service-role key for this check because it bypasses RLS.

Account regression tests run with Node.js (only needed for development checks):

```bash
node --test tests/accounts.test.cjs
```

If sign-in is rejected, check both callback URLs and that the GitHub provider is
enabled. If sign-in succeeds but the profile cannot load, check that the schema
was installed, the public key belongs to the same project, and RLS policies exist.
If login was canceled, retry **Sign in with GitHub**.

## Customize the paper sources

Edit `paper_sources` in `sources.json`.

```json
{
  "paper_sources": {
    "arxiv": {
      "enabled": true,
      "limit": 180,
      "categories": ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "stat.ML"]
    },
    "huggingface": {
      "enabled": true,
      "limit": 70,
      "sort": "trending"
    },
    "semantic_scholar": {
      "enabled": true,
      "limit": 80,
      "days_back": 30,
      "query": "(\"machine learning\" | \"large language model\" | multimodal)"
    },
    "openalex": {
      "enabled": true,
      "days_back": 30,
      "per_query": 20,
      "queries": ["machine learning", "large language model", "computer vision"]
    }
  }
}
```

Set any source's `enabled` value to `false` if you do not want it.

### Optional free API keys

The site works without these by default. If you later want more reliable/higher-volume scholarly API access, add repository **Actions secrets**:

```text
SEMANTIC_SCHOLAR_API_KEY
OPENALEX_API_KEY
```

Then expose them to the fetch step in `.github/workflows/update-content.yml` if you choose to use them. Do **not** put API keys directly in `sources.json` or commit them to GitHub.

## Customize blogs and videos

Edit `sources.json`.

### Add/remove blog feeds

```json
{"name": "Example AI Lab", "feed": "https://example.com/rss.xml"}
```

### Add/remove YouTube channels

Every followed channel shows its 10 newest available videos in a horizontal row.
When more videos are available, **Show more** expands a dated title list of the
remaining uploads, also newest first. Click a thumbnail or title to play inside
the website. **Show less** collapses the list. The public feed provides recent
uploads, not the channel's full history; use the channel's YouTube link for that.

The **My Channels** view uses the `youtube-channel` Supabase Edge Function for
live uploads and custom channel lookup. GitHub Pages deployment does not deploy
this function. From the repository folder, deploy it to your configured project:

```bash
npx supabase login
npx supabase functions deploy youtube-channel --project-ref YOUR_PROJECT_REF
```

The included `supabase/config.toml` sets `verify_jwt = false` for this public
metadata endpoint so guests can use it too. The function has no database access.
See [Supabase's deployment guide](https://supabase.com/docs/guides/functions/deploy).
After deployment, click **Refresh videos**. A `404` response with
`Requested function was not found` means the function is missing from that project.

Without live lookup, suggested channels use `data/feed.json`'s `channel_videos`
fallback. Run the content updater and publish the updated feed to refresh it.
The updater keeps each channel's uploads there before applying the 60-video limit
to the main feed, so less frequent uploaders remain available in **My Channels**.
For existing account databases, also run
[`supabase/migrations/20260911_youtube_channels.sql`](supabase/migrations/20260911_youtube_channels.sql)
in the Supabase SQL Editor to enable saving followed channels.

To change the channels collected by the content updater, edit `sources.json`:

```json
{"name": "Channel name", "channel_id": "UC..."}
```

YouTube exposes a public Atom feed at:

```text
https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
```

## Fetch fresh content on demand

**Refresh papers** and **Refresh blogs** query their configured upstream sources
through the `refresh-feed` Supabase Edge Function. **My Channels → Refresh videos**
uses `youtube-channel` for followed channels. These work on localhost and
GitHub Pages after deploying both functions from this project folder:

```bash
npx supabase login
npx supabase functions deploy refresh-feed --project-ref ohshnznoyvqtomioqqum
npx supabase functions deploy youtube-channel --project-ref ohshnznoyvqtomioqqum
```

Use your own project reference if you change `config.js`. No new SQL is required.
If needed, set `OPENALEX_API_KEY` and `SEMANTIC_SCHOLAR_API_KEY` in Supabase's
Edge Function secrets; GitHub Actions secrets are separate. Never put these
source keys in browser configuration.

The paper collector queries arXiv, Hugging Face, Semantic Scholar, and OpenAlex;
the blog collector reads the RSS/Atom URLs in `sources.json`. Redeploy
`refresh-feed` after changing that configuration. Fresh items are merged into
the displayed category and sorted newest first. Existing items remain when
sources fail, with a partial-failure message. Invalid dates and dates more than
one day in the future are excluded from refreshed results.

Repeated requests can reuse results for 60 seconds within a warm function worker.
This is best-effort caching, not a distributed rate limit. The browser keeps
manual refresh results in memory; reloading starts from `data/feed.json` again.
The existing scheduled Python updater continues to maintain that saved feed.

## Personalized interests / For You

Open **Manage interests** in the website and choose topics such as LLMs, Computer Vision, Probabilistic AI, Knowledge Graphs, Multimodal Learning, AI Safety, Robotics, Reinforcement Learning, and more.

The **For You** tab scores each fetched item against your selected categories using its title, summary, source, tags, and authors. Strong title matches rank above weaker description matches. Recent items receive a small boost; Hugging Face upvotes and citation counts provide only small tie-breaking quality signals. Signed-in choices are saved to your Supabase profile. Guest choices stay in browser `localStorage`. Items must match at least one selected topic to appear in For You.

Edit `interest_keywords` in `sources.json` if you also want to change the general keywords used to tag fetched content.

## Important note about Preferred items

Preferred/starred items are stored as full item snapshots, so they remain in your Preferred library even after they fall out of the rolling newest feed. Signed-in favorites are saved in Supabase and loaded on other devices when you sign in or refresh the account. Guest favorites stay in that browser. Guest and account libraries are separate: signing in does not upload a shared browser’s existing favorites or interests. Signing out restores the guest library.

## Source reliability

The fetcher is intentionally fault-tolerant. If Hugging Face, Semantic Scholar, OpenAlex, arXiv, an RSS feed, or a YouTube feed temporarily fails, the other sources still update. Failed source names appear in the GitHub Action log.

## License

Use and modify this project freely for your personal research dashboard.
