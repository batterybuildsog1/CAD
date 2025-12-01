import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: ['geometry-wasm']
  },
  build: {
    target: 'esnext'
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});
