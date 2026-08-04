import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withLocalMovePiecesFallback } from '../../src/app/flows/localMoveOwnership';

const pendingSource = readFileSync('src/app/hooks/usePendingRemoteActions.ts', 'utf8');
const appSource = readFileSync('src/app/App.tsx', 'utf8');
const ownershipSource = readFileSync('src/app/flows/localMoveOwnership.ts', 'utf8');
const captureSource = readFileSync('src/app/flows/captureAnimation.ts', 'utf8');
const screenSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');
const boardSource = readFileSync('src/app/containers/GameBoardSection.tsx', 'utf8');
const reducerSource = readFileSync('src/features/room/services/roomAuthoritativeReducer.ts', 'utf8');

test('pending membership is a pure Set lookup and move preparation cannot be ignored', () => {
  assert.doesNotMatch(pendingSource, /class PendingLocalRemoteActionSet/);
  assert.match(pendingSource, /pendingLocalRemoteActionsRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(pendingSource, /if \(!ensureMoveActionClaimed\(actionKey\)\) \{\s*throw new PendingLocalMoveStartError\(actionKey, 'claim-rejected'\)/);
  assert.match(pendingSource, /!preparePendingLocalMoveOwnership\(actionKey\)[\s\S]*releaseMoveActionClaim\(actionKey\);\s*throw new PendingLocalMoveStartError\(actionKey, 'ownership-rejected'\)/);
  assert.ok(
    pendingSource.indexOf('preparePendingLocalMoveOwnership(actionKey)')
      < pendingSource.indexOf('pendingLocalRemoteActionsRef.current.add(actionKey)'),
    'ownership must be prepared before pending registration',
  );
  assert.match(pendingSource, /syncPendingLocalRemoteActionCount\(\);\s*return true;/);
});

test('current readiness state and pieces are used for ownership preparation', () => {
  const globalState = globalThis as typeof globalThis & { __YUT_DEBUG_STATE__?: Record<string, unknown> };
  const previousDiagnostic = globalState.__YUT_DEBUG_STATE__;
  globalState.__YUT_DEBUG_STATE__ = {
    selectedRollStackIndex: 1,
    rollStackClosed: true,
    roll: { name: '개', steps: 2, bonus: false },
    pieces: ['diagnostic-piece'],
  };
  try {
    const result = withLocalMovePiecesFallback({
      playMode: 'individual',
      pieceCount: 4,
      stackedRollMode: true,
      pieces: ['stale-piece'],
      selectedRollStackIndex: null,
    }, ['current-piece']);
    assert.ok(result);
    assert.equal(result.selectedRollStackIndex, 1);
    assert.equal(result.rollStackClosed, true);
    assert.deepEqual(result.pieces, ['current-piece']);
  } finally {
    if (previousDiagnostic) globalState.__YUT_DEBUG_STATE__ = previousDiagnostic;
    else delete globalState.__YUT_DEBUG_STATE__;
  }
  assert.match(ownershipSource, /findActive\(\)/);
});

test('manual and automatic movement retain the same readiness-driven moveSelectedPiece path', () => {
  assert.match(appSource, /onMoveSelectedPiece=\{\(\) => moveSelectedPiece\(\)\}/);
  assert.match(appSource, /\[activeRoomId, activeSeat, canRequestMove,[\s\S]*selectedPieceId,[\s\S]*roll/);
  assert.match(appSource, /sort\(\(left, right\) => left\.label\.localeCompare\(right\.label, undefined, \{ numeric: true \}\)\)\[0\]/);
  assert.match(appSource, /if \(activeRoomId\) \{\s*if \(!canRequestMove\) return;\s*void moveSelectedPiece\(\);/);
  assert.match(appSource, /const canRequestMove = Boolean\(canSubmitTurnAction && !hasPendingOnlineMoveRequest/);
  assert.match(appSource, /const canUseMoveButton = canRequestMove;/);
});

test('capture presentation uses one stable key across local, authoritative, and recovery paths', () => {
  assert.match(reducerSource, /presentationKey: clientActionId/);
  assert.match(captureSource, /localMoveLedger\.findActive\(\)\?\.clientMutationId/);
  assert.match(captureSource, /presentationKey: activeLocalMoveKey \|\| params\.presentationKey/);
  assert.match(screenSource, /presentedCaptureKeysRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(screenSource, /captureEffect\.presentationKey \|\| `capture-effect:\$\{captureEffect\.id\}`/);
  assert.match(screenSource, /const presentationKey = `capture-recovery:/);
  assert.doesNotMatch(boardSource, /CAPTURE_DUPLICATE_WINDOW_MS/);
  assert.doesNotMatch(boardSource, /getCapturePresentationSignature/);
  assert.doesNotMatch(boardSource, /createCaptureVisualEffect/);
  assert.match(boardSource, /presentedCaptureKeysRef\.current\.has\(queuedEffect\.presentationKey\)/);
  assert.match(boardSource, /key: `capture:\$\{queuedEffect\.presentationKey\}`/);
});
