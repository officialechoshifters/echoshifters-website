// Diagnostic: compares the production feed against what is currently live on
// Instagram and reports exactly why each article is visible or hidden.
// Run: node scripts/verify-feed.mjs
import { readFileSync } from 'node:fs'

const clerkKey = readFileSync('.env.local', 'utf8').match(/^CLERK_SECRET_KEY=(.*)/m)[1].trim()
const netlifyToken = readFileSync('.netlify-token', 'utf8').trim()
const hdr = { Authorization: 'Bearer ' + clerkKey }

// 1. Mint a session for the first user
const users = await (await fetch('https://api.clerk.com/v1/users?limit=1', { headers: hdr })).json()
const session = await (await fetch('https://api.clerk.com/v1/sessions', {
  method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: users[0].id }),
})).json()
const tok = (await (await fetch(`https://api.clerk.com/v1/sessions/${session.id}/tokens`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' } })).json()).jwt

// 2. Fetch the production feed
const feedRes = await fetch('https://echoshifters.netlify.app/content/carousels/index.json', { headers: { Authorization: 'Bearer ' + tok } })
const feed = await feedRes.json()
console.log('feed status:', feedRes.status, '| articles visible:', feed.carousels.length)
const feedIds = new Set(feed.carousels.map((c) => String(c.id)))

// 3. Fetch the live Instagram media list directly
const envs = await (await fetch('https://api.netlify.com/api/v1/sites/626d3928-83dd-43ac-948d-253f8a0af40f/env', { headers: { Authorization: 'Bearer ' + netlifyToken } })).json()
const arr = Array.isArray(envs) ? envs : Object.entries(envs).map(([k, v]) => ({ key: v.key || k, values: v.values }))
const find = (k) => arr.find((v) => v.key === k)?.values?.map((x) => x.value)?.[0]
const igList = await (await fetch(`https://graph.instagram.com/v21.0/${find('IG_USER_ID')}/media?fields=id&limit=50&access_token=${find('IG_ACCESS_TOKEN')}`)).json()
const liveIds = new Set((igList.data || []).map((x) => String(x.id)))
console.log('live Instagram posts:', liveIds.size)

// 4. Classify every static entry
const src = readFileSync('netlify/functions/_shared/static-content.mjs', 'utf8')
const idx = JSON.parse(src.slice(src.indexOf('= {') + 2, src.indexOf('\n\nexport const ARTICLES')))
const tally = { canonicalShown: 0, staticShown: 0, hiddenDeleted: 0, neverPosted: 0, problems: 0 }
for (const c of idx.carousels) {
  const mid = c.post?.media_id ? String(c.post.media_id) : null
  if (!mid) { tally.neverPosted++; continue }
  const canonicalInFeed = feed.carousels.some((f) => String(f.id) === mid && String(f.directory || '').startsWith('/media/'))
  const staticInFeed = feedIds.has(String(c.id))
  if (canonicalInFeed) tally.canonicalShown++          // live on IG, sync's copy shown
  else if (staticInFeed) tally.staticShown++           // shown via static copy
  else if (liveIds.has(mid)) {
    tally.problems++
    console.log('PROBLEM: post live on IG but nothing shown for it:', c.id, mid)
  } else tally.hiddenDeleted++                          // deleted on IG, hidden
}
console.log(`static entries ${idx.carousels.length} -> shown-as-canonical: ${tally.canonicalShown}, shown-as-static: ${tally.staticShown}, hidden (deleted on IG): ${tally.hiddenDeleted}, never posted: ${tally.neverPosted}, problems: ${tally.problems}`)

// 5. Sanity: no stale IG entries in the feed
const igInFeed = feed.carousels.filter((c) => String(c.directory || '').startsWith('/media/'))
const stale = igInFeed.filter((c) => !liveIds.has(String(c.id)))
console.log(`IG-synced in feed: ${igInFeed.length}, of which stale (not on IG anymore): ${stale.length}`)

// 6. Kill the test session
await fetch(`https://api.clerk.com/v1/sessions/${session.id}/revoke`, { method: 'POST', headers: hdr })
console.log('test session revoked')
