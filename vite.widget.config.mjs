import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    cssInjectedByJs()
  ],
  define: {
    // Safe property lookup so the SDK doesn't throw before WxCC Desktop sets this global.
    AGENTX_SERVICE: 'window.AGENTX_SERVICE'
  },
  build: {
    lib: {
      entry: resolve('src/widget.js'),
      name: 'WxccSignatureWidget',
      fileName: 'widget',
      formats: ['iife']
    },
    outDir: 'dist',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'widget.js'
      }
    }
  }
});
