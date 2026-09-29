// Members-only content endpoint: /content/*
//
// Serves the journal's text content (carousel index, captions, slide scripts)
// ONLY to visitors with a verified Clerk session. This is the server-side half
// of the members-only gate — the client-side gate alone never protected the
// underlying JSON, which anyone could fetch directly.
//
// Routes:
//   /content/carousels/index.json  → merged static + Instagram carousel index
//   /content/media/index.json      → Instagram-synced carousel index (live)
//   /content/caption/<article-id>  → caption text for one article
//   /content/slides/<article-id>   → slide text (the "script") for one article
//
// Images/videos stay public under /carousels/... and /media/... on purpose:
// a slide image without its text reveals nothing and keeps CDN caching simple.
//
// Note on what "index" means here: the static index ships with the site and
// is served from the generated module, so the live Netlify Blobs index (used
// by /media/*) is the only part that needs reading at request time.

import { store, readDeletedMediaIds } from './_shared/ig-utils.mjs'
import { requireSession } from './_shared/clerk-verify.mjs'
import { CAROUSELS_INDEX, ARTICLES } from './_shared/static-content.mjs'

export const config = { path: '/content/*' }

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

// Merged view of static + Instagram carousels, matching what the client's old
// two-fetch merge produced (IG first, deduped by id).
//
// Deletion-aware: static entries that were posted to Instagram carry
// `post.media_id`. The IG index (Blobs) is a mirror of what is currently on
// Instagram — the sync prunes deleted posts — so a static entry whose
// media_id is missing from it was deleted on Instagram and is hidden here.
// Entries never posted to Instagram are unaffected.
function mergedCarousels(igCarousels, deletedMediaIds) {
  const staticCarousels = Array.isArray(CAROUSELS_INDEX.carousels) ? CAROUSELS_INDEX.carousels : []
  // An empty IG index (fresh store, sync not run yet) proves nothing about
  // deletions — skip the filter so the feed can never wipe itself out.
  const liveIds = igCarousels.length ? new Set(igCarousels.map((c) => String(c.id))) : null
  const tombstones = new Set(deletedMediaIds)
  // A static copy linked to an Instagram post (post.media_id) is hidden when:
  //   - the post was deleted on Instagram (recorded as a tombstone), or
  //   - the sync's own mirror entry exists — it is the canonical copy and
  //     showing both would duplicate the article.
  // Otherwise the static copy shows: that covers posts live on Instagram that
  // have not synced yet (e.g. a download failed) and mirror-empty guard state.
  const visibleStatic = staticCarousels.filter((c) => {
    const mediaId = c.post?.media_id ? String(c.post.media_id) : null
    if (!mediaId) return true
    return !tombstones.has(mediaId) && !(liveIds && liveIds.has(mediaId))
  })
  const seen = new Set()
  return [...igCarousels, ...visibleStatic].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

async function readIgIndex() {
  const raw = await store().get('index.json', { type: 'json' }).catch(() => null)
  return raw && Array.isArray(raw.carousels) ? raw.carousels : []
}

function articleEntry(id, igCarousels, deletedMediaIds = []) {
  const indexEntry = (Array.isArray(CAROUSELS_INDEX.carousels) ? CAROUSELS_INDEX.carousels : [])
    .find((c) => String(c.id) === String(id))
  // Same visibility rule as the merged feed (see mergedCarousels): hide the
  // static copy when the post is tombstoned as deleted or the canonical
  // mirror entry exists; show it otherwise (unsynced-but-live posts included).
  const mediaId = indexEntry?.post?.media_id ? String(indexEntry.post.media_id) : null
  if (mediaId) {
    if (deletedMediaIds.includes(mediaId)) return null
    if (igCarousels.some((c) => String(c.id) === mediaId)) return null
  }
  // Article ids in the index are bare ids (e.g. "50809" or an IG id); the
  // generated ARTICLES map is keyed the same way (dir minus "article_" prefix).
  if (ARTICLES[id]) return ARTICLES[id]
  // IG entries store the whole blob in the index already, so captions may not
  // exist in the generated map — synthesize from the index entry.
  if (indexEntry?.caption_text) return { caption: indexEntry.caption_text, slides: indexEntry.slides || [] }
  return null
}

export default requireSession(async (req) => {
  const url = new URL(req.url)
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '')

  if (path === '/content/carousels/index.json') {
    const igCarousels = await readIgIndex()
    return json({ carousels: mergedCarousels(igCarousels, await readDeletedMediaIds()) })
  }

  if (path === '/content/media/index.json') {
    const igCarousels = await readIgIndex()
    return json({ carousels: igCarousels })
  }

  const deletedMediaIds = await readDeletedMediaIds()
  const captionMatch = path.match(/^\/content\/caption\/(.+)$/)
  if (captionMatch) {
    const entry = articleEntry(captionMatch[1], await readIgIndex(), deletedMediaIds)
    if (!entry?.caption) return new Response('Not found', { status: 404 })
    return new Response(entry.caption, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }

  const slidesMatch = path.match(/^\/content\/slides\/(.+)$/)
  if (slidesMatch) {
    const entry = articleEntry(slidesMatch[1], await readIgIndex(), deletedMediaIds)
    if (!entry?.slides) return json({ slides: [] })
    return json({ slides: entry.slides })
  }

  return new Response('Not found', { status: 404 })
})
