import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/app/App.tsx', 'utf8');
const sceneSource = readFileSync('src/app/components/YutRollScenePhysics.tsx', 'utf8');
const gameScreenSource = readFileSync('src/app/components/GameScreenView.tsx', 'utf8');

test('remote roll sequence derives the result reveal target from authoritative rollResultReadyAt only for the resolved remote path', () => {
  assert.match(appSource, /const authoritativeRollResultReadyAt = Number\(stateAfter\?\.rollResultReadyAt \?\? 0\);/);
  assert.match(appSource, /authoritativeRollResultReadyAt - ONLINE_ROLL_RESULT_HOLD_MS/);
  assert.match(appSource, /playRollAnimationOnce\(sequenceRoll,[\s\S]*authoritativeTimingZone,[\s\S]*resultRevealAt\);/);
  assert.match(appSource, /playResolvedRollAnimationAfterPending\(sequenceRoll,[\s\S]*authoritativeTimingZone\);/);
});

test('resolved roll animation keeps identity separate from authoritative presentation timing', () => {
  assert.match(appSource, /animationStartedAt: presentationStartedAt/);
  assert.match(appSource, /resultRevealAt: authoritativeResultRevealAt/);
  assert.match(appSource, /id: presentationStartedAt/);
});

test('Three frame loop, initial fast-forward, and CSS fallback all consume the same remote timing helper', () => {
  const helperMatches = sceneSource.match(/getRemoteRollMotionElapsedMs\(/g) ?? [];
  assert.ok(helperMatches.length >= 4, `expected shared remote timing helper across render paths, found ${helperMatches.length}`);
  assert.match(sceneSource, /authoritativeResultRevealAt - now/);
  assert.match(sceneSource, /remoteElapsedMs >= REMOTE_ROLL_PRE_RESULT_MS/);
});

test('remote landing sound receives the same authoritative start and reveal target', () => {
  assert.match(gameScreenSource, /animationStartedAt: resolvedAnimation\.animationStartedAt/);
  assert.match(gameScreenSource, /resultRevealAt: resolvedAnimation\.resultRevealAt/);
  assert.match(gameScreenSource, /getRollLandingSoundDelayMs\(rollSoundState, Number\(rollAnimation\.id\)\)/);
});
