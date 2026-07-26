import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

function replaceExactly(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`${label}: expected source was not found`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`${label}: expected source was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const appPath = 'src/app/App.tsx';
let app = readFileSync(appPath, 'utf8');
app = replaceExactly(
  app,
  "import { playSoundEffect, type SoundEffect } from '../shared/audio/sound';",
  "import { playSoundEffect, type SoundEffect } from '../shared/audio/sound';\nimport { readStorageText } from '../shared/storage/readStorageText';",
  'App storage helper import',
);
app = replaceExactly(
  app,
  "  const isTrapNodeOccupied = (nodeId: string) => pieces.some((piece) => piece.nodeId === nodeId && piece.started && !piece.finished);\n  const getTrapCandidateNodeIds = (nodeId: string) => getAdjacentBoardNodeIds(nodeId).filter((candidateNodeId) => candidateNodeId !== 'n01' && !isTrapNodeOccupied(candidateNodeId));",
  "  function isTrapNodeOccupied(nodeId: string) {\n    return pieces.some((piece) => piece.nodeId === nodeId && piece.started && !piece.finished);\n  }\n\n  function getTrapCandidateNodeIds(nodeId: string) {\n    return getAdjacentBoardNodeIds(nodeId).filter((candidateNodeId) => candidateNodeId !== 'n01' && !isTrapNodeOccupied(candidateNodeId));\n  }",
  'App trap helper declarations',
);
app = replaceExactly(
  app,
  "window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? ''",
  "readStorageText(() => window.localStorage, STORAGE_KEYS.activeRoomId)",
  'App active room storage read',
);
writeFileSync(appPath, app);

writeFileSync('vite.config.ts', `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  base: '/Yut/',\n});\n`);

writeFileSync('src/shared/storage/readStorageText.ts', `export interface StorageTextReader {\n  getItem(key: string): string | null;\n}\n\nexport function readStorageText(\n  getStorage: () => StorageTextReader | null | undefined,\n  key: string,\n  fallback = '',\n) {\n  try {\n    return getStorage()?.getItem(key) ?? fallback;\n  } catch {\n    return fallback;\n  }\n}\n`);

const tsconfigPath = 'tsconfig.test.json';
const testConfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
testConfig.include = testConfig.include.filter((entry) => entry !== 'src/build/hoistTrapPlacementHelpers.ts');
if (!testConfig.include.includes('src/shared/storage/readStorageText.ts')) {
  testConfig.include.push('src/shared/storage/readStorageText.ts');
}
writeFileSync(tsconfigPath, `${JSON.stringify(testConfig, null, 2)}\n`);

writeFileSync('tests/unit/hoistTrapPlacementHelpers.test.ts', `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\nimport { readStorageText } from '../../src/shared/storage/readStorageText';\n\ntest('reads browser storage text and uses the fallback for unavailable storage', () => {\n  assert.equal(readStorageText(() => ({ getItem: () => 'room-a' }), 'activeRoomId'), 'room-a');\n  assert.equal(readStorageText(() => ({ getItem: () => null }), 'activeRoomId'), '');\n  assert.equal(readStorageText(() => { throw new Error('storage unavailable'); }, 'activeRoomId'), '');\n  assert.equal(readStorageText(() => ({ getItem: () => { throw new Error('read blocked'); } }), 'activeRoomId', 'fallback'), 'fallback');\n});\n\ntest('keeps trap helpers and storage safety in normal TypeScript product source', () => {\n  const appSource = readFileSync('src/app/App.tsx', 'utf8');\n  const viteSource = readFileSync('vite.config.ts', 'utf8');\n\n  assert.ok(appSource.includes('function isTrapNodeOccupied(nodeId: string)'));\n  assert.ok(appSource.includes('function getTrapCandidateNodeIds(nodeId: string)'));\n  assert.equal(appSource.includes('const isTrapNodeOccupied ='), false);\n  assert.ok(appSource.includes('readStorageText(() => window.localStorage, STORAGE_KEYS.activeRoomId)'));\n  assert.equal(viteSource.includes('transform(source, id)'), false);\n  assert.equal(viteSource.includes('hoistTrapPlacementHelpers'), false);\n  assert.equal(viteSource.includes('replaceUnsafeAppStorageReads'), false);\n  assert.equal(viteSource.includes('map: null'), false);\n});\n\ntest('keeps the offline timeout counter aligned with the authoritative timeout policy after controller extraction', () => {\n  const appSource = readFileSync('src/app/App.tsx', 'utf8');\n  const itemControllerSource = readFileSync('src/app/controllers/useItemController.ts', 'utf8');\n\n  assert.ok(appSource.includes('getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], TURN_ACTION_TIMEOUT_MS)'));\n  assert.ok(appSource.includes('getTurnActionTimeoutMsForCount(turnActionTimeoutPenaltyBySeatId[seatId], ITEM_PROMPT_TIMEOUT_MS)'));\n  assert.ok(appSource.includes('const nextCount = incrementTurnActionTimeoutCount(current[seatId]);'));\n  assert.ok(appSource.includes('if (nextCount >= 2) setAutoPlayBySeatId'));\n  assert.ok(appSource.includes('if (!seatId || activeRoomId) return;'));\n\n  const onlinePromptStart = appSource.indexOf('if (activeRoomId) {', appSource.indexOf('if (!itemPromptTiming) return undefined;'));\n  const offlinePromptTimeout = appSource.indexOf('const timeoutMs = getItemPromptTimeoutMs(localSeatId);');\n  assert.ok(onlinePromptStart >= 0 && offlinePromptTimeout > onlinePromptStart);\n  assert.equal(appSource.slice(onlinePromptStart, offlinePromptTimeout).includes('markTurnActionTimedOut'), false);\n\n  const onlineSkipBranch = itemControllerSource.indexOf('if (params.activeRoomId) {');\n  const offlinePenaltyClear = itemControllerSource.indexOf('params.clearTurnActionTimeoutPenalty(params.localSeatId);');\n  assert.ok(onlineSkipBranch >= 0 && offlinePenaltyClear > onlineSkipBranch);\n  assert.ok(appSource.includes('onSkipItemPrompt={skipItemPrompt}'));\n});\n`);

if (existsSync('src/build/hoistTrapPlacementHelpers.ts')) rmSync('src/build/hoistTrapPlacementHelpers.ts');
rmSync('scripts/p0-pr1-bootstrap.mjs');
rmSync('.github/workflows/p0-pr1-bootstrap.yml');
