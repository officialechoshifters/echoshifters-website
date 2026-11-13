// Manual trigger for an immediate sync. Handy for the initial backfill and for
// testing without waiting for the 5-minute schedule:
//
//   curl -X POST "https://<your-site>.netlify.app/.netlify/functions/ig-sync-manual?token=<IG_SYNC_TOKEN>"

import { env, getIgToken, readIndex, writeIndex, deleteCarouselBlobs, addDeletedMediaIds, readDeletedMediaIds, store } from './_shared/ig-utils.mjs'
import { runSync } from './_shared/ig-sync-core.mjs'

export default async (req) => {
  const url = new URL(req.url)
  const syncToken = env('IG_SYNC_TOKEN')
  const provided = url.searchParams.get('token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!syncToken || provided !== syncToken) {
    return new Response('Unauthorized. Add ?token=<IG_SYNC_TOKEN>.', { status: 401 })
  }

  // Admin capability: ?ig_debug=1 reports which Instagram account/token the
  // sync uses and what the API actually returns for it_ the fastest way to see
  // a stalled sync (e.g. an empty or switched account) without reading logs.
  // Add ?ids=<media_id,...> to check whether specific posts are still reachable.
  if (url.searchParams.get('ig_debug') === '1') {
    const token = await getIgToken()
    const userId = env('IG_USER_ID')
    const out = { userId, tokenConfigured: Boolean(token) }
    const q = (path) => fetch(`https://graph.instagram.com/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`).then((r) => r.json())
    try {
      out.me = await q('me?fields=id,username')
      const media = await q(`${userId}/media?fields=id,timestamp&limit=5`)
      out.media = media.error ? media.error : { count: media.data?.length, newest: media.data?.[0] }
      const checkIds = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
      if (checkIds.length) {
        out.ids = []
        for (const id of checkIds) {
          const r = await q(`${id}?fields=id,timestamp`)
          out.ids.push({ id, status: r.error ? r.error.message : 'ok', timestamp: r.timestamp })
        }
      }
    } catch (error) {
      out.error = String(error && error.message ? error.message : error)
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  // Admin capability: ?dump=1 returns the live index and tombstone list so
  // operators can audit what the mirror currently serves.
  if (url.searchParams.get('dump') === '1') {
    const [index, tombstones] = await Promise.all([readIndex(), readDeletedMediaIds()])
    return new Response(JSON.stringify({ index, tombstones }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  // Admin capability: ?untombstone=<id1,id2> removes media ids from the
  // tombstone list without touching the mirror. Needed after an account switch:
  // the sync prunes the old account's posts and records them as deleted, which
  // also hides the static copies of those same articles on the site.
  const unTombIds = (url.searchParams.get('untombstone') || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (unTombIds.length) {
    const existing = await readDeletedMediaIds()
    const remove = new Set(unTombIds.map(String))
    const kept = existing.filter((id) => !remove.has(String(id)))
    await store().setJSON('config/deleted-media-ids', { ids: kept })
    return new Response(JSON.stringify({ before: existing.length, after: kept.length, restored: unTombIds }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  // Admin capability: ?prune_ids=<id1,id2> tombstones specific media ids and
  // removes their mirror entries/blobs. For posts that predate the mirror or
  // that must come down without deleting them on Instagram.
  const pruneIds = (url.searchParams.get('prune_ids') || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (pruneIds.length) {
    const existing = await readIndex()
    const removed = []
    const keep = []
    for (const entry of existing) {
      if (pruneIds.includes(String(entry.id))) {
        try { await deleteCarouselBlobs(entry) } catch { /* orphan blob is harmless */ }
        removed.push(entry.id)
      } else keep.push(entry)
    }
    if (removed.length) await writeIndex(keep)
    await addDeletedMediaIds(pruneIds)
    return new Response(JSON.stringify({ removed_from_index: removed, tombstoned: pruneIds }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  // URL-invoked (synchronous) functions are killed after ~10s, so give the
  // manual trigger a tight budget — each call imports a few posts, and the
  // 5-minute schedule finishes the rest. Call it repeatedly to backfill fast.
  const result = await runSync({ maxMs: 7000 })
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } })
}