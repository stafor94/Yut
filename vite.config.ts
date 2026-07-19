import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { hoistTrapPlacementHelpers, replaceUnsafeAppStorageReads } from './src/build/hoistTrapPlacementHelpers';

function hardenAppRenderSource(): Plugin {
  return {
    name: 'harden-app-render-source',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/app/App.tsx')) return null;
      return {
        code: replaceUnsafeAppStorageReads(hoistTrapPlacementHelpers(source)),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [hardenAppRenderSource(), react()],
  base: '/Yut/',
});
