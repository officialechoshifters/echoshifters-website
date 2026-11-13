// Diagnostic for the Instagram feed: shows which account/token the sync is
// using and what the Graph API actually returns for it.
// Run: node scripts/ig-debug.mjs            (account + newest post + full sync)
//      node scripts/ig-debug.mjs <media_id> (also check specific posts)
import { readFileSync } from 'node:fs'

const token = readFileSync('.ig-sync-token', 'utf8').trim()
const site = process.env.ECHO_SITE || 'https://echoshifters.com'
const ids = process.argv.slice(2).join(',')

const debug = await fetch(`${site}/.netlify/functions/ig-sync-manual?ig_debug=1&token=${token}${ids ? `&ids=${ids}` : ''}`)
console.log('IG state:', await debug.text())

const sync = await fetch(`${site}/.netlify/functions/ig-sync-manual?token=${token}`)
console.log('sync run:', await sync.text())
