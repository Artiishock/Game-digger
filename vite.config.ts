import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],

  // CRITICAL for Stake Engine: all asset paths must be relative
  // Game is hosted at: https://{team}.cdn.stake-engine.com/{gameID}/{version}/index.html
  base: './',

  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    rollupOptions: {
      output: {
        // Split large vendor chunks for faster CDN delivery
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-pixi':  ['pixi.js'],
          'vendor-state': ['zustand'],
        },
      },
    },
  },

  server: {
    port: 3000,
    host: true,
  },
})
