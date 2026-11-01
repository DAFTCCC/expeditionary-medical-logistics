import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes dist/sw.js after the build: a service worker that pre-caches every
 * file the app needs (JS, CSS, scanner/writer WASM, icons) so FieldLine opens
 * and scans with no connectivity once it has been loaded one time. The cache
 * name is a hash of the build, so each deploy replaces the old cache.
 */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fieldline-offline-sw',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!p.endsWith('.map') && !p.endsWith('sw.js')) files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const h = createHash('sha256');
      for (const f of files.sort()) h.update(f).update(readFileSync(join(outDir, f)));
      const version = h.digest('hex').slice(0, 12);
      const tpl = readFileSync('src/app/sw-template.js', 'utf8');
      writeFileSync(join(outDir, 'sw.js'), tpl.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...files.filter((f) => f !== 'index.html')], null, 1)));
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, files: files.length }));
    },
  };
}

// Served from https://<owner>.github.io/expeditionary-medical-logistics/
export default defineConfig({
  base: process.env.FIELDLINE_BASE ?? '/expeditionary-medical-logistics/',
  plugins: [react(), offlineServiceWorker()],
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
});
