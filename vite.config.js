import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// `npm run staging` runs this local web app against the hosted staging server. The browser only ever
// talks to localhost: Vite passes API calls and live connections on to staging, so sign-in cookies work.
const STAGING_SERVER = 'https://staging.api.mollama.one';
const STAGING_SITE = 'https://staging.mollama.one';
const toStaging = { target: STAGING_SERVER, changeOrigin: true, headers: { origin: STAGING_SITE } };
// Live connections share their paths with pages, so only connection upgrades are passed on.
const liveToStaging = { ...toStaging, ws: true, bypass: (req) => (req.headers.upgrade ? undefined : req.url) };
const stagingProxy = { '/api': toStaging, '/notifications': liveToStaging, '/devices': liveToStaging };
const stagingValues = {
  'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'),
  'import.meta.env.VITE_WS_BASE_URL': JSON.stringify('ws://localhost:8093')
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 8093,
    proxy: mode === 'staging' ? stagingProxy : undefined
  },
  define: mode === 'staging' ? stagingValues : {},
  optimizeDeps: {
    include: ['mammoth'],
    // Exclude the PDF.js worker from Vite's pre-bundling so the
    // `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
    // pattern in PdfViewer resolves correctly at runtime.
    exclude: ['pdfjs-dist']
  },
  css: {
    // CSS preprocessing
    preprocessorOptions: {
      // Add additional preprocessing options if needed
    },
    // Make sure CSS modules are properly processed
    modules: {
      scopeBehaviour: 'global'
    }
  },
  resolve: {
    alias: {
      // y-monaco@0.1.6 imports monaco-editor's pre-exports-map deep path.
      // monaco-editor >=0.52 maps "./*" to "./esm/vs/*.js", so the legacy
      // specifier resolves to a doubled esm/vs/ path. Rolldown (Vite 8)
      // enforces the exports map where esbuild did not, so rewrite it to the
      // supported subpath. Remove once y-monaco ships a fixed import.
      'monaco-editor/esm/vs/editor/editor.api.js': 'monaco-editor/editor/editor.api.js',
      '@': path.resolve(import.meta.dirname, './src'),
      '@components': path.resolve(import.meta.dirname, './src/components'),
      '@themes': path.resolve(import.meta.dirname, './src/themes'),
      '@contexts': path.resolve(import.meta.dirname, './src/contexts'),
      '@pages': path.resolve(import.meta.dirname, './src/pages'),
      '@styles': path.resolve(import.meta.dirname, './src/styles'),
      '@utils': path.resolve(import.meta.dirname, './src/utils'),
      '@service': path.resolve(import.meta.dirname, './src/service')
    }
  }
}));
