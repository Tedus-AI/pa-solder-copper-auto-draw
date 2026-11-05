import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pa-solder-copper-auto-draw/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
