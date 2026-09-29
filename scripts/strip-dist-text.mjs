// Post-build step: strip members-only text from the public dist folder.
//
// The carousel index, captions, and slide scripts are served by the gated
// /content/* and /media/* functions after verifying a Clerk session. If the
// raw JSON/TXT files also shipped in dist, anyone could bypass the paywall
// with a direct URL — so this removes them right after `vite build`.
import { rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Windows can briefly lock freshly-copied files (search indexer / antivirus
// scanning dist as it is written), making rmSync throw EPERM. A short retry
// with backoff rides those out instead of failing the whole build.
function rmWithRetry(path, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(path, { force: true, maxRetries: 3, retryDelay: 200 })
      return
    } catch (error) {
      if (i === attempts - 1) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * (i + 1))
    }
  }
}

const distCarousels = join(process.cwd(), 'dist', 'carousels')
if (!existsSync(distCarousels)) {
  console.log('dist/carousels not found — nothing to strip.')
  process.exit(0)
}

// Every text file under dist/carousels is members-only content.
let removed = 0
function stripTextFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      stripTextFiles(full)
    } else if (/\.(json|txt)$/i.test(entry.name)) {
      rmWithRetry(full)
      removed++
    }
  }
}
stripTextFiles(distCarousels)

// The directory itself is now empty of text; images remain for the feed.
console.log(`Stripped ${removed} members-only text file(s) from dist/carousels — served by gated functions instead.`)
