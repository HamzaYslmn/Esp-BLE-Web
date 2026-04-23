import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Deployed to GitHub Pages under https://<user>.github.io/Esp32-BLE-Control-Web/
// so production assets and the PWA manifest must be rooted at /Esp32-BLE-Control-Web/.
// Local `pnpm dev` keeps the simple root-relative base.
const BASE = process.env.NODE_ENV === 'production'
  ? '/Esp32-BLE-Control-Web/'
  : '/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Esp32 BLE Relay',
        short_name: 'Esp32 BLE',
        description: 'Offline PWA to control an ESP32 over Web Bluetooth.',
        start_url: BASE,
        scope:     BASE,
        id:        BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#131316',
        theme_color: '#131316',
        icons: [
          { src: 'pwa-64x64.png',             sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png',           sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',           sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: BASE + 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      devOptions: {
        enabled: true,         // also serve the SW + manifest under `pnpm dev`
        type: 'module',
        navigateFallback: '/index.html',
      },
    }),
  ],
});
