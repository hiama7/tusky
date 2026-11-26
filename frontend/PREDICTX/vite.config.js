import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The React app calls the API on the same origin (/api, /uploads). In development
// Vite forwards those requests to the Express backend, so the refresh-token cookie
// stays first-party (SameSite=Strict) and no CORS is involved.
const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:5000';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/uploads': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/uploads': { target: API_TARGET, changeOrigin: false },
    },
  },
  // Main bundle includes React, Chart.js and the icon set; admin pages are split out.
  build: { chunkSizeWarningLimit: 700 },
});
