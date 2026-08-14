import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('capture approach wiring waits for the matching attacker transition while preserving settlement contracts', () => {
  const boardSectionSource = readFileSync('src/app/containers/GameBoardSection.tsx', 'utf8');
  const gameBoardSource = readFileSync('src/features/game/components/GameBoard.tsx', 'utf8');
  const moveFrameCompletionSource = readFileSync('src/app/flows/moveFrameCompletion.ts', 'utf8');
  const soundSource = readFileSync('src/shared/audio/sound.ts', 'utf8');

  assert.match(boardSectionSource, /const settledPresentationPiecesRef = useRef<BoardPiece\[\]>\(clonePieces\(pieces\)\)/);
  assert.match(boardSectionSource, /const stablePieces = settledPresentationPiecesRef\.current\.some\(\(piece\) => piece\.id === movingPieceId\)[\s\S]*?createMovePresentationSession\(stablePieces, movingPieceId, getPieceSideKey\)/);
  assert.match(boardSectionSource, /settledPresentationPiecesRef\.current = settledPieces;[\s\S]*?setPresentedPieces\(settledPieces\)/);

  assert.match(boardSectionSource, /const previewDestinationNodeIdRef = useRef\(previewNodeIds\[previewNodeIds\.length - 1\] \?\? ''\)/);
  assert.match(boardSectionSource, /const activeMoveDestinationRef = useRef\(\{ pieceId: '', nodeId: '' \}\)/);
  assert.match(boardSectionSource, /activeMoveDestinationRef\.current = \{\s*pieceId: movingPieceId,\s*nodeId: captureDestinationNodeId \|\| previewDestinationNodeIdRef\.current,\s*\}/);
  assert.match(boardSectionSource, /const retainedDestinationNodeId = activeMoveDestinationRef\.current\.pieceId === movingPieceId[\s\S]*?captureDestinationNodeId: retainedDestinationNodeId \|\| captureDestinationNodeId/);
  assert.match(boardSectionSource, /const presentedCaptureDestinationNodeId = activeMoveDestinationRef\.current\.pieceId === presentedMovingPieceId[\s\S]*?: captureDestinationNodeId/);
  assert.match(boardSectionSource, /captureDestinationNodeId=\{presentedCaptureDestinationNodeId\}/);
  assert.match(boardSectionSource, /setPresentedMovingPieceId\(''\);\s*setPresentedMovingFrameKey\(''\);[\s\S]*?activeMoveDestinationRef\.current = \{ pieceId: '', nodeId: '' \}/);

  assert.match(boardSectionSource, /createMoveFrameCompletionGate\(\{ pieceId: movingPieceId, frameKey: framePresentationKey \}\)/);
  assert.match(boardSectionSource, /moveFrameCompletionGateRef\.current = frameCompletionGate;[\s\S]*?completedMoveFrameRef\.current = \{ pieceId: '', frameKey: '' \};[\s\S]*?setPresentedMovingFrameKey\(framePresentationKey\);[\s\S]*?setPresentedPieces\(framePieces\)/);
  assert.match(boardSectionSource, /const queueFrameKey = framePresentationKey \|\| acceptedFrame\.frameKey/);
  assert.match(boardSectionSource, /if \(!frameCompletionGate\) \{\s*await waitForGameAnimation\(MOVE_FRAME_PRESENTATION_MS\);\s*return;\s*\}\s*const completionSource = await frameCompletionGate\.promise/);
  assert.match(boardSectionSource, /if \(completionSource !== 'cancelled'\) \{[\s\S]*?completedMoveFrameRef\.current = \{ pieceId: movingPieceId, frameKey: framePresentationKey \};[\s\S]*?const queuedEffect = pendingCaptureEffectRef\.current;[\s\S]*?if \(queuedEffect\) \{[\s\S]*?pendingCaptureEffectRef\.current = null;[\s\S]*?queueCaptureEffect\(queuedEffect\);/);
  assert.match(boardSectionSource, /gate\.armFallback\(\{ pieceId, frameKey \}, durationMs\)/);
  assert.match(boardSectionSource, /const completedMoveFrameRef = useRef\(\{ pieceId: '', frameKey: '' \}\)/);
  assert.match(boardSectionSource, /completedMoveFrameRef\.current = \{ pieceId, frameKey \};\s*gate\.complete\(\{ pieceId, frameKey \}\);/);
  assert.match(boardSectionSource, /const queuedEffect = pendingCaptureEffectRef\.current;\s*if \(!queuedEffect\) return;\s*pendingCaptureEffectRef\.current = null;\s*queueCaptureEffect\(queuedEffect\);/);
  assert.match(boardSectionSource, /const completedFrame = completedMoveFrameRef\.current;\s*if \(completedFrame\.pieceId === movingPieceId[\s\S]*?completedFrame\.frameKey === presentedMovingFrameKey\) \{\s*queueCaptureEffect\(queuedEffect\);\s*return;\s*\}/);
  assert.match(boardSectionSource, /gameAnimationQueue\.onReset\?\.\(cancelActiveMoveFrame\)/);
  assert.match(boardSectionSource, /moveGenerationRef\.current \+= 1;[\s\S]*?moveFrameCompletionGateRef\.current\?\.cancel\(\)/);

  assert.match(moveFrameCompletionSource, /setTimeout\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?callback\(\);/);
  assert.match(moveFrameCompletionSource, /cancelAnimationFrame\(animationFrameId\)/);

  assert.match(gameBoardSource, /event\.target !== event\.currentTarget/);
  assert.match(gameBoardSource, /piece\.id !== movingPieceId/);
  assert.match(gameBoardSource, /onTransitionRun=/);
  assert.match(gameBoardSource, /movingTransitionIdentityQueueRef\.current\.remember\(identity\)/);
  assert.match(gameBoardSource, /movingTransitionIdentityQueueRef\.current\.consume\(piece\.id, event\.propertyName\)/);
  assert.match(gameBoardSource, /activeMovingFramePropertiesRef\.current\.size > 0/);
  assert.match(gameBoardSource, /completedMovingFrameKeyRef\.current === movingPieceFrameKey/);
  assert.match(gameBoardSource, /isMovePositionTransitionProperty\(event\.propertyName\)/);
  assert.match(gameBoardSource, /onMovingPieceTransitionComplete\?\.\(piece\.id, movingPieceFrameKey\)/);
  assert.match(gameBoardSource, /window\.getComputedStyle\(element\)/);
  assert.match(gameBoardSource, /getMoveFrameTransitionMs\(window\.getComputedStyle\(element\)\)/);
  assert.match(gameBoardSource, /const durationMs = getMoveFrameTransitionMs\(window\.getComputedStyle\(event\.currentTarget\)\)/);
  assert.match(gameBoardSource, /movingFrameTransitionMsRef\.current = durationMs;/);
  assert.match(gameBoardSource, /onMovingPieceTransitionPrepared\?\.\(piece\.id, movingPieceFrameKey, durationMs\)/);

  assert.match(boardSectionSource, /const pendingCaptureFinalizationRef = useRef<\(\(queuedEffect: CaptureVisualEffect\) => void\) \| null>\(null\)/);
  assert.match(boardSectionSource, /getMovePresentationFinalization\(activeSession, settlementPieces, getPieceSideKey\)/);
  assert.match(boardSectionSource, /const queueCaptureThenSettlement = \(queuedEffect: CaptureVisualEffect\) => \{[\s\S]*?queueCaptureEffect\(queuedEffect\);\s*scheduleSettlement\(\);/);
  assert.match(boardSectionSource, /if \(finalization\.capturedPieceIds\.length > 0\) \{[\s\S]*?pendingCaptureFinalizationRef\.current = queueCaptureThenSettlement;\s*return;/);
  assert.match(boardSectionSource, /const finalizeCapture = pendingCaptureFinalizationRef\.current;[\s\S]*?if \(finalizeCapture\) \{[\s\S]*?finalizeCapture\(queuedEffect\);\s*return;/);
  assert.doesNotMatch(boardSectionSource, /createCaptureVisualEffect/);
  assert.doesNotMatch(boardSectionSource, /getCapturePresentationSignature/);
  assert.match(boardSectionSource, /presentedCaptureKeysRef\.current\.has\(queuedEffect\.presentationKey\)/);
  assert.match(boardSectionSource, /window\.setTimeout\(playConfirmedStackSoundEffect, STACK_SOUND_DELAY_MS\)/);
  assert.match(soundSource, /export const playConfirmedStackSoundEffect = \(\) => playSoundEffect\('stack', isStoredSoundEnabled\(\)\)/);
  assert.match(soundSource, /if \(effect === 'stack'\) \{[\s\S]*?onEnded\?\.\(\);[\s\S]*?return undefined;/);
});
