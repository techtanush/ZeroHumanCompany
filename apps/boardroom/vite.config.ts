import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Boardroom talks to the kernel through /v1; in dev Vite proxies it so the
// bearer token stays in one place and there is no CORS dance.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: process.env.KERNEL_URL ?? 'http://localhost:4000', changeOrigin: true },
      '/health': { target: process.env.KERNEL_URL ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
