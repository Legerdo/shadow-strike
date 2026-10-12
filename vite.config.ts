import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    // Phaser itself is ~1.2 MB minified; a single game bundle is expected.
    chunkSizeWarningLimit: 2000,
  },
});
