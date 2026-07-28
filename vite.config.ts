import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function readBuildVersion(command: string) {
  if (command === 'serve') return 'development';
  const githubSha = String(process.env.GITHUB_SHA ?? '').trim();
  if (githubSha) return githubSha;
  const explicitVersion = String(process.env.VITE_APP_VERSION ?? '').trim();
  if (explicitVersion) return explicitVersion;
  return `local-${Date.now()}`;
}

function emitAppVersionManifest(version: string): Plugin {
  return {
    name: 'emit-app-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const version = readBuildVersion(command);
  return {
    plugins: [react(), emitAppVersionManifest(version)],
    base: '/Yut/',
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
  };
});
