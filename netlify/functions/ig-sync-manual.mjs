// Manual trigger for an immediate sync. Handy for the initial backfill and for
// testing without waiting for the 5-minute schedule:
//
//   curl -X POST "https://<your-site>.netlify.app/.netlify/functions/ig-sync-manual?token=<IG_SYNC_TOKEN>"

import { env } from './_shared/ig-utils.mjs'
import { runSync } from './_shared/ig-sync-core.mjs'

export default async (req) => {
  const url = new URL(req.url)
  const syncToken = env('IG_SYNC_TOKEN')
  const provided = url.searchParams.get('token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!syncToken || provided !== syncToken) {
    return new Response('Unauthorized. Add ?token=<IG_SYNC_TOKEN>.', { status: 401 })
  }

  // URL-invoked (synchronous) functions are killed after ~10s, so give the
  // manual trigger a tight budget — each call imports a few posts, and the
  // 5-minute schedule finishes the rest. Call it repeatedly to backfill fast.
  const result = await runSync({ maxMs: 7000 })
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } })
}