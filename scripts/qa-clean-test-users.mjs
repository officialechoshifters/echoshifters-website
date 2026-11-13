// Deletes QA test users (qa.*@example.com) created during verification and any
// temporary QA-created Clerk JWT templates.
import { readFileSync } from 'node:fs'
const netlifyAuth = readFileSync('.netlify-token', 'utf8').trim()
const headers = { Authorization: 'Bearer ' + netlifyAuth, 'Content-Type': 'application/json' }
const env = await (await fetch('https://api.netlify.com/api/v1/accounts/drmemerphb/env?site_id=1a06a770-7710-4808-ad2a-1d3e6a3612a7', { headers })).json()
const get = (k) => env.find((e) => e.key === k)?.values?.[0]?.value || ''
const clerkHeaders = { Authorization: 'Bearer ' + get('CLERK_SECRET_KEY'), 'Content-Type': 'application/json' }
const clerk = (path, init = {}) => fetch('https://api.clerk.com/v1' + path, { ...init, headers: { ...clerkHeaders, ...(init.headers || {}) } })

const all = []
for (let offset = 0; offset < 2000; offset += 100) {
  const page = await (await clerk(`/users?limit=100&offset=${offset}`)).json()
  if (!Array.isArray(page) || !page.length) break
  all.push(...page)
  if (page.length < 100) break
}
const qa = all.filter((u) => (u.email_addresses || []).some((e) => /^qa[.+-].*@example\.com$/i.test(e.email_address)))
console.log('total users:', all.length, '| qa users:', qa.map((u) => u.email_addresses[0].email_address))

for (const u of qa) {
  const r = await clerk(`/users/${u.id}`, { method: 'DELETE' })
  console.log(' delete', u.email_addresses[0].email_address, '->', r.status)
}

const templates = await (await clerk('/jwt_templates')).json()
for (const t of (Array.isArray(templates) ? templates : []).filter((x) => x.name.startsWith('qa_'))) {
  const r = await clerk(`/jwt_templates/${t.id}`, { method: 'DELETE' })
  console.log(' delete template', t.name, '->', r.status)
}
console.log('done')
