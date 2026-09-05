// Shared helpers for the Instagram -> Netlify Blobs pipeline.
// netlify/functions/_shared/ files are bundled into the functions that import them.

import { getStore } from '@netlify/blobs'

export const CAROUSEL_STORE = 'nigghters-carousels'
export const BLOB_PREFIX = '/media/'

export function store() {
  return getStore(CAROUSEL_STORE)
}

// The access token lives in a blob so the scheduled refresh function can renew
// it. Falls back to the IG_ACCESS_TOKEN environment variable on first run.
export async function getIgToken() {
  const s = store()
  const entry = await s.get('config/ig-token', { type: 'json' }).catch(() => null)
  if (entry && entry.token) return entry.token
  return process.env.IG_ACCESS_TOKEN || ''
}

export async function setIgToken(token) {
  await store().setJSON('config/ig-token', { token, refreshedAt: new Date().toISOString() })
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

const TOPIC_CATALOG = ['AI', 'Business', 'Culture', 'Finance', 'Health', 'Lifestyle', 'Politics', 'Science', 'Sports', 'Technology', 'Environment']

// Pre-merge labels still seen on older captions resolve to the topic that
// absorbed them (ARTS -> CULTURE, ECONOMY -> BUSINESS, MARKETS -> FINANCE).
const TOPIC_ALIASES = { arts: 'Culture', economy: 'Business', markets: 'Finance' }

// Pulls topic names and tags out of caption hashtags (e.g. "#AI #Markets").
export function topicsFromCaption(caption) {
  const hashtags = String(caption || '').match(/#[\w-]+/g) || []
  const tags = hashtags.map((t) => t.slice(1).toLowerCase())
  const topics = []
  for (const tag of tags) {
    const match = TOPIC_CATALOG.find((name) => name.toLowerCase() === tag)
    const merged = match || TOPIC_ALIASES[tag]
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

// Downloads a URL into a blob. Returns the public-facing /media/ path.
// Each download is aborted after 8s so a single slow media URL can never stall
// an entire sync run past Netlify's function time limits.
export async function ingestFile(url, key, contentType) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  let response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (error) {
    throw new Error(`Download aborted/timed out for ${url}: ${error && error.message ? error.message : error}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`)
  const buffer = await response.arrayBuffer()
  await store().set(key, buffer, { contentType })
  return mediaUrlFor(key)
}

// Fetches one media object (with children for carousel albums) from the
// Instagram Graph API.
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
  }
  return data
}