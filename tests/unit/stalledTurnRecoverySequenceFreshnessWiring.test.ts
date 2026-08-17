import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');

test('stalled move recovery rejects a stale authoritative sequence before claiming recovery', () => {
  const functionStart = appSource.indexOf('async function recoverStalledTurnMove');
  const functionEnd = appSource.indexOf('\n  useEffect(() => {', functionStart);
  assert.notEqual(functionStart, -1, 'recoverStalledTurnMove must exist');
  assert.notEqual(functionEnd, -1, 'recoverStalledTurnMove body must be bounded');

  const body = appSource.slice(functionStart, functionEnd);
  const freshnessPrefix = "const currentRecoveryPrefix = `${activeRoomId}:${lastAppliedSequenceRef.current}:`;";
  const freshnessGuard = 'if (!recoveryKey.startsWith(currentRecoveryPrefix)) return false;';
  const recoveryClaim = 'turnRecoveryInFlightRef.current = { roomId: activeRoomId, token: recoveryToken };';
  const recoveryDiagnostic = "recordRemoteActionDiagnostic('move_piece', 'stalled-turn-recovery-started'";

  assert.ok(body.includes(freshnessPrefix), 'recovery must bind the current room and authoritative sequence');
  assert.ok(body.includes(freshnessGuard), 'recovery must reject stale scheduled recovery keys');
  assert.ok(body.indexOf(freshnessGuard) < body.indexOf(recoveryClaim), 'freshness must be checked before recovery ownership is claimed');
  assert.ok(body.indexOf(freshnessGuard) < body.indexOf(recoveryDiagnostic), 'freshness must be checked before recovery is reported or submitted');
});
