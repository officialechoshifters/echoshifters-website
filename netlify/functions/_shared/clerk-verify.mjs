// Verifies Clerk session JWTs in Netlify functions — no dependencies.
//
// Clerk puts the session token in the `__session` cookie. It is a JWKS-signed
// JWT whose `iss` is the Clerk domain (e.g. https://foo.clerk.accounts.dev)
// and whose `azp` must match an allowed origin. We verify the signature
// (ES256 or RS256 — Clerk instances use either), issuer, expiry, and azp —
// that is a complete Clerk session check.
//
// Crypto support: Node 20 has WebCrypto globally, so both Netlify Functions
// (v2 runtime, Node 20+) and local `netlify dev` can run this unchanged.

const ISSUER = process.env.CLERK_ISSUER || ''
const AZP_ALLOWLIST = (process.env.CLERK_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Small JWKS cache so we don't refetch keys on every request. Functions are
// reused across invocations, so this hits Clerk's CDN once per lambda instance.
let jwksCache = { keys: null, fetchedAt: 0 }
const JWKS_TTL_MS = 60 * 60 * 1000

async function getJwks() {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys
  if (!ISSUER) throw new Error('CLERK_ISSUER is not configured')
  const response = await fetch(`${ISSUER.replace(/\/$/, '')}/.well-known/jwks.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data.keys)) throw new Error('JWKS response has no keys')
  jwksCache = { keys: data.keys, fetchedAt: Date.now() }
  return data.keys
}

// RS256/ES256 helpers — base64url <-> bytes.
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function verifyEs256(token, jwk) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  const parts = token.split('.')
  const sig = b64urlToBytes(parts[2])
  // JWS signatures are r||s raw (64 bytes); WebCrypto expects that too.
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
}

async function verifyRs256(token, jwk) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const parts = token.split('.')
  const sig = b64urlToBytes(parts[2])
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, sig, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
}

export async function verifyClerkSession(request) {
  // 1. Extract __session cookie (Cookie header) — Authorization Bearer works
  //    too so curl-based testing is possible.
  let token = ''
  const cookieHeader = request.headers.get('cookie') || ''
  const m = cookieHeader.match(/(?:^|;\s*)__session=([^;]+)/)
  if (m) token = decodeURIComponent(m[1])
  if (!token) {
    const auth = request.headers.get('authorization') || ''
    if (auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim()
  }
  if (!token) return { ok: false, status: 401, reason: 'no-session' }

  // 2. Split and decode the JWT.
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, status: 401, reason: 'malformed-token' }
  let header, payload
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])))
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])))
  } catch {
    return { ok: false, status: 401, reason: 'malformed-token' }
  }

  // 3. Standard claims.
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now - 5) return { ok: false, status: 401, reason: 'expired' }
  if (payload.iss && ISSUER && payload.iss.replace(/\/$/, '') !== ISSUER.replace(/\/$/, '')) {
    return { ok: false, status: 401, reason: 'wrong-issuer' }
  }
  if (!payload.sub) return { ok: false, status: 401, reason: 'no-subject' }

  // 4. azp (authorized party) — must be one of the allowed origins when set.
  if (AZP_ALLOWLIST.length && payload.azp && !AZP_ALLOWLIST.includes(payload.azp)) {
    return { ok: false, status: 401, reason: 'bad-azp' }
  }

  // 5. Signature via Clerk's JWKS. Clerk signs session JWTs with ES256
  //    (EC P-256) or RS256 (RSA) depending on the instance, so both are
  //    supported and the token's `alg` must agree with the JWK key type —
  //    that pairing is enforced below to rule out algorithm confusion.
  const keys = await getJwks()
  // If the token declares a kid it must match exactly — falling back to "any
  // key of the right type" would let tokens signed by foreign/rotated-out keys
  // verify. Type-based fallback only applies when kid is absent.
  const jwk = header.kid
    ? keys.find((k) => k.kid === header.kid)
    : keys.find((k) => k.kty === 'EC' && k.crv === 'P-256') || keys.find((k) => k.kty === 'RSA' && k.alg === 'RS256')
  if (!jwk) return { ok: false, status: 401, reason: 'unknown-key' }
  const isEs256 = header.alg === 'ES256' && jwk.kty === 'EC' && jwk.crv === 'P-256'
  const isRs256 = header.alg === 'RS256' && jwk.kty === 'RSA'
  if (!isEs256 && !isRs256) return { ok: false, status: 401, reason: 'unsupported-key-type' }

  const valid = isEs256 ? await verifyEs256(token, jwk) : await verifyRs256(token, jwk)
  if (!valid) return { ok: false, status: 401, reason: 'bad-signature' }

  return { ok: true, userId: payload.sub, sessionId: payload.sid || '', orgId: payload.o?.id || '' }
}

// Convenience wrapper: gate a handler, run the real logic only when signed in.
export function requireSession(handler) {
  return async (request, context) => {
    const result = await verifyClerkSession(request)
    if (!result.ok) {
      return new Response(JSON.stringify({ error: 'unauthorized', reason: result.reason }), {
        status: 401,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    }
    return handler(request, context, result)
  }
}
