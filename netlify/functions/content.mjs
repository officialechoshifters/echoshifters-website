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

import { store } from './_shared/ig-utils.mjs'
import { requireSession } from './_shared/clerk-verify.mjs'
import { CAROUSELS_INDEX, ARTICLES } from './_shared/static-content.mjs'

export const config = { path: '/content/*' }

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

// Merged view of static + Instagram carousels, matching what the client's old
// two-fetch merge produced (IG first, deduped by id).
function mergedCarousels(igCarousels) {
  const staticCarousels = Array.isArray(CAROUSELS_INDEX.carousels) ? CAROUSELS_INDEX.carousels : []
  const seen = new Set()
  return [...igCarousels, ...staticCarousels].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

async function readIgIndex() {
  const raw = await store().get('index.json', { type: 'json' }).catch(() => null)
  return raw && Array.isArray(raw.carousels) ? raw.carousels : []
}

function articleEntry(id) {
  // Article ids in the index are bare ids (e.g. "50809" or an IG id); the
  // generated ARTICLES map is keyed the same way (dir minus "article_" prefix).
  if (ARTICLES[id]) return ARTICLES[id]
  // IG entries store the whole blob in the index already, so captions may not
  // exist in the generated map — synthesize from the index entry.
  const ig = (Array.isArray(CAROUSELS_INDEX.carousels) ? CAROUSELS_INDEX.carousels : [])
    .find((c) => String(c.id) === String(id))
  if (ig?.caption_text) return { caption: ig.caption_text, slides: ig.slides || [] }
  return null
}

export default requireSession(async (req) => {
  const url = new URL(req.url)
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '')

  if (path === '/content/carousels/index.json') {
    const igCarousels = await readIgIndex()
    return json({ carousels: mergedCarousels(igCarousels) })
  }

  if (path === '/content/media/index.json') {
    const igCarousels = await readIgIndex()
    return json({ carousels: igCarousels })
  }

  const captionMatch = path.match(/^\/content\/caption\/(.+)$/)
  if (captionMatch) {
    const entry = articleEntry(captionMatch[1])
    if (!entry?.caption) return new Response('Not found', { status: 404 })
    return new Response(entry.caption, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }

  const slidesMatch = path.match(/^\/content\/slides\/(.+)$/)
  if (slidesMatch) {
    const entry = articleEntry(slidesMatch[1])
    if (!entry?.slides) return json({ slides: [] })
    return json({ slides: entry.slides })
  }

  return new Response('Not found', { status: 404 })
})
