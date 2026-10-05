import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to the backend so the browser sees one origin
// (lets the SameSite=Strict refresh-token cookie work without CORS cookie gymnastics).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:4000',
    },
  },
});
