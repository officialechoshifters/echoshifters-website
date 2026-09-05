# NIGGHTERS — automatic Instagram publishing

Every new Instagram post is pulled into the website automatically. You post on
Instagram, and within ~5 minutes the post (images, video, caption) is live on
the site as a new carousel. The project is under git so every change has
history and can be rolled back.

## How it works

```
You post on Instagram
        │
        ▼
ig-sync (Netlify Scheduled Function, every 5 min)
  └─ asks Instagram's Graph API "any new posts?"
        │
        ▼
downloads the new post's images/video + caption
  └─ stores them in Netlify Blobs
        │
        ▼
media (Netlify Function) serves them at /media/…
  └─ the site's feed merges them with the existing carousels
        │
        ▼
live in seconds on nigghters.com
```

- **`netlify/functions/ig-sync.mjs`** — runs every 5 minutes, fetches your
  latest 25 posts, downloads anything new into Netlify Blobs, and appends it to
  the live index. Can also be triggered manually (see below).
- **`netlify/functions/media.mjs`** — serves the blob-stored content to the
  browser at `/media/*` (images, videos, captions, `index.json`).
- **`netlify/functions/ig-token-refresh.mjs`** — runs daily and rolls your
  Instagram access token forward so the integration never silently dies after
  60 days.
- **`src/main.js`** — the feed now loads `/carousels/index.json` (existing
  static carousels) **and** `/media/index.json` (Instagram carousels) and merges
  them, newest first. Open tabs poll `/media/index.json` every 60 s and refresh
  the feed when a new post lands (without interrupting anyone mid-story).

> Why 5 minutes? Instagram's official API has **no webhook for "a new post was
> created"** — Meta removed that event. Polling every 5 minutes is the fastest
> fully-automatic option the API allows.

## One-time setup

You need an **Instagram Business or Creator account** linked to a **Facebook
Page**. Personal accounts can't be read by the API at all.

### 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com) → *My Apps*
   → *Create App* → use case **Other** → type **Business**.
2. Add the **Instagram Graph API** product.
3. Under *Instagram → API Setup*, link the Facebook Page that your Instagram
   account is connected to, then add your Instagram account.
4. In *App Review → Permissions and Features*, request access to:
   - `instagram_business_basic`
   - `pages_show_list`
   - `pages_read_engagement`
   For your own account these are granted without review (Standard Access).
5. Copy the **App ID** and **App Secret** from *App settings → Basic*.

### 2. Get a long-lived access token (60 days)

Generate a short-lived token in the app dashboard
(*Instagram → API Setup → Generate Token*), then exchange it:

```bash
curl "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=<APP_SECRET>&access_token=<SHORT_LIVED_TOKEN>"
```

The `access_token` in the response is your long-lived token. Find your
Instagram account ID with:

```bash
curl "https://graph.instagram.com/me?fields=user_id,username&access_token=<LONG_LIVED_TOKEN>"
```

(`user_id` is your `IG_USER_ID`.)

### 3. Set environment variables on Netlify

Netlify Dashboard → your site → *Project configuration → Environment variables*:

| Variable | Value |
| --- | --- |
| `IG_USER_ID` | your Instagram account ID (the `user_id` from step 2) |
| `IG_ACCESS_TOKEN` | the long-lived token from step 2 |
| `IG_SYNC_TOKEN` | any random string you invent (protects manual sync calls) |

No app secret is needed: Instagram's `ig_refresh_token` endpoint refreshes the
long-lived token using only the token itself, so the daily refresh function
keeps it alive without `IG_APP_SECRET`.

### 4. Connect git → Netlify (recommended)

The repo is already initialized on the `main` branch and `netlify.toml` is
CI-ready. Two steps remain, and both need your credentials:

```bash
# 1) Create a GitHub repo, then point this local repo at it:
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main

# 2) Connect Netlify to the GitHub repo:
#    Netlify Dashboard → Add new site → Import an existing project → GitHub
#    → pick the repo → build command `npm run build`, publish dir `dist`.
```

From then on **every `git push` deploys automatically** (works even when your
laptop is off), and Netlify keeps a deploy history you can roll back to.

### 5. Deploy locally (faster, without git)

Install the Netlify CLI and push `dist/` + the functions directly:

```bash
npm install -g netlify-cli
netlify login
netlify init          # links this folder to your existing Netlify site
npm run deploy        # builds + pushes dist/ and the functions to production
npm run deploy:watch  # re-deploys on every save (Ctrl+C to stop)
```

> Note: the Netlify Functions live in this repo (under `netlify/functions/`) and
> are committed and deployed like any other file, but the *data* they manage —
> the Instagram posts and media in Netlify Blobs — lives on Netlify, not in git.

### 6. Backfill your recent posts

Trigger a sync immediately (also useful for testing before waiting 5 minutes):

```bash
curl -X POST "https://<your-site>.netlify.app/.netlify/functions/ig-sync-manual?token=<IG_SYNC_TOKEN>"
```

The response reports how many posts were imported. Your last 25 posts become
carousels right away; every new post after that lands within 5 minutes.
Check the live index at `https://<your-site>.netlify.app/media/index.json`.

(The scheduled `ig-sync` function itself can't be called via URL — use
`ig-sync-manual` for on-demand runs, or the *Run now* button on the Netlify
Functions page.)

## Notes & limits

- **Very old posts may be skipped.** Instagram's `media_url` (the download link)
  expires; posts whose images can no longer be fetched are skipped gracefully.
- **Hashtags become topics.** A caption containing `#AI` is filed under the AI
  topic on the site. Only these topics are recognized: `#ai`, `#arts`,
  `#business`, `#culture`, `#economy`, `#finance`, `#health`, `#lifestyle`,
  `#markets`, `#politics`, `#science`, `#sports`, `#technology`,
  `#environment`.
- **Reels and carousel posts work.** A carousel album becomes a multi-slide
  story; a video/reel becomes a slide with an inline player.
- **Code changes can also deploy themselves.** Run `npm run deploy:watch` and
  leave the terminal open — the moment you save a file in `src/`, `public/`,
  `netlify/`, or `index.html`, it waits 3 seconds (in case you're still
  editing) and runs the deploy automatically. `node watch-deploy.mjs --dry-run`
  shows what would deploy without sending anything. The watcher only runs while
  it's open; the recommended long-term setup is git → GitHub → Netlify
  continuous deployment above, which deploys even when your laptop is off.
- **Working with git.** Secrets (`.ig-sync-token`, `.netlify-token`, `.env.*`)
  and build output (`dist/`, `node_modules/`) are git-ignored, so you can commit
  freely without ever leaking tokens. Make a change, then `git add -A && git
  commit` and `git push` to trigger a deploy. To change the commit identity,
  run `git config user.name` / `git config user.email` in this folder (stored
  locally, not globally).
- **Local development:** `netlify dev` serves the site and the functions
  locally so you can test the sync against your real Instagram account.