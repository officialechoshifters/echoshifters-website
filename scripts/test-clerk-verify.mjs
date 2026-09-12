// Smoke test for netlify/functions/_shared/clerk-verify.mjs.
// Generates a P-256 keypair, mocks the JWKS endpoint, and runs the verifier
// through happy path + each failure mode. Run: node scripts/test-clerk-verify.mjs
process.env.CLERK_ISSUER = 'https://tender-turtle-3675.clerk.accounts.dev'
process.env.CLERK_ALLOWED_ORIGINS = 'https://nigghters.netlify.app'

const { verifyClerkSession } = await import('../netlify/functions/_shared/clerk-verify.mjs')

const b64url = (buf) => Buffer.from(buf).toString('base64url')

// 1. Keypair + JWK
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwkPublic = await crypto.subtle.exportKey('jwk', pair.publicKey)
jwkPublic.kid = 'test-kid'
jwkPublic.alg = 'ES256'
jwkPublic.use = 'sig'

// 2. Mock fetch for JWKS
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (String(url).includes('/.well-known/jwks.json')) {
    return { ok: true, json: async () => ({ keys: [jwkPublic] }) }
  }
  return realFetch(url)
}

// 3. Token factory
async function signToken(payload) {
  const header = { alg: 'ES256', typ: 'JWT', kid: 'test-kid' }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(new Uint8Array(sig))}`
}

const now = Math.floor(Date.now() / 1000)
const validPayload = { sub: 'user_123', sid: 'sess_abc', iss: 'https://tender-turtle-3675.clerk.accounts.dev', azp: 'https://nigghters.netlify.app', exp: now + 60, iat: now }
const token = await signToken(validPayload)
const req = (cookie) => new Request('https://nigghters.netlify.app/content/carousels/index.json', { headers: cookie ? { cookie: `__session=${cookie}` } : {} })

const results = []
const check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`)

// Happy paths
let r = await verifyClerkSession(req(token))
check('valid cookie token accepted', r.ok === true && r.userId === 'user_123')
r = await verifyClerkSession(new Request('https://x.test/', { headers: { authorization: `Bearer ${token}` } }))
check('valid bearer token accepted', r.ok === true)

// Failure modes
r = await verifyClerkSession(req(''))
check('missing token → 401 no-session', !r.ok && r.status === 401 && r.reason === 'no-session')
r = await verifyClerkSession(req('not.a.jwt'))
check('malformed token → 401', !r.ok && r.reason === 'malformed-token')
r = await verifyClerkSession(req(await signToken({ ...validPayload, exp: now - 60 })))
check('expired token → 401 expired', !r.ok && r.reason === 'expired')
r = await verifyClerkSession(req(await signToken({ ...validPayload, iss: 'https://evil.example.com' })))
check('wrong issuer → 401 wrong-issuer', !r.ok && r.reason === 'wrong-issuer')
r = await verifyClerkSession(req(await signToken({ ...validPayload, azp: 'https://evil.example.com' })))
check('bad azp → 401 bad-azp', !r.ok && r.reason === 'bad-azp')
r = await verifyClerkSession(req(await signToken({ ...validPayload, sub: undefined })))
check('missing subject → 401 no-subject', !r.ok && r.reason === 'no-subject')

// Tampered signature (flip payload but keep header+sig shape)
const parts = token.split('.')
const tampered = `${parts[0]}.${b64url(JSON.stringify({ ...validPayload, sub: 'user_999' }))}.${parts[2]}`
r = await verifyClerkSession(req(tampered))
check('tampered payload → 401 bad-signature', !r.ok && r.reason === 'bad-signature')

// Unknown kid
const unknownKidHeader = { alg: 'ES256', typ: 'JWT', kid: 'nope' }
const unknownSigningInput = `${b64url(JSON.stringify(unknownKidHeader))}.${b64url(JSON.stringify(validPayload))}`
const unknownSig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(unknownSigningInput))
r = await verifyClerkSession(req(`${unknownSigningInput}.${b64url(new Uint8Array(unknownSig))}`))
check('unknown kid → 401 unknown-key', !r.ok && r.reason === 'unknown-key')

globalThis.fetch = realFetch
console.log(results.join('\n'))
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0)
