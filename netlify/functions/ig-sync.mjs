// Runs the Instagram -> Blobs sync on a schedule.
//
// Instagram offers no webhook for "a new post was created", so polling every 5
// minutes is the fastest fully-automatic option the API allows. New posts
// appear on the site within 5 minutes.
//
// Can be triggered manually from the Netlify UI (Functions page -> "Run now"),
// or call the separate ig-sync-manual endpoint for token-authenticated runs.

import { runSync } from './_shared/ig-sync-core.mjs'

export const config = { schedule: '*/5 * * * *' }

export default async (req) => {
  // Scheduled invocations POST a JSON body containing `next_run`.
  try {
    const body = await req.json()
    if (!body || typeof body.next_run !== 'string') return new Response('This function only runs on its schedule.', { status: 403 })
  } catch {
    return new Response('This function only runs on its schedule.', { status: 403 })
  }

  // Scheduled functions are killed at 30s; leave headroom for the index write.
  const result = await runSync({ maxMs: 25000 })
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } })
}