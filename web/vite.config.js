import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Tool version: package.json "version" + commit + build time. The page shows it in the
// header and settings (src/app-version.js); the build also writes it to version.json so
// an open page can tell that a newer build has been deployed.
function buildInfo() {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      commit = 'dev';
    }
  }
  return { version, commit, built: new Date().toISOString() };
}

const APP_INFO = buildInfo();

const versionFile = () => ({
  name: 'pa-cad-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(APP_INFO, null, 2)}\n` });
  },
});

export default defineConfig({
  base: '/pa-solder-copper-auto-draw/',
  define: { __APP_INFO__: JSON.stringify(APP_INFO) },
  plugins: [versionFile()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
