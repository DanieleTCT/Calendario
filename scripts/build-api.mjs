// Build API per ESM + monorepo symlink: bundle con esbuild, niente tsc/dist annidati.
// Output:
//   apps/api/dist/server.js — singolo file avviabile con `node dist/server.js` (NAS/Docker)
//   api/index.js            — serverless handler per Vercel (importa il bundle, niente listen)
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const esbuild = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');

execSync(
  `"${esbuild}" apps/api/src/server.ts --bundle --platform=node --format=esm --packages=external --outfile=apps/api/dist/server.js --log-level=warning --banner:js="// GENERATO da scripts/build-api.mjs - non modificare a mano." --alias:@calendario/domain=./packages/domain/src/index.ts --alias:@calendario/storage=./packages/storage/src/index.ts --alias:@calendario/agent=./packages/agent/src/index.ts`,
  { cwd: root, stdio: 'inherit', shell: true }
);
console.log('build-api: dist/server.js OK');

// Handler Vercel: riusa il bundle (Vercel esegue api/*.js come function).
// IMPORTANTE: api/index.js deve esistere nel SORGENTE committato (Vercel rileva
// le function a partire dai file del repo), poi questo build lo sovrascrive.
// @supabase/supabase-js viene incluso nel bundle: su Vercel la function è autonoma.
// Su Docker/NAS il bundle Vercel è inutile: SKIP_VERCEL=1 lo salta.
if (!process.env.SKIP_VERCEL) {
execSync(
  `"${esbuild}" scripts/vercel-handler.mjs --bundle --platform=node --format=cjs --outfile=api/index.js --log-level=warning --banner:js="// GENERATO da scripts/build-api.mjs - non modificare a mano." --alias:@calendario/domain=./packages/domain/src/index.ts --alias:@calendario/storage=./packages/storage/src/index.ts --alias:@calendario/agent=./packages/agent/src/index.ts`,
  { cwd: root, stdio: 'inherit', shell: true }
);
console.log('build-api: api/index.js (Vercel) OK');
} else {
  console.log('build-api: skip api/index.js (SKIP_VERCEL=1)');
}
