import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In live mode the browser calls /api/* on the Vite dev server, which forwards
// to FastAPI. This avoids CORS during development and the demo.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target, changeOrigin: true } },
    },
    preview: {
      port: 4173,
      proxy: { '/api': { target, changeOrigin: true } },
    },
    worker: { format: 'es' },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
