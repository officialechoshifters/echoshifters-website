// Manual trigger for an immediate sync. Handy for the initial backfill and for
// testing without waiting for the 5-minute schedule:
//
//   curl -X POST "https://<your-site>.netlify.app/.netlify/functions/ig-sync-manual?token=<IG_SYNC_TOKEN>"

import { env, readIndex, writeIndex, deleteCarouselBlobs, addDeletedMediaIds, readDeletedMediaIds } from './_shared/ig-utils.mjs'
import { runSync } from './_shared/ig-sync-core.mjs'

export default async (req) => {
  const url = new URL(req.url)
  const syncToken = env('IG_SYNC_TOKEN')
  const provided = url.searchParams.get('token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!syncToken || provided !== syncToken) {
    return new Response('Unauthorized. Add ?token=<IG_SYNC_TOKEN>.', { status: 401 })
  }

  // Admin capability: ?dump=1 returns the live index and tombstone list so
  // operators can audit what the mirror currently serves.
  if (url.searchParams.get('dump') === '1') {
    const [index, tombstones] = await Promise.all([readIndex(), readDeletedMediaIds()])
    return new Response(JSON.stringify({ index, tombstones }), {
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