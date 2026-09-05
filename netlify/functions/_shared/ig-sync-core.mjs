// The actual Instagram -> Blobs sync. Shared by the scheduled function
// (ig-sync) and the manual trigger (ig-sync-manual) so the logic lives once.
//
// Runs are *incremental and time-budgeted*: Netlify kills synchronous
// functions after ~10s and scheduled functions after 30s, and downloading a
// backfill of many posts can exceed that. Each invocation therefore processes
// posts until `options.maxMs` elapses, writing the index to blobs after every
// successfully ingested post, so the next scheduled run (every 5 minutes)
// resumes exactly where the previous one stopped. Nothing is ever lost to a
// timeout.

import { env, store, readIndex, writeIndex, getIgToken, fetchIgMedia, ingestFile, mediaKey, topicsFromCaption } from './ig-utils.mjs'

export async function runSync(options = {}) {
  const maxMs = typeof options.maxMs === 'number' && options.maxMs >= 0 ? options.maxMs : 25000
  const startedAt = Date.now()

  const token = await getIgToken()
  if (!token) return { ok: false, status: 500, body: { error: 'IG_ACCESS_TOKEN is not configured.' } }
  const userId = env('IG_USER_ID')
  if (!userId) return { ok: false, status: 500, body: { error: 'IG_USER_ID is not configured.' } }

  const params = new URLSearchParams({
    fields: 'id,caption,media_type,media_url,timestamp,permalink',
    limit: '25',
    access_token: token,
  })
  const response = await fetch(`https://graph.instagram.com/${userId}/media?${params}`)
  const data = await response.json()
  if (!response.ok || data.error) {
    return { ok: false, status: 502, body: { error: `Instagram API error: ${JSON.stringify(data.error || data)}` } }
  }

  // Instagram returns newest first. `existing` holds what we already synced
  // (also newest first), so we only need to ingest the items at the head.
  const items = Array.isArray(data.data) ? data.data : []
  let existing = await readIndex()
  const existingIds = new Set(existing.map((c) => c.id))

  const added = []
  const failed = []

  for (const item of items) {
    if (existingIds.has(item.id)) continue
    // Time budget is only checked between items: an ingest already in flight
    // either finishes (and is checkpointed) or the function is killed by
    // Netlify — either way, previously ingested posts are already saved.
    if (Date.now() - startedAt > maxMs) {
      break
    }
    try {
      const carousel = await ingestMedia(item, token)
      existing.push(carousel)
      existingIds.add(item.id)
      added.push(item.id)
      // Checkpoint after every post: a timeout mid-backfill keeps everything
      // ingested so far, and the next run picks up where this one stopped.
      existing = sortNewestFirst(existing)
      await writeIndex(existing)
    } catch (error) {
      failed.push({ id: item.id, error: String((error && error.message) || error) })
    }
  }

  return { ok: true, status: 200, body: { synced: added.length, total: existing.length, added, failed } }
}

// Newest first. Entries without a usable timestamp sink to the end so they
// never hide fresh posts.
function sortNewestFirst(carousels) {
  return carousels
    .map((c) => ({ c, t: c.timestamp ? Date.parse(c.timestamp) : -1 }))
    .sort((a, b) => b.t - a.t)
    .map(({ c }) => c)
}

async function ingestMedia(item, token) {
  const details = await fetchIgMedia(item.id, token)
  const { topics, tags } = topicsFromCaption(details.caption || '')
  const media = details.media_type === 'CAROUSEL_ALBUM' && Array.isArray(details.children) ? details.children : [{ media_type: details.media_type, media_url: details.media_url }]

  // Download slides in parallel: a carousel album can hold 10 images and
  // serial downloads are what blows past Netlify's function time limits.
  const downloads = await Promise.allSettled(
    media.map((child, index) => {
      const slideIndex = index + 1
      const contentType = child.media_type === 'VIDEO' ? 'video/mp4' : 'image/jpeg'
      const key = mediaKey(details.id, slideIndex, child.media_type)
      return ingestFile(child.media_url, key, contentType).then((file) => ({
        id: slideIndex === 1 ? 'title_text' : `slide_${slideIndex}`,
        kind: child.media_type === 'VIDEO' ? 'video' : 'image',
        file,
        text: '',
      }))
    })
  )

  const slides = []
  for (const result of downloads) {
    if (result.status === 'fulfilled') slides.push(result.value)
    // Rejected children are skipped; slides that did download are kept.
  }
  if (!slides.length) {
    const reasons = downloads.map((r) => (r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : '')).filter(Boolean).join('; ')
    throw new Error(`No downloadable media for ${details.id}${reasons ? ` (${reasons})` : ''}`)
  }

  // Title = first line of the caption, as with the existing static carousels.
  const firstLine = String(details.caption || '').split('\n')[0].trim() || `Instagram post · ${details.id}`
  slides[0].text = firstLine.slice(0, 120)

  const base = `carousels/article_IG_${details.id}`
  const captionText = details.caption || ''
  await store().set(`${base}/caption.txt`, captionText, { contentType: 'text/plain; charset=utf-8' })

  return {
    id: details.id,
    directory: `/media/${base}`,
    caption: `/media/${base}/caption.txt`,
    caption_text: captionText,
    topic: topics.join(','),
    tags,
    timestamp: details.timestamp,
    permalink: details.permalink || '',
    slides,
  }
}
