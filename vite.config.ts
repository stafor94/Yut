import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { hoistTrapPlacementHelpers } from './src/build/hoistTrapPlacementHelpers';

function hoistAppTrapPlacementHelpers(): Plugin {
  return {
    name: 'hoist-app-trap-placement-helpers',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/app/App.tsx')) return null;
      return {
        code: hoistTrapPlacementHelpers(source),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [hoistAppTrapPlacementHelpers(), react()],
  base: '/Yut/',
});
