// Keeps the Instagram long-lived access token alive.
//
// Instagram long-lived tokens expire after 60 days. Calling the refresh
// endpoint daily (grant_type=ig_refresh_token needs only the token, not an
// app secret) rolls it forward, so the sync keeps working without manual
// attention. The refreshed token is stored in the same blob store the sync
// function reads from.

import { getIgToken, setIgToken } from './_shared/ig-utils.mjs'

export const config = { schedule: '@daily' }

export default async (req) => {
  try {
    const body = await req.json()
    const isCron = body && typeof body.next_run === 'string'
    if (!isCron) {
      return new Response('This function only runs on its schedule.', { status: 403 })
    }
  } catch {
    return new Response('This function only runs on its schedule.', { status: 403 })
  }

  const token = await getIgToken()
  if (!token) {
    return new Response('IG_ACCESS_TOKEN is not configured (or the token blob is empty).', { status: 500 })
  }

  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })
  const response = await fetch(`https://graph.instagram.com/refresh_access_token?${params}`)
  const data = await response.json()
  if (!response.ok || data.error || !data.access_token) {
    return new Response(`Token refresh failed: ${JSON.stringify(data.error || data)}`, { status: 502 })
  }

  await setIgToken(data.access_token)
  return new Response('Token refreshed.', { status: 200 })
}