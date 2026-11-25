import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base: './' keeps asset paths relative, so the built dist/ folder
// can be opened with VS Code Live Server or dropped into a PHP project in Stage 2.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Main bundle includes React, Chart.js and the icon set (~170 KB gzipped); admin pages are split out.
  build: { chunkSizeWarningLimit: 700 },
});
