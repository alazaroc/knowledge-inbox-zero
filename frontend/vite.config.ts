import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('react-dom') || id.includes('react-router-dom') || id.includes('react'))
            return 'vendor';
          if (id.includes('aws-amplify')) return 'amplify';
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // "prompt": the user decides when to update (avoids surprise reloads).
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '{{PROJECT_NAME}}',
        short_name: '{{PROJECT_NAME}}',
        description: 'App bootstrapped from the serverless-monorepo-aws-starter.',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|svg|webp|woff2)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'assets', expiration: { maxEntries: 60 } },
          },
        ],
      },
    }),
  ],
});
