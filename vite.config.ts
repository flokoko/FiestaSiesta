import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const BASE = '/FiestaSiesta/'
// Extensions worth precaching for offline use: JS/CSS chunks, fonts, icons, manifest.
const PRECACHE_EXT = /\.(js|css|woff2|png|svg|webmanifest|json)$/

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, out)
    else out.push(full)
  }
  return out
}

// Inline plugin: emit dist/precache-manifest.json listing every precacheable
// build asset so the service worker can cache.addAll them on install.
function precacheManifestPlugin(): Plugin {
  return {
    name: 'fiesta-siesta-precache-manifest',
    writeBundle(options, bundle) {
      const names = new Set<string>()

      // 1) Rollup-emitted assets (JS chunks, CSS, imported images/fonts).
      for (const fileName of Object.keys(bundle)) {
        if (PRECACHE_EXT.test(fileName)) names.add(BASE + fileName)
      }

      // 2) Files copied verbatim from public/ (fonts, icons, manifest.json).
      for (const abs of walkDir('public')) {
        const rel = relative('public', abs).split(sep).join('/')
        if (PRECACHE_EXT.test(rel)) names.add(BASE + rel)
      }

      const manifest = JSON.stringify([...names].sort(), null, 2)
      const outDir = options.dir ?? 'dist'
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, 'precache-manifest.json'), manifest)
    },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    precacheManifestPlugin(),
    // Bundle-size report only when explicitly requested (ANALYZE=1).
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: 'dist/stats.html',
            open: false,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
})
