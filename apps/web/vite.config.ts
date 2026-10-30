import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Local development:
//   EBIKE_API=http://host:port       → a running stack (Caddy); /route and /data pass through
//   EBIKE_BROUTER=http://host:17777  → a bare BRouter; /route is rewritten to /brouter
//   VITE_PMTILES_URL=https://…pmtiles → basemap without a local data volume
const api = process.env.EBIKE_API;
const brouter = process.env.EBIKE_BROUTER;

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'ebike-map',
        short_name: 'ebike-map',
        description: 'E-bike routes and ETAs for Chicago',
        theme_color: '#0b7a4b',
        background_color: '#101412',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        navigateFallbackDenylist: [/^\/route/, /^\/data\//],
        runtimeCaching: [
          // Controls files are versioned and immutable.
          { urlPattern: /\/data\/.*\.controls\.v\d+\.bin$/, handler: 'CacheFirst', options: { cacheName: 'controls' } },
          { urlPattern: /^https:\/\/protomaps\.github\.io\/basemaps-assets\//, handler: 'CacheFirst', options: { cacheName: 'map-assets' } },
        ],
      },
    }),
  ],
  build: {
    // MapLibre is most of the bundle; keep it in its own long-cached chunk (SPEC NFR-1).
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'maplibre', test: /node_modules[\\/](maplibre-gl|@maplibre)/ }] },
      },
    },
  },
  server: {
    proxy: {
      ...(api ? { '/route': api, '/data': api } : {}),
      ...(brouter ? { '/route': { target: brouter, rewrite: (p) => p.replace(/^\/route/, '/brouter') } } : {}),
    },
  },
  test: { environment: 'node' },
});
