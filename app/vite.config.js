import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline' || !!process.env.OFFLINE;
  return {
  define: { __OFFLINE__: JSON.stringify(offline) },
  plugins: offline ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: {
    target: 'es2022',
    assetsInlineLimit: offline ? 100000000 : 4096,
    chunkSizeWarningLimit: 4000
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } }
  };
});
