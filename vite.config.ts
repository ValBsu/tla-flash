import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
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
        globPatterns: ['**/*.{css,html,ico,js,png,svg,woff2}', '**/pictograms/sclera/index.json', '**/pictograms/makaton/index.json'],
        globIgnores: ['**/pictograms/sclera/*.png', '**/pictograms/makaton/*.png'],
        runtimeCaching: [
          { urlPattern: /\/pictograms\/sclera\/\d+\.png$/, handler: 'CacheFirst', options: { cacheName: 'sclera-images', expiration: { maxEntries: 12000 }, cacheableResponse: { statuses: [200] } } },
          { urlPattern: /\/pictograms\/makaton\/\d+\.png$/, handler: 'CacheFirst', options: { cacheName: 'makaton-images', expiration: { maxEntries: 100 }, cacheableResponse: { statuses: [200] } } },
        ],
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
})
