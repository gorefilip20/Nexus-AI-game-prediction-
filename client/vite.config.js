import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:5000';

// Source maps are off by default: they ship readable source to anyone who opens
// devtools. Set BUILD_SOURCEMAP=hidden to emit maps for an error tracker without
// referencing them from the bundle, and exclude *.map when you upload the build.
const sourcemap = process.env.BUILD_SOURCEMAP === 'hidden' ? 'hidden' : false;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  build: {
    // Vite's default target is modern-baseline. Naming an older target here
    // also lowers the CSS target, which downlevels Tailwind v4's modern colour
    // syntax into much longer fallbacks.
    sourcemap,
    cssCodeSplit: true,
    // Vite 8 minifies with oxc by default; naming a minifier explicitly would
    // pull in a separate toolchain for no gain.
    minify: true,
    chunkSizeWarningLimit: 300,
    assetsInlineLimit: 4096,

    rollupOptions: {
      output: {
        /**
         * Split rarely-changing dependencies into their own chunks.
         *
         * React changes only on upgrade, so isolating it means
         * a routine app deploy invalidates the small app chunk instead of forcing
         * every returning visitor to re-download the whole bundle.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          return undefined;
        },
        // Content-hashed names so assets can be cached immutably.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },

  preview: {
    port: 4173,
  },
});
