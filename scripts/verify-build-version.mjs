import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const manifestPath = path.join(distDir, 'version.json');
const manifestText = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText);
const version = typeof manifest?.version === 'string' ? manifest.version.trim() : '';

if (!version) throw new Error('dist/version.json에 유효한 version 값이 없습니다.');

const assetsDir = path.join(distDir, 'assets');
const assetNames = await readdir(assetsDir);
const javascriptAssets = assetNames.filter((name) => name.endsWith('.js'));
if (!javascriptAssets.length) throw new Error('dist/assets에서 JavaScript 번들을 찾지 못했습니다.');

let bundleContainsVersion = false;
for (const assetName of javascriptAssets) {
  const source = await readFile(path.join(assetsDir, assetName), 'utf8');
  if (source.includes(version)) {
    bundleContainsVersion = true;
    break;
  }
}

if (!bundleContainsVersion) {
  throw new Error(`version manifest와 동일한 빌드 버전을 JavaScript 번들에서 찾지 못했습니다: ${version}`);
}

console.log(`[build-version] manifest와 번들 버전 일치: ${version}`);
