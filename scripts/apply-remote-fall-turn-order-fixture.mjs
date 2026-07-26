import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function replaceExactly(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`${label}: expected source was not found`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`${label}: expected source was not unique`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const testPath = 'tests/regression/remote-fall-presentation.spec.js';
let source = readFileSync(testPath, 'utf8');
source = replaceExactly(
  source,
  "import { collectScreenState, createRoomFromLobby, joinRoomFromLobby, primeLobbyStorage, runQaStep } from '../helpers/ui.js';",
  "import { collectScreenState, createRoomFromLobby, joinRoomFromLobby, primeLobbyStorage, primeTurnOrderResultQueues, runQaStep } from '../helpers/ui.js';",
  'remote fall helper import',
);
source = replaceExactly(
  source,
  "    const guestContext = await browser.newContext();\n    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });\n    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });",
  "    const guestContext = await browser.newContext();\n    await primeTurnOrderResultQueues(hostContext, { human: ['모'] });\n    await primeTurnOrderResultQueues(guestContext, { human: ['도'] });\n    await primeLobbyStorage(hostContext, { nickname: hostName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });\n    await primeLobbyStorage(guestContext, { nickname: guestName, maxPlayers: '2', playMode: 'individual', itemMode: 'false', pieceCount: '4' });",
  'remote fall deterministic turn order setup',
);
writeFileSync(testPath, source);
rmSync('scripts/apply-remote-fall-turn-order-fixture.mjs');
rmSync('.github/workflows/remote-fall-turn-order-fixture-verify.yml');
rmSync('scripts/remote-fall-turn-order-fixture-trigger.txt');
