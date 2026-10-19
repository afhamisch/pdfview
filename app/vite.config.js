import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const offline = !!process.env.OFFLINE;

export default defineConfig({
  define: { __OFFLINE__: JSON.stringify(offline) },
  plugins: offline ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: {
    target: 'es2022',
    assetsInlineLimit: offline ? 100000000 : 4096,
    chunkSizeWarningLimit: 4000
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } }
});
