// Offline test harness for netlify/functions/newsletter.mjs.
// Mocks @netlify/blobs with an in-memory store so the double opt-in flow can be
// exercised without Netlify. Run: node scripts/test-newsletter.mjs
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 1. Build a tiny loader that serves a mock for @netlify/blobs.
const mockDir = await mkdtemp(join(tmpdir(), 'blobs-mock-'))
const mockPath = join(mockDir, 'mock.mjs')
await writeFile(
  mockPath,
  `const mem = new Map()
export function getStore() {
  return {
    get: async (k, o) => {
      const v = mem.get(k)
      return v === undefined ? null : o?.type === 'json' ? JSON.parse(v) : v
    },
    setJSON: async (k, v) => { mem.set(k, JSON.stringify(v)) },
  }
}
export default {}
`
)
const loaderSrc = `
const mockUrl = ${JSON.stringify(pathToFileURL(mockPath).href)}
export async function resolve(specifier, context, next) {
  if (specifier === '@netlify/blobs') return { url: mockUrl, shortCircuit: true }
  return next(specifier, context)
}
`
const loaderPath = join(mockDir, 'loader.mjs')
await writeFile(loaderPath, loaderSrc)
register(pathToFileURL(loaderPath))

const { default: fn } = await import('../netlify/functions/newsletter.mjs')

const results = []
const check = (name, ok) => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', '-', name) }

const post = (email) =>
  new Request('https://x.netlify.app/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '1.2.3.4' },
    body: JSON.stringify({ email, source: 'test' }),
  })
const get = (q) => new Request('https://x.netlify.app/newsletter' + q)

// 1. New signup → pending + confirm URL
const r1 = await fn(post('a@example.com')); const d1 = await r1.json()
check('signup returns ok + confirmUrl', r1.status === 200 && d1.ok && !!d1.confirmUrl)
check('signup message mentions inbox', /inbox/i.test(d1.message))

// 2. Replay signup rotates the token
const r2 = await fn(post('a@example.com')); const d2 = await r2.json()
check('re-signup rotates confirm token', d2.confirmUrl && d2.confirmUrl !== d1.confirmUrl)

// 3. Old token now rejected
const tok1 = new URL('https://x' + d1.confirmUrl).searchParams.get('confirm')
const rc = await fn(get('?email=a@example.com&confirm=' + tok1))
check('rotated confirm token rejected', rc.status === 403)

// 4. Fresh token confirms
const tok2 = new URL('https://x' + d2.confirmUrl).searchParams.get('confirm')
const rc2 = await fn(get('?email=a@example.com&confirm=' + tok2))
const body2 = await rc2.text()
check('fresh confirm token accepted', rc2.status === 200 && body2.includes('Subscription confirmed'))

// 5. Post-confirm resubscribe is idempotent
const r4 = await fn(post('a@example.com')); const d4 = await r4.json()
check('post-confirm resubscribe idempotent', d4.ok && /already on the list/.test(d4.message))

// 6. GET without any token → missing_token
const rg = await fn(get('?email=a@example.com'))
check('GET without token → 400 missing_token', rg.status === 400)

// 7. Unknown email → 404
const ru = await fn(get('?email=nobody@example.com&confirm=abc'))
check('unknown email → 404', ru.status === 404)

// 8. Bad unsubscribe token → 403
const rb = await fn(get('?email=a@example.com&unsubscribe=deadbeef'))
check('bad unsubscribe token → 403', rb.status === 403)

// 9. Honeypot gets generic success (no entry created)
await fn(new Request('https://x.netlify.app/newsletter', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '9.9.9.9' },
  body: JSON.stringify({ email: 'bot@example.com', website: 'spam' }),
}))
const rB = await fn(get('?email=bot@example.com&unsubscribe=whatever'))
check('honeypot email never stored', rB.status === 404)

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed.length} FAILED`)
process.exit(failed.length ? 1 : 0)
