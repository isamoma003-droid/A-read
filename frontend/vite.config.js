import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // pdf.js's default build targets only the newest browsers; the legacy build adds the
      // polyfills older Chrome/Safari/Firefox versions need.
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/, replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs' },
    ],
  },
  server: {
    port: 5173,
    // In development the API runs on :5000; the proxy avoids CORS setup.
    proxy: { '/api': 'http://localhost:5000', '/share': 'http://localhost:5000' },
  },
});
