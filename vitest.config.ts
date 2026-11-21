import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
// Dieselben Build-Konstanten wie im Production-Build — ansonsten würde der
// Import von src/version.ts (APP_VERSION/BUILD_ID via define) in den Tests
// mit „__APP_VERSION__ is not defined" fallen.
import { APP_DEFINE } from './vite.config'

export default defineConfig({
  plugins: [react()],
  define: APP_DEFINE,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
    // Die Playwright-Specs (e2e/*.spec.ts) sind KEINE Vitest-Tests — sonst
    // würde `npm test` versuchen, sie im jsdom zu laufen.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
