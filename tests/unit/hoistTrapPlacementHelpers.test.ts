import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {
  SAFE_ACTIVE_ROOM_STORAGE_READ,
  TRAP_PLACEMENT_HELPER_CONST_BLOCK,
  UNSAFE_ACTIVE_ROOM_STORAGE_READ,
  hoistTrapPlacementHelpers,
  replaceUnsafeAppStorageReads,
} from '../../src/build/hoistTrapPlacementHelpers';

function executeFixture(source: string) {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  return Function(`${output}\nreturn renderTrapPrompt();`)() as string[];
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

test('replaces the render-time active room localStorage read with the safe preference reader', () => {
  const source = `const props = { resumableRoomId: ${UNSAFE_ACTIVE_ROOM_STORAGE_READ} };`;
  const transformed = replaceUnsafeAppStorageReads(source);

  assert.equal(transformed.includes(UNSAFE_ACTIVE_ROOM_STORAGE_READ), false);
  assert.equal(transformed.includes(SAFE_ACTIVE_ROOM_STORAGE_READ), true);
});

test('fails loudly when the guarded App storage source pattern changes', () => {
  assert.throws(
    () => replaceUnsafeAppStorageReads('export function App() {}'),
    /active-room localStorage read was not found/,
  );
});
