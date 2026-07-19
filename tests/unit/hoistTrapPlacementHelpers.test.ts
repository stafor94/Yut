import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  SAFE_ACTIVE_ROOM_STORAGE_READ,
  TRAP_PLACEMENT_HELPER_CONST_BLOCK,
  UNSAFE_ACTIVE_ROOM_STORAGE_READ,
  hoistTrapPlacementHelpers,
  replaceUnsafeAppStorageReads,
} from '../../src/build/hoistTrapPlacementHelpers';

function transpileFixture(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function executeFixture(source: string) {
  const output = transpileFixture(source);
  return Function(`${output}\nreturn renderTrapPrompt();`)() as string[];
}

function executeStorageFixture(source: string, getItem: (key: string) => string | null) {
  const output = transpileFixture(source);
  const browserWindow = { localStorage: { getItem } };
  const storageKeys = { activeRoomId: 'yut-online:activeRoomId' };
  return Function('window', 'STORAGE_KEYS', `${output}\nreturn props.resumableRoomId;`)(browserWindow, storageKeys) as string;
}

const trapPromptFixture = `
function getAdjacentBoardNodeIds() {
  return ['n05'];
}

function renderTrapPrompt() {
  const pieces = [{ nodeId: 'n06', started: true, finished: false }];
  const candidateNodeIds = getTrapCandidateNodeIds('n06');
${TRAP_PLACEMENT_HELPER_CONST_BLOCK}
  return candidateNodeIds;
}
`;

test('reproduces the after-move trap prompt temporal dead zone', () => {
  assert.throws(() => executeFixture(trapPromptFixture), /before initialization/);
});

test('hoists trap helpers so the prompt can render before their source position', () => {
  const transformed = hoistTrapPlacementHelpers(trapPromptFixture);

  assert.deepEqual(executeFixture(transformed), ['n05']);
  assert.equal(transformed.includes('const getTrapCandidateNodeIds'), false);
  assert.equal(transformed.includes('function getTrapCandidateNodeIds'), true);
});

test('fails loudly when the guarded App helper source pattern changes', () => {
  assert.throws(
    () => hoistTrapPlacementHelpers('export function App() {}'),
    /helper declarations were not found/,
  );
});

test('replaces the render-time active room localStorage read without introducing a free identifier', () => {
  const source = `const props = { resumableRoomId: ${UNSAFE_ACTIVE_ROOM_STORAGE_READ} };`;
  const transformed = replaceUnsafeAppStorageReads(source);

  assert.equal(transformed, `const props = { resumableRoomId: ${SAFE_ACTIVE_ROOM_STORAGE_READ} };`);
  assert.notEqual(transformed, source);
  assert.equal(transformed.includes('getStoredText'), false);
  assert.equal(executeStorageFixture(transformed, () => 'room-a'), 'room-a');
  assert.equal(executeStorageFixture(transformed, () => null), '');
  assert.equal(executeStorageFixture(transformed, () => { throw new Error('storage unavailable'); }), '');
});

test('fails loudly when the guarded App storage source pattern changes', () => {
  assert.throws(
    () => replaceUnsafeAppStorageReads('export function App() {}'),
    /active-room localStorage read was not found/,
  );
});

test('keeps timeout penalties limited to offline local actions after controller extraction', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const timingSource = readFileSync('src/app/config/gameTimings.ts', 'utf8');
  const itemControllerSource = readFileSync('src/app/controllers/useItemController.ts', 'utf8');

  assert.ok(timingSource.includes('export const PENALTY_TURN_ACTION_TIMEOUT_MS = 10000;'));
  assert.ok(appSource.includes("const getTurnActionTimeoutMs = (seatId = activeSeat?.id ?? '') => activeRoomId ? TURN_ACTION_TIMEOUT_MS"));
  assert.ok(appSource.includes('const getItemPromptTimeoutMs = (seatId = localSeatId) => activeRoomId ? ITEM_PROMPT_TIMEOUT_MS'));
  assert.ok(appSource.includes('if (!seatId || activeRoomId) return;'));

  const onlinePromptStart = appSource.indexOf('if (activeRoomId) {', appSource.indexOf('if (!itemPromptTiming) return undefined;'));
  const offlinePromptTimeout = appSource.indexOf('const timeoutMs = getItemPromptTimeoutMs(localSeatId);');
  assert.ok(onlinePromptStart >= 0 && offlinePromptTimeout > onlinePromptStart);
  assert.equal(appSource.slice(onlinePromptStart, offlinePromptTimeout).includes('markTurnActionTimedOut'), false);

  const onlineSkipBranch = itemControllerSource.indexOf('if (params.activeRoomId) {');
  const offlinePenaltyClear = itemControllerSource.indexOf('params.clearTurnActionTimeoutPenalty(params.localSeatId);');
  assert.ok(onlineSkipBranch >= 0 && offlinePenaltyClear > onlineSkipBranch);
  assert.ok(appSource.includes('onSkipItemPrompt={skipItemPrompt}'));
});
