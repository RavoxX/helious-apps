import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  base: '/app/',
  // Keep bundled font files on our origin rather than inlining data URLs blocked by CSP.
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@codemirror') || id.includes('@lezer')) return 'editor-engine';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': { target: 'http://localhost:3000', changeOrigin: false },
      '/oauth': 'http://localhost:3000',
      '/.well-known': 'http://localhost:3000',
    },
  },
});
