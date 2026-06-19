import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    // Lossless-сжатие ассетов на сборке: пиксель-в-пиксель идентично, только меньше вес.
    // ВАЖНО: НЕ задаём png.quality — иначе sharp включает палитровую квантизацию (lossy, бандинг
    // на градиентах). palette:false + максимальный compressionLevel/effort = чистый lossless zlib.
    ViteImageOptimizer({
      png: { palette: false, compressionLevel: 9, effort: 10 },
      svg: {
        plugins: [
          { name: 'preset-default', params: { overrides: { removeViewBox: false } } },
        ],
      },
    }),
  ],

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
