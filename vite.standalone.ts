import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'standalone',
  publicDir: resolve('public'),
  resolve: { alias: { '@': resolve('.') } },
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: resolve(process.env.CSGO_BUILD_PROFILE==='source'?'release/source-r4/web':'release/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
  server: { strictPort: true },
});
