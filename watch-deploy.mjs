// watch-deploy.mjs
// Watches the site source and deploys automatically whenever a file changes.
//   npm run deploy:watch          (stops with Ctrl+C)
//   node watch-deploy.mjs --dry-run   (test without sending a real deploy)
import { watch, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const DEBOUNCE_MS = 3000; // wait after the last save before deploying

const IGNORED_DIRS = new Set(['dist', 'node_modules', '.netlify', '.git']);
const isIgnored = (name) =>
  IGNORED_DIRS.has(name) || name.startsWith('.') || name.endsWith('~') || /\.(swp|tmp)$/.test(name);

// Recursively collect every directory under `start` (skipping build/ignored dirs).
function collectDirs(start) {
  const dirs = [];
  const walk = (dir) => {
    dirs.push(dir);
    for (const entry of readdirSync(dir)) {
      if (isIgnored(entry)) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) walk(full);
      } catch {
        /* file disappeared mid-walk — ignore */
      }
    }
  };
  walk(start);
  return dirs;
}

// Everything that should trigger a deploy when it changes.
const WATCH_ROOTS = ['src', 'public', 'netlify']
  .map((name) => join(ROOT, name))
  .filter((dir) => {
    try { return statSync(dir).isDirectory(); } catch { return false; }
  });
const EXTRA_FILES = ['index.html', 'netlify.toml', 'deploy.mjs', 'package.json', 'vite.config.js']
  .map((name) => join(ROOT, name))
  .filter((file) => {
    try { return statSync(file).isFile(); } catch { return false; }
  });
const extraNames = new Set(EXTRA_FILES.map((f) => relative(ROOT, f)));

let changed = new Set();
let timer = null;
let deploying = false;
let pending = false;

function onEvent(dir, filename) {
  if (filename) {
    if (isIgnored(String(filename))) return;
    changed.add(join(relative(ROOT, dir), String(filename)));
  }
  clearTimeout(timer);
  timer = setTimeout(runDeploy, DEBOUNCE_MS);
}

function runDeploy() {
  if (deploying) { pending = true; return; }
  const files = [...changed];
  changed.clear();
  if (!files.length) return;
  deploying = true;
  console.log(`\n[watch] Changed: ${files.join(', ')}`);
  console.log(`[watch] Deploying to Netlify…`);
  if (DRY_RUN) {
    console.log('[watch] (dry run — no deploy was sent)\n');
    deploying = false;
    if (pending) { pending = false; runDeploy(); }
    return;
  }
  const child = spawn(process.execPath, ['deploy.mjs'], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    deploying = false;
    console.log(code === 0 ? '[watch] ✓ Deploy finished.' : `[watch] ✗ Deploy failed (exit code ${code}).`);
    if (pending) { pending = false; scheduleDeploy(); }
  });
}

function scheduleDeploy() {
  clearTimeout(timer);
  timer = setTimeout(runDeploy, DEBOUNCE_MS);
}

console.log('[watch] Auto-deploy watcher started.');
console.log(`[watch] Watching: ${WATCH_ROOTS.map((d) => relative(ROOT, d)).join(', ')}${EXTRA_FILES.length ? `, ${EXTRA_FILES.map((f) => relative(ROOT, f)).join(', ')}` : ''}`);
console.log(`[watch] Save a file and it will be live on the site ~${DEBOUNCE_MS / 1000}s later. Ctrl+C to stop.`);
if (DRY_RUN) console.log('[watch] DRY RUN — changes will be detected but NOT deployed.');

for (const dir of WATCH_ROOTS.flatMap(collectDirs)) {
  try {
    watch(dir, { persistent: true }, (_event, filename) => onEvent(dir, filename));
  } catch (error) {
    console.warn(`[watch] Could not watch ${dir}: ${error.message}`);
  }
}
if (EXTRA_FILES.length) {
  try {
    watch(ROOT, { persistent: true }, (_event, filename) => {
      if (filename && extraNames.has(String(filename))) onEvent(ROOT, String(filename));
    });
  } catch (error) {
    console.warn(`[watch] Could not watch ${ROOT}: ${error.message}`);
  }
}