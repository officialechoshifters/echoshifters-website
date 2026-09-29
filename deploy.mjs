// One-command deploy: builds the site and pushes dist + functions to Netlify.
// The auth token is read from .netlify-token (never printed, never committed).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const token = readFileSync('.netlify-token', 'utf8').trim();
if (!token) {
  console.error('Missing token: create a file named .netlify-token containing your Netlify personal access token.');
  process.exit(1);
}

console.log('\n=== 1/2 Building the site ===\n');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error('\nBuild failed — nothing was deployed.');
  process.exit(build.status ?? 1);
}

console.log('\n=== 2/2 Deploying to nigghters.netlify.app ===\n');
const deploy = spawnSync(
  'npx',
  ['netlify', 'deploy', '--prod', '--dir', 'dist', '--no-build', '--auth', token, '--site', '1a06a770-7710-4808-ad2a-1d3e6a3612a7'],
  { stdio: 'inherit', shell: true }
);
process.exit(deploy.status ?? 1);