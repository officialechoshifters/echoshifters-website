// Shared helpers for the Instagram -> Netlify Blobs pipeline.
// netlify/functions/_shared/ files are bundled into the functions that import them.

import { getStore } from '@netlify/blobs'

export const CAROUSEL_STORE = 'echoshifters-carousels'
export const BLOB_PREFIX = '/media/'

export function store() {
  return getStore(CAROUSEL_STORE)
}

// The access token lives in a blob so the scheduled refresh function can renew
// it. Falls back to the IG_ACCESS_TOKEN environment variable on first run.
//
// A token is only valid for the account that issued it. To survive an account
// switch, the blob entry records which account it belongs to and is only used
// for that account — otherwise the sync would keep failing with "missing
// permissions" on every post. Entries with no account (written before tagging
// existed) are trusted only when no env token is configured, since the env var
// is then the deliberate source of truth.
export async function getIgToken() {
  const s = store()
  const entry = await s.get('config/ig-token', { type: 'json' }).catch(() => null)
  if (entry && entry.token) {
    const currentAccount = env('IG_USER_ID')
    if (!currentAccount) return entry.token
    if (!entry.account) return process.env.IG_ACCESS_TOKEN || entry.token
    if (String(entry.account) === String(currentAccount)) return entry.token
  }
  return process.env.IG_ACCESS_TOKEN || ''
}

export async function setIgToken(token) {
  await store().setJSON('config/ig-token', { token, account: env('IG_USER_ID'), refreshedAt: new Date().toISOString() })
}

export function env(key) {
  return process.env[key] || ''
}

// The index blob lists every carousel pulled from Instagram, newest first.
export async function readIndex() {
  const raw = await store().get('index.json', { type: 'json' }).catch(() => null)
  return raw && Array.isArray(raw.carousels) ? raw.carousels : []
}

export async function writeIndex(carousels) {
  await store().setJSON('index.json', { generated_from: 'instagram-graph-api', carousels })
}

// Tombstones: media ids that were once synced and later deleted on Instagram.
// The /content/* function uses them to hide static copies of deleted posts
// (static entries carry `post.media_id` but cannot be edited by the sync).
const TOMBSTONES_KEY = 'config/deleted-media-ids'
const TOMBSTONES_CAP = 1000

export async function readDeletedMediaIds() {
  const raw = await store().get(TOMBSTONES_KEY, { type: 'json' }).catch(() => null)
  return raw && Array.isArray(raw.ids) ? raw.ids : []
}

export async function addDeletedMediaIds(ids) {
  if (!ids.length) return
  const s = store()
  const merged = [...new Set([...(await readDeletedMediaIds()), ...ids.map(String)])]
  // Newest deletions matter most; cap the list so it cannot grow forever.
  await s.setJSON(TOMBSTONES_KEY, { ids: merged.slice(-TOMBSTONES_CAP) })
}

const TOPIC_CATALOG = ['AI', 'Business', 'Culture', 'Finance', 'Health', 'Lifestyle', 'Politics', 'Science', 'Sports', 'Technology', 'Environment']

// Pre-merge labels still seen on older captions resolve to the topic that
// absorbed them (ARTS -> CULTURE, ECONOMY -> BUSINESS, MARKETS -> FINANCE).
const TOPIC_ALIASES = { arts: 'Culture', economy: 'Business', markets: 'Finance' }

// Pulls topics from Instagram hashtags (e.g. "#AI #Markets") and the
// category heading used by our posts (e.g. "AI & BUSINESS:").
export function topicsFromCaption(caption) {
  const text = String(caption || '')
  const hashtags = text.match(/#[\w-]+/g) || []
  const tags = hashtags.map((t) => t.slice(1).toLowerCase())
  const heading = text.split(/\r?\n/, 1)[0].match(/^\s*([^:]+):\s*$/)?.[1] || ''
  const headingTopics = heading.split(/[&,/]+/).map((name) => name.trim().toLowerCase()).filter(Boolean)
  const topics = []
  for (const candidate of [...headingTopics, ...tags]) {
    const match = TOPIC_CATALOG.find((name) => name.toLowerCase() === candidate)
    const merged = match || TOPIC_ALIASES[candidate]
    if (merged && !topics.includes(merged)) topics.push(merged)
  }
  return { topics, tags }
}

const EXT_BY_MEDIA_TYPE = { IMAGE: 'jpg', VIDEO: 'mp4' }

export function mediaKey(mediaId, slideIndex, mediaType) {
  return `carousels/article_IG_${mediaId}/slide_${slideIndex}.${EXT_BY_MEDIA_TYPE[mediaType] || 'bin'}`
}

export function mediaUrlFor(key) {
  return `${BLOB_PREFIX}${key}`
}

// Deletes every blob belonging to one synced carousel (slides + caption).
// Keys are derived from the index entry itself; the entry's directory prefix
// is also swept so no stray file can keep the post half-alive. Individual
// delete failures are swallowed — a leftover orphan is harmless (nothing in
// the index references it), while a thrown error would abort a whole sync.
export async function deleteCarouselBlobs(entry) {
  const s = store()
  const keys = new Set()
  for (const slide of entry.slides || []) {
    if (slide.file && slide.file.startsWith(BLOB_PREFIX)) keys.add(slide.file.slice(BLOB_PREFIX.length))
  }
  if (entry.caption && entry.caption.startsWith(BLOB_PREFIX)) keys.add(entry.caption.slice(BLOB_PREFIX.length))
  if (entry.directory && entry.directory.startsWith(BLOB_PREFIX)) {
    const prefix = entry.directory.slice(BLOB_PREFIX.length) + '/'
    try {
      let cursor
      do {
        const page = await s.list({ prefix, cursor })
        for (const blob of page.blobs || []) keys.add(blob.key)
        cursor = page.cursor
      } while (cursor)
    } catch {
      /* listing is best-effort cleanup; explicit keys above already cover the entry */
    }
  }
  for (const key of keys) {
    await s.delete(key).catch(() => {})
  }
  return keys.size
}

// One download attempt. The timeout covers the whole transfer, including
// reading the body — the old code only timed out the response headers, so a
// CDN that sent headers then stalled mid-body hung instead of failing.
async function downloadOnce(url, timeoutMs) {
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Download failed (${response.status})`)
    return await response.arrayBuffer()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function ingestFile(url, key, contentType) {
  let buffer
  try {
    buffer = await downloadOnce(url, 8000)
  } catch (firstError) {
    try {
      buffer = await downloadOnce(url, 0)
    } catch (secondError) {
      throw new Error(`Download failed for ${url}: ${(secondError && secondError.message) || secondError}`)
    }
  }
  await store().set(key, buffer, { contentType })
  return mediaUrlFor(key)
}

// Fetches one media object (with children for carousel albums) from the
// Instagram Graph API.
//
// `children` is requested as a nested field: a CAROUSEL_ALBUM has no media_url
// of its own, so the album's slides only come back through this expansion. The
// separate /children edge is still called as a fallback (it is unpaginated at
// Instagram's 10-slide album limit), but the nested form is what the docs
// guarantee.
export async function fetchIgMedia(mediaId, token) {
  const fields = ['id', 'caption', 'media_type', 'media_url', 'timestamp', 'permalink', 'thumbnail_url']
  const params = new URLSearchParams({ fields: fields.join(','), access_token: token })
  const response = await fetch(`https://graph.instagram.com/${mediaId}?${params}`)
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error(`Graph API error for ${mediaId}: ${JSON.stringify(data.error || data)}`)
  }
  if (data.media_type === 'CAROUSEL_ALBUM') {
    const childrenParams = new URLSearchParams({ fields: 'media_type,media_url,id', access_token: token })
    const childrenResponse = await fetch(`https://graph.instagram.com/${mediaId}/children?${childrenParams}`)
    const childrenData = await childrenResponse.json()
    if (childrenResponse.ok && Array.isArray(childrenData.data)) {
      data.children = childrenData.data.filter((child) => child.media_url)
    }
    if (!Array.isArray(data.children) || !data.children.length) {
      // Fallback: nested expansion, in case the children edge is unavailable.
      const nestedParams = new URLSearchParams({
        fields: 'id,media_type,children{media_type,media_url}',
        access_token: token,
      })
      const nested = await fetch(`https://graph.instagram.com/${mediaId}?${nestedParams}`).then((r) => r.json())
      const list = Array.isArray(nested.children) ? nested.children : nested.children?.data
      if (Array.isArray(list)) data.children = list.filter((child) => child.media_url)
    }
  }
  return data
}