import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  // Prepare the lazy SQLite dependency before the first export. Discovering it
  // on click can invalidate optimized module URLs already cached by Safari.
  optimizeDeps: { include: ['sql.js'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'TLA Flash',
        short_name: 'TLA Flash',
        description: 'Créer, modifier et imprimer des tableaux de langage augmenté.',
        lang: 'fr',
        theme_color: '#177d73',
        background_color: '#edf1ef',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{css,html,ico,js,png,svg,woff2,wasm,spb}', '**/pictograms/sclera/index.json', '**/pictograms/makaton/index.json'],
        globIgnores: ['**/pictograms/sclera/*.png', '**/pictograms/makaton/*.png'],
        runtimeCaching: [
          // Bump image cache versions when replacing a bank under unchanged filenames.
          { urlPattern: /\/pictograms\/sclera\/\d+\.png(?:\?.*)?$/, handler: 'CacheFirst', options: { cacheName: 'sclera-images-v2', expiration: { maxEntries: 12000, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /\/pictograms\/makaton\/\d+\.png(?:\?.*)?$/, handler: 'CacheFirst', options: { cacheName: 'makaton-images-v2', expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /^https:\/\/static\.arasaac\.org\/pictograms\/\d+\/\d+_500\.png(?:\?.*)?$/, handler: 'CacheFirst', options: { cacheName: 'arasaac-images-v2', expiration: { maxEntries: 2000, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'font-styles-v1', expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\//, handler: 'CacheFirst', options: { cacheName: 'font-files-v1', expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }, cacheableResponse: { statuses: [0, 200] } } },
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
})
