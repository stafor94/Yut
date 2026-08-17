import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const appSource = readFileSync(resolve('src/app/App.tsx'), 'utf8');

test('stalled move recovery preserves accepted pending move ownership across every recovery entry point', () => {
  const resolutionStart = appSource.indexOf('const getStalledTurnSyncResolution');
  const resolutionEnd = appSource.indexOf('\n\n  useEffect(() => {', resolutionStart);
  assert.notEqual(resolutionStart, -1);
  assert.notEqual(resolutionEnd, -1);
  const resolutionBody = appSource.slice(resolutionStart, resolutionEnd);
  const resolverPendingGuard = "if (hasPendingCurrentTurnAction('move_piece', activeSeat.id))";
  assert.ok(resolutionBody.includes(resolverPendingGuard));
  assert.ok(resolutionBody.includes("reason: 'pending-move-piece'"));

  const recoveryStart = appSource.indexOf('async function recoverStalledTurnMove');
  const recoveryEnd = appSource.indexOf('\n\n  useEffect(() => {', recoveryStart);
  assert.notEqual(recoveryStart, -1);
  assert.notEqual(recoveryEnd, -1);
  const recoveryBody = appSource.slice(recoveryStart, recoveryEnd);
  const finalPendingGuard = "if (hasPendingCurrentTurnAction('move_piece', activeSeat.id)) return false;";
  const recoveryClaim = 'turnRecoveryInFlightRef.current = { roomId: activeRoomId, token: recoveryToken };';
  const recoveryDiagnostic = "recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-started'";
  assert.ok(recoveryBody.includes(finalPendingGuard));
  assert.ok(recoveryBody.indexOf(finalPendingGuard) < recoveryBody.indexOf(recoveryClaim));
  assert.ok(recoveryBody.indexOf(finalPendingGuard) < recoveryBody.indexOf(recoveryDiagnostic));
});
