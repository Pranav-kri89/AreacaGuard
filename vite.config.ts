import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        manifestFilename: 'manifest.json',
        includeAssets: [
          'favicon.ico',
          'favicon-16x16.png',
          'favicon-32x32.png',
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-maskable-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'screenshots/screenshot-mobile.png'
        ],
        manifest: {
          id: '/',
          name: 'ArecaGuard - Areca Nut Farm Dryer',
          short_name: 'ArecaGuard',
          description: 'Autonomous Areca Nut Farm Dryer & Weather Intelligence Control',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          categories: ['weather', 'utilities', 'productivity'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            },
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any'
            }
          ],
          screenshots: [
            {
              src: '/screenshots/screenshot-mobile.png',
              sizes: '720x1280',
              type: 'image/png',
              form_factor: 'narrow',
              label: 'ArecaGuard Farm Dryer Dashboard'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff,woff2}']
        },
        devOptions: {
          enabled: true,
          type: 'module'
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR === 'true' ? false : { overlay: false },
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
