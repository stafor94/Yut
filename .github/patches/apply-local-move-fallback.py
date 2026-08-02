from pathlib import Path

ownership_path = Path('src/app/flows/localMoveOwnership.ts')
ownership = ownership_path.read_text()
old = """  const reductionState = getLocalMoveReductionState(state, action);
  const reduction = reduceAuthoritativeGameAction(
"""
new = """  const reductionState = getLocalMoveReductionState(state, action);
  if (!Array.isArray(reductionState.pieces)) return null;
  const reduction = reduceAuthoritativeGameAction(
"""
if old not in ownership:
    raise SystemExit('local move reduction call anchor not found')
ownership = ownership.replace(old, new, 1)
ownership_path.write_text(ownership)

test_path = Path('tests/unit/localMoveHiddenPieces.test.ts')
tests = test_path.read_text()
if "skips local presentation ownership when pieces are unavailable" not in tests:
    tests += """

test('skips local presentation ownership when pieces are unavailable', () => {
  const completeState = makeOnlineMoveState();
  const { pieces: _pieces, ...stateWithoutPieces } = completeState;

  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: stateWithoutPieces,
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:missing-pieces`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.equal(prepared, null);
});
"""
test_path.write_text(tests)
