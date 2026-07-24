import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('move finalization drives inferred capture presentation and confirmed stack audio', () => {
  const boardSectionSource = readFileSync('src/app/containers/GameBoardSection.tsx', 'utf8');
  const soundSource = readFileSync('src/shared/audio/sound.ts', 'utf8');

  assert.match(boardSectionSource, /getMovePresentationFinalization\(activeSession, settlementPieces, getPieceSideKey\)/);
  assert.match(boardSectionSource, /pieceIds: finalization\.capturedPieceIds/);
  assert.match(boardSectionSource, /window\.setTimeout\(playConfirmedStackSoundEffect, STACK_SOUND_DELAY_MS\)/);
  assert.match(soundSource, /export const playConfirmedStackSoundEffect = \(\) => playSoundEffect\('stack', isStoredSoundEnabled\(\)\)/);
  assert.match(soundSource, /if \(effect === 'stack'\) \{[\s\S]*?onEnded\?\.\(\);[\s\S]*?return undefined;/);
});
