// Newsletter signup endpoint: POST /newsletter
//
// Public (no Clerk session needed) — anyone can join the dispatch. Signups are
// stored in the same Netlify Blobs store the IG sync uses, under newsletter/*,
// so there is no extra infrastructure to run.
//
// German law (and good GDPR practice) requires double opt-in: a subscription
// only counts once the address owner confirms it. So signup is two-step:
//
//   POST /newsletter  { email, source?, website? }
//     → stores a PENDING entry with a confirm token and returns the
//       confirmation URL. Pending addresses receive nothing and expire after
//       PENDING_TTL_DAYS — they are reservations, not subscriptions.
//   GET  /newsletter?email=...&confirm=<token>   → confirmation page
//     → flips pending → confirmed (records confirmedAt for consent proof).
//   GET  /newsletter?email=...&unsubscribe=<token> → unsubscribe page
//     → removes the address entirely.
//
// `website` is a honeypot field: real visitors never fill it, bots do.
//
// Later: connect a real sender (Buttondown / MailerLite / Brevo...) and have it
// email the confirm + unsubscribe links — see README "The weekly dispatch".

import { getStore } from '@netlify/blobs'
import { randomBytes, timingSafeEqual } from 'node:crypto'

export const config = { path: '/newsletter' }

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
const LIST_KEY = 'newsletter/subscribers'
const MAX_SUBSCRIBERS = 50000
const PENDING_TTL_DAYS = 30

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  // Pragmatic validation: one @, no spaces, a dot in the domain part.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function store() {
  return getStore('nigghters-carousels')
}

async function readList() {
  const raw = await store().get(LIST_KEY, { type: 'json' }).catch(() => null)
  return raw && Array.isArray(raw.subscribers) ? raw.subscribers : []
}

async function writeList(subscribers) {
  await store().setJSON(LIST_KEY, { subscribers, updatedAt: new Date().toISOString() })
}

// Very light in-memory rate limit per IP (best effort; functions are scaled
// out so it is a deterrent, not a guarantee).
const recentPosts = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5

function rateLimited(ip) {
  const now = Date.now()
  const hits = (recentPosts.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  recentPosts.set(ip, hits)
  if (recentPosts.size > 500) recentPosts.clear()
  return hits.length > MAX_PER_WINDOW
}

// Constant-time token comparison so timing cannot leak the secret.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function page(title, lines) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — NIGGHTERS dispatch</title><style>body{background:#0b0d0d;color:#f2f3ed;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;max-width:520px;padding:30px}h1{font-size:26px}p{color:#9da7a2}</style></head><body><main><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</main></body></html>`
}

export default async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const email = validEmail(url.searchParams.get('email'))
    if (!email) return json({ ok: false, error: 'invalid_email' }, 400)

    const subscribers = await readList()
    const index = subscribers.findIndex((s) => s.email === email)
    if (index === -1) return json({ ok: false, error: 'not_found' }, 404)
    const entry = subscribers[index]

    // --- Double opt-in confirmation ---
    const confirmToken = url.searchParams.get('confirm')
    if (confirmToken) {
      if (!entry.confirmToken || !safeEqual(confirmToken, entry.confirmToken)) {
        return new Response(page('Link no longer valid', ['This confirmation link has already been used or has expired.', 'Sign up again on the site to get a fresh one.']), { status: 403, headers: HTML_HEADERS })
      }
      entry.status = 'confirmed'
      entry.confirmedAt = new Date().toISOString()
      delete entry.confirmToken
      await writeList(subscribers)
      return new Response(
        page('Subscription confirmed', [`<strong>${email}</strong> is now on the list for the NIGGHTERS biweekly dispatch.`, 'You can unsubscribe any time via the link in every email or the one below.']),
        { status: 200, headers: HTML_HEADERS }
      )
    }

    // --- Unsubscribe ---
    const unsubToken = url.searchParams.get('unsubscribe')
    if (unsubToken) {
      if (!entry.token || !safeEqual(unsubToken, entry.token)) return json({ ok: false, error: 'bad_token' }, 403)
      const remaining = subscribers.filter((s) => s.email !== email)
      await writeList(remaining)
      return new Response(
        page("You're unsubscribed", [`${email} will no longer receive the NIGGHTERS biweekly dispatch.`, 'Your address has been deleted from our list.']),
        { status: 200, headers: HTML_HEADERS }
      )
    }

    return json({ ok: false, error: 'missing_token' }, 400)
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const ip = req.headers.get('x-nf-client-connection-ip') || 'unknown'
  if (rateLimited(ip)) return json({ ok: false, error: 'rate_limited' }, 429)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400)
  }

  const genericMessage = 'Check your inbox for the confirmation link (check spam, too).'

  // Honeypot: bots that fill the hidden `website` field get a fake-success so
  // they do not adapt.
  if (body.website) return json({ ok: true, message: genericMessage })

  const email = validEmail(body.email)
  if (!email) return json({ ok: false, error: 'invalid_email' }, 400)

  const subscribers = await readList()
  if (subscribers.length >= MAX_SUBSCRIBERS) return json({ ok: false, error: 'list_full' }, 507)

  const existing = subscribers.find((s) => s.email === email)

  // Already confirmed: idempotent, nothing to do.
  if (existing && existing.status === 'confirmed') {
    return json({ ok: true, message: 'You are already on the list, see you in the next dispatch.' })
  }

  // Pending (or expired-pending) entry: refresh the confirm token so the old
  // link stops working and a fresh one can be sent.
  if (existing) {
    const pendingAgeDays = (Date.now() - new Date(existing.requestedAt || existing.subscribedAt || 0).getTime()) / 86_400_000
    const expired = pendingAgeDays > PENDING_TTL_DAYS
    existing.confirmToken = randomBytes(16).toString('hex')
    existing.status = 'pending'
    existing.requestedAt = new Date().toISOString()
    if (expired) existing.source = String(body.source || existing.source || 'site').slice(0, 40)
    await writeList(subscribers)
    return json({
      ok: true,
      message: genericMessage,
      confirmUrl: `/newsletter?email=${encodeURIComponent(email)}&confirm=${existing.confirmToken}`,
    })
  }

  // New signup: store as PENDING — the address is a reservation, not a
  // subscription. It receives nothing until the confirm link is visited, and
  // expires automatically if confirmation never happens.
  const entry = {
    email,
    token: randomBytes(16).toString('hex'), // unsubscribe token, survives confirmation
    confirmToken: randomBytes(16).toString('hex'),
    status: 'pending',
    source: String(body.source || 'site').slice(0, 40),
    requestedAt: new Date().toISOString(),
  }
  subscribers.push(entry)
  await writeList(subscribers)

  return json({
    ok: true,
    message: genericMessage,
    confirmUrl: `/newsletter?email=${encodeURIComponent(email)}&confirm=${entry.confirmToken}`,
  })
}
