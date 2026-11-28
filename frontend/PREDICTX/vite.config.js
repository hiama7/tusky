import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { PAGES } from './src/content/pages.js';

// robots.txt always; a sitemap only when the public address is known (SITE_URL).
function searchFiles() {
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  return {
    name: 'tusky-search-files',
    generateBundle() {
      const robots = ['User-agent: *', 'Disallow: /admin', 'Disallow: /user', 'Disallow: /api'];
      if (site) {
        robots.push(`Sitemap: ${site}/sitemap.xml`);
        const urls = Object.keys(PAGES).filter((p) => !['/login', '/register'].includes(p)).map((p) => `<url><loc>${site}${p}</loc></url>`).join('');
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>` });
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots.join('\n')}\n` });
    },
  };
}

// The React app calls the API on the same origin (/api, /uploads). In development
// Vite forwards those requests to the Express backend, so the refresh-token cookie
// stays first-party (SameSite=Strict) and no CORS is involved.
const API_TARGET = process.env.VITE_API_PROXY || 'http://localhost:5000';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), searchFiles()],
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
