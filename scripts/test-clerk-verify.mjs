// Smoke test for netlify/functions/_shared/clerk-verify.mjs.
// Generates a P-256 keypair, mocks the JWKS endpoint, and runs the verifier
// through happy path + each failure mode. Run: node scripts/test-clerk-verify.mjs
process.env.CLERK_ISSUER = 'https://tender-turtle-3675.clerk.accounts.dev'
process.env.CLERK_ALLOWED_ORIGINS = 'https://nigghters.netlify.app'

const { verifyClerkSession } = await import('../netlify/functions/_shared/clerk-verify.mjs')

const b64url = (buf) => Buffer.from(buf).toString('base64url')

// 1. Keypairs + JWKs (both ES256/EC-P-256 and RS256/RSA — Clerk instances use either)
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const jwkPublic = await crypto.subtle.exportKey('jwk', pair.publicKey)
jwkPublic.kid = 'test-kid'
jwkPublic.alg = 'ES256'
jwkPublic.use = 'sig'

const rsaPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const rsaJwkPublic = await crypto.subtle.exportKey('jwk', rsaPair.publicKey)
rsaJwkPublic.kid = 'test-kid-rsa'
rsaJwkPublic.alg = 'RS256'
rsaJwkPublic.use = 'sig'

// 2. Mock fetch for JWKS
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (String(url).includes('/.well-known/jwks.json')) {
    return { ok: true, json: async () => ({ keys: [jwkPublic, rsaJwkPublic] }) }
  }
  return realFetch(url)
}

// 3. Token factories
async function signToken(payload) {
  const header = { alg: 'ES256', typ: 'JWT', kid: 'test-kid' }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(new Uint8Array(sig))}`
}

async function signRsaToken(payload) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-kid-rsa' }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, rsaPair.privateKey, new TextEncoder().encode(signingInput))
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
check('valid ES256 cookie token accepted', r.ok === true && r.userId === 'user_123')
r = await verifyClerkSession(new Request('https://x.test/', { headers: { authorization: `Bearer ${token}` } }))
check('valid ES256 bearer token accepted', r.ok === true)
const rsaToken = await signRsaToken(validPayload)
r = await verifyClerkSession(req(rsaToken))
check('valid RS256 cookie token accepted', r.ok === true && r.userId === 'user_123')

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

// Algorithm confusion: ES256 header claiming an RSA kid (and vice versa) must be rejected
const confusedHeader = { alg: 'ES256', typ: 'JWT', kid: 'test-kid-rsa' }
const confusedInput = `${b64url(JSON.stringify(confusedHeader))}.${b64url(JSON.stringify(validPayload))}`
const confusedSig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(confusedInput))
r = await verifyClerkSession(req(`${confusedInput}.${b64url(new Uint8Array(confusedSig))}`))
check('ES256 header with RSA kid → 401 unsupported-key-type', !r.ok && r.reason === 'unsupported-key-type')

const confusedRsaHeader = { alg: 'RS256', typ: 'JWT', kid: 'test-kid' }
const confusedRsaInput = `${b64url(JSON.stringify(confusedRsaHeader))}.${b64url(JSON.stringify(validPayload))}`
const confusedRsaSig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, rsaPair.privateKey, new TextEncoder().encode(confusedRsaInput))
r = await verifyClerkSession(req(`${confusedRsaInput}.${b64url(new Uint8Array(confusedRsaSig))}`))
check('RS256 header with EC kid → 401 unsupported-key-type', !r.ok && r.reason === 'unsupported-key-type')

globalThis.fetch = realFetch
console.log(results.join('\n'))
process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0)
