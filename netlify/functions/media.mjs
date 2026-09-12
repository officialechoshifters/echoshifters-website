// Serves Instagram-synced carousel content from Netlify Blobs.
//
// Everything the sync writes lands at /media/... URLs (index.json, images,
// videos, captions) so the frontend reads one source for live content while
// the original static carousels keep working from /carousels/...
//
// Members-only gate: text content (index.json, captions) requires a verified
// Clerk session. Media files (images/videos) stay public — without the text
// they reveal nothing, and keeping them on the CDN keeps image caching fast.

import { store } from './_shared/ig-utils.mjs'
import { requireSession } from './_shared/clerk-verify.mjs'

export const config = { path: '/media/*' }

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

async function serve(req, key) {
  const buffer = await store().get(key, { type: 'arrayBuffer' })
  if (buffer === null) return new Response('Not found', { status: 404 })

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
  const cacheControl = key.endsWith('index.json') ? 'no-store' : 'public, max-age=31536000, immutable'
  return new Response(buffer, { headers: { 'content-type': contentType, 'cache-control': cacheControl } })
}

// Text content is members-only; binary media stays public.
export default async (req) => {
  const url = new URL(req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/media\//, '')).replace(/\/+$/, '')
  if (!key) return new Response('Not found', { status: 404 })

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  const isText = ext === '.json' || ext === '.txt'

  if (!isText) return serve(req, key)

  return requireSession(async () => serve(req, key))(req)
}