import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      registerType: 'prompt',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,webp,woff2}'],
      },
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: false,
      devOptions: {
        enabled: true,
      },
      srcDir: 'src',
      filename: 'sw.ts',
    }),
  ],
})
