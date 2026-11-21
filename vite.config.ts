import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const BASE = '/FiestaSiesta/'
// Extensions worth precaching for offline use: JS/CSS chunks, fonts, icons, manifest.
const PRECACHE_EXT = /\.(js|css|woff2|png|svg|webmanifest|json)$/

// Screen-Chunks, die NICHT beim Install precacht werden: sie werden beim ersten
// Öffnen nachgeladen und landen danach über den Fetch-Handler (cache.put) im
// Cache. Spart beim Deploy-Update den Großteil des Downloads.
const PRECACHE_EXCLUDE = /(BristolScreen|leaflet|QuizScreen|WeatherScreen|OpeningHoursScreen|SettingsScreen|DayMapScreen)/

function walkDir(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, out)
    else out.push(full)
  }
  return out
}

// Dateinamen der unverändert kopierten public/-Dateien — für Manifest und Buildhash.
function publicNames(): string[] {
  return walkDir('public').map((abs) => relative('public', abs).split(sep).join('/'))
}

// Inline plugin: emit dist/precache-manifest.json listing every precacheable
// build asset so the service worker can cache.addAll them on install.
function precacheManifestPlugin(): Plugin {
  return {
    name: 'fiesta-siesta-precache-manifest',
    writeBundle(options, bundle) {
      const names = new Set<string>()

      // 1) Rollup-emitted assets (JS chunks, CSS, imported images/fonts).
      //    Lazy-Screens (PRECACHE_EXCLUDE) bleiben raus: die lädt der Browser beim
      //    ersten Öffnen und der Fetch-Handler schreibt sie dann in den Cache.
      for (const fileName of Object.keys(bundle)) {
        const base = fileName.split('/').pop() ?? fileName
        if (PRECACHE_EXT.test(fileName) && !PRECACHE_EXCLUDE.test(base)) names.add(BASE + fileName)
      }

      // 2) Files copied verbatim from public/ (fonts, icons, manifest.json).
      //    sw.js gehört NICHT ins Manifest: der Browser aktualisiert es an jedem
      //    Cache vorbei, ein geprecachtes Duplikat ist nur Ballast.
      for (const rel of publicNames()) {
        if (rel === 'sw.js') continue
        if (PRECACHE_EXT.test(rel) && !PRECACHE_EXCLUDE.test(rel)) names.add(BASE + rel)
      }

      const manifest = JSON.stringify([...names].sort(), null, 2)
      const outDir = options.dir ?? 'dist'
      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, 'precache-manifest.json'), manifest)
    },
  }
}

// Erzeugt den Build-Hash (sha256 über die sortierten Dateinamen des Bundles und
// aus public/, auf 8 Hex-Zeichen gekürzt) und schreibt dist/sw.js mit
// ersetztem '__CACHE_NAME__' — damit überschreibt er die Kopie, die Vite von
// public/sw.js bereits nach dist/ gelegt hat. Ein Codeänderung ändert die
// Chunk-Dateinamen (Content-Hashes im Namen), also den CACHE_NAME — kein
// manuelles Bumpen mehr.
//
// Zur BUILD_ID: `define` wird zur Transformzeit angewendet, der Hash entsteht
// aber erst im Bundle. Define liefert daher nur den Platzhalter '__BUILD_ID__',
// den dieses Plugin in den geschriebenen Chunks durch den echten Hash ersetzt.
function buildVersionPlugin(): Plugin {
  const swTemplate = readFileSync('public/sw.js', 'utf-8')
  return {
    name: 'fiesta-siesta-build-version',
    writeBundle(options, bundle) {
      const names = [...Object.keys(bundle), ...publicNames()]
      const hash = createHash('sha256')
        .update(names.sort().join('\n'))
        .digest('hex')
        .slice(0, 8)
      const cacheName = `fiesta-siesta-${hash}`
      const outDir = options.dir ?? 'dist'

      let patched = 0
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !file.fileName.endsWith('.js')) continue
        if (!file.code.includes('__BUILD_ID__')) continue
        // Nacktes Token ersetzen: der Minifier quotet Strings wahlweise mit
        // Backticks oder Gänsefüßchen — die Anführungszeichen bleiben stehen.
        writeFileSync(join(outDir, file.fileName), file.code.replaceAll('__BUILD_ID__', hash))
        patched++
      }

      // sw.js der Kopie nachziehen — writeBundle läuft nach Vites public-Kopie.
      writeFileSync(join(outDir, 'sw.js'), swTemplate.replaceAll('__CACHE_NAME__', cacheName))
      console.log(`[build-version] ${cacheName} · BUILD_ID in ${patched} Chunk(s) ersetzt`)
    },
  }
}

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }

// Wird auch von vitest.config.ts importiert, damit die Tests dieselben
// Build-Konstanten sehen (ohne diese Definition würde der Import von
// src/version.ts in vitest mit „__APP_VERSION__ is not defined" fallen).
export const APP_DEFINE = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  // Platzhalter — der echte Buildhash wird im writeBundle des
  // build-version-plugin in die geschriebenen Chunks eingesetzt.
  __BUILD_ID__: JSON.stringify('__BUILD_ID__'),
}

export default defineConfig({
  base: BASE,
  define: APP_DEFINE,
  build: {
    rollupOptions: {
      output: {
        // React und Supabase ändern sich bei App-Updates fast nie. Getrennte Chunks
        // bedeuten: ein Deploy invalidiert nur den kleinen App-Chunk, der Service
        // Worker muss nicht 460 kB neu laden.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'vendor-react'
          }
          if (id.includes('@supabase') || id.includes('postgrest') || id.includes('realtime-js')) {
            return 'vendor-supabase'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    react(),
    precacheManifestPlugin(),
    buildVersionPlugin(),
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
