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

import { env, store, readIndex, writeIndex, getIgToken, fetchIgMedia, ingestFile, deleteCarouselBlobs, readDeletedMediaIds, addDeletedMediaIds, mediaKey, topicsFromCaption } from './ig-utils.mjs'

export async function runSync(options = {}) {
  const maxMs = typeof options.maxMs === 'number' && options.maxMs >= 0 ? options.maxMs : 25000
  const startedAt = Date.now()

  const token = await getIgToken()
  if (!token) return { ok: false, status: 500, body: { error: 'IG_ACCESS_TOKEN is not configured.' } }
  const userId = env('IG_USER_ID')
  if (!userId) return { ok: false, status: 500, body: { error: 'IG_USER_ID is not configured.' } }

  // Fetch the full current media list (paginated). This does double duty:
  // it feeds the "add new posts" loop below AND lets us prune posts that
  // were deleted on Instagram. Hard-capped so a pathological account can
  // never make the sync run forever.
  const PAGE_SIZE = 50
  const MAX_MEDIA_SCANNED = 2000
  const allItems = []
  let after = ''
  for (;;) {
    const params = new URLSearchParams({
      fields: 'id,caption,media_type,media_url,timestamp,permalink',
      limit: String(PAGE_SIZE),
      access_token: token,
    })
    if (after) params.set('after', after)
    const response = await fetch(`https://graph.instagram.com/${userId}/media?${params}`)
    const data = await response.json()
    if (!response.ok || data.error) {
      return { ok: false, status: 502, body: { error: `Instagram API error: ${JSON.stringify(data.error || data)}` } }
    }
    if (Array.isArray(data.data)) allItems.push(...data.data)
    if (allItems.length >= MAX_MEDIA_SCANNED) break
    after = data.paging?.cursors?.after || ''
    // A page smaller than the limit (or without a next cursor) means we have
    // the complete list — only then is deletion-pruning safe below.
    if (!after || (Array.isArray(data.data) && data.data.length < PAGE_SIZE)) break
  }
  // A full page fetched just under the cap means the list is provably
  // incomplete and pruning would be unsafe. An empty list is equally
  // untrustworthy (an API glitch must never wipe the whole mirror), so it
  // also disables pruning until at least one post is visible.
  const listIsComplete = allItems.length > 0 && allItems.length < MAX_MEDIA_SCANNED

  // Instagram returns newest first. `existing` holds what we already synced
  // (also newest first), so we only need to ingest the items at the head.
  const items = allItems
  let existing = await readIndex()

  // Record which account each entry came from. Posts synced before this field
  // existed have no `account`; they are assumed to be the current account so a
  // first run on a switched account does not read as "all posts deleted".
  const account = String(userId)
  for (const entry of existing) if (!entry.account) entry.account = account

  // Account switch guard: the mirror is a snapshot of ONE account's grid. When
  // IG_USER_ID is pointed at a different account, keeping the previous
  // account's entries would mix two accounts' stories forever (their posts are
  // not in this account's media list, so pruning would keep re-adding and
  // removing them). Drop entries from other accounts up front instead.
  const foreign = existing.filter((entry) => String(entry.account) !== account)
  if (foreign.length) {
    for (const entry of foreign) {
      try {
        await deleteCarouselBlobs(entry)
      } catch {
        /* index removal still happens; an orphaned blob is harmless */
      }
    }
    existing = existing.filter((entry) => String(entry.account) === account)
    await writeIndex(existing)
  }

  // Tombstones are authoritative deletions: a media id recorded here (because
  // it was deleted on Instagram, or wiped from the site on purpose) must never
  // be re-imported by the sync. This is checked outside the listIsComplete
  // guard — tombstones are explicit, not inferred from the media list.
  const tombstoned = new Set((await readDeletedMediaIds()).map(String))
  if (tombstoned.size) {
    const kept = []
    for (const entry of existing) {
      if (tombstoned.has(String(entry.id))) {
        try {
          await deleteCarouselBlobs(entry)
        } catch {
          /* index removal still happens; an orphaned blob is harmless */
        }
        continue
      }
      kept.push(entry)
    }
    if (kept.length !== existing.length) {
      existing = kept
      await writeIndex(existing)
    }
  }
  let existingIds = new Set(existing.map((c) => c.id))

  // Prune posts deleted on Instagram. Only entries that came from the IG
  // sync (ids are the Graph API media ids) are eligible — static carousels
  // never enter this index. Guarded by `listIsComplete`: if the fetch above
  // was cut short, deleting would be guessing, so we skip instead.
  const pruned = []
  if (listIsComplete) {
    const currentIds = new Set(items.map((item) => String(item.id)))
    for (let i = 0; i < existing.length; i++) {
      if (Date.now() - startedAt > maxMs) break
      if (currentIds.has(String(existing[i].id))) continue
      const entry = existing[i]
      try {
        await deleteCarouselBlobs(entry)
      } catch {
        /* index removal still happens; an orphaned blob is harmless */
      }
      existing.splice(i, 1)
      i--
      pruned.push(entry.id)
      // Checkpoint after each prune: a timeout mid-cleanup keeps everything
      // already pruned, and the next run continues from there.
      await writeIndex(existing)
      await addDeletedMediaIds([entry.id])
    }
    existingIds = new Set(existing.map((c) => c.id))
  }

  const added = []
  const failed = []

  for (const item of items) {
    if (existingIds.has(item.id)) continue
    // A tombstoned post stays deleted even if it is still live on Instagram.
    if (tombstoned.has(String(item.id))) continue
    // Time budget is only checked between items: an ingest already in flight
    // either finishes (and is checkpointed) or the function is killed by
    // Netlify — either way, previously ingested posts are already saved.
    if (Date.now() - startedAt > maxMs) {
      break
    }
    try {
      const carousel = await ingestMedia(item, token, account)
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

  return { ok: true, status: 200, body: { synced: added.length, total: existing.length, added, pruned, failed } }
}

// Newest first. Entries without a usable timestamp sink to the end so they
// never hide fresh posts.
function sortNewestFirst(carousels) {
  return carousels
    .map((c) => ({ c, t: c.timestamp ? Date.parse(c.timestamp) : -1 }))
    .sort((a, b) => b.t - a.t)
    .map(({ c }) => c)
}

async function ingestMedia(item, token, account) {
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
  // A partially downloaded carousel would publish a story with missing frames
  // and no way to notice. Keep the slides that landed, but report the gap in
  // the run result so it is visible instead of silent.
  const missing = downloads.length - slides.length

  // Title = first line of the caption, as with the existing static carousels.
  const firstLine = String(details.caption || '').split('\n')[0].trim() || `Instagram post · ${details.id}`
  slides[0].text = firstLine.slice(0, 120)

  const base = `carousels/article_IG_${details.id}`
  const captionText = details.caption || ''
  await store().set(`${base}/caption.txt`, captionText, { contentType: 'text/plain; charset=utf-8' })

  return {
    id: details.id,
    account: String(account),
    directory: `/media/${base}`,
    caption: `/media/${base}/caption.txt`,
    caption_text: captionText,
    topic: topics.join(','),
    tags,
    timestamp: details.timestamp,
    permalink: details.permalink || '',
    slides,
    // Non-zero means some frames of this carousel failed to download.
    ...(missing ? { missing_slides: missing } : {}),
  }
}
