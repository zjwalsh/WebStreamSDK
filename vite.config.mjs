import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  define: {
    // @wxcc-desktop/sdk references this global at module load time.
    // It's injected by the WxCC Desktop shell in the parent window, not the iframe.
    // Replacing with a safe property lookup lets the SDK fall back to postMessage.
    AGENTX_SERVICE: 'window.AGENTX_SERVICE'
  },
  build: { outDir: 'dist' }
});
