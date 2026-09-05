// Serves Instagram-synced carousel content from Netlify Blobs.
//
// Everything the sync writes lands at /media/... URLs (index.json, images,
// videos, captions) so the frontend reads one source for live content while
// the original static carousels keep working from /carousels/...

import { store } from './_shared/ig-utils.mjs'

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

export default async (req) => {
  const url = new URL(req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/media\//, '')).replace(/\/+$/, '')
  if (!key) return new Response('Not found', { status: 404 })

  const buffer = await store().get(key, { type: 'arrayBuffer' })
  if (buffer === null) return new Response('Not found', { status: 404 })

  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
  const cacheControl = key.endsWith('index.json') ? 'no-store' : 'public, max-age=31536000, immutable'
  return new Response(buffer, { headers: { 'content-type': contentType, 'cache-control': cacheControl } })
}