from pathlib import Path

ownership_path = Path('src/app/flows/localMoveOwnership.ts')
ownership = ownership_path.read_text()
old_helper = """export function withLocalMovePiecesFallback(
  state: Record<string, unknown> | null,
  fallbackPieces: unknown[],
): Record<string, unknown> | null {
  const localState = state as LocalMoveState | null;
  if (!localState
    || Array.isArray(localState.pieces)
    || Array.isArray(localState[LOCAL_MOVE_PIECES])
    || !Array.isArray(fallbackPieces)) {
    return localState;
  }
  return { ...localState, pieces: fallbackPieces };
}
"""
new_helper = """export function withLocalMovePiecesFallback(
  state: Record<string, unknown> | null,
  fallbackPieces: unknown[],
): Record<string, unknown> | null {
  const localState = state as LocalMoveState | null;
  if (!localState || !Array.isArray(fallbackPieces)) return localState;
  if (Array.isArray(localState.pieces)
    && Object.prototype.propertyIsEnumerable.call(localState, 'pieces')) {
    return localState;
  }
  return { ...localState, pieces: fallbackPieces };
}
"""
if old_helper not in ownership:
    raise SystemExit('existing local move pieces fallback helper not found')
ownership = ownership.replace(old_helper, new_helper, 1)
ownership_path.write_text(ownership)

test_path = Path('tests/unit/localMoveHiddenPieces.test.ts')
tests = test_path.read_text()
test_name = "restores enumerable rendered pieces when hidden pieces have a symbol backup"
if test_name not in tests:
    tests += """

test('restores enumerable rendered pieces when hidden pieces have a symbol backup', () => {
  const firstMove = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: {
      ...makeOnlineMoveState(),
      stackedRollMode: true,
      roll: { name: MO, steps: 5, bonus: true },
    },
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:hidden`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(firstMove);
  assert.equal(Object.prototype.propertyIsEnumerable.call(firstMove.finalState, 'pieces'), false);
  const restored = withLocalMovePiecesFallback(firstMove.finalState, firstMove.record.finalPieces);
  assert.ok(restored);
  assert.equal(Object.prototype.propertyIsEnumerable.call(restored, 'pieces'), true);
  assert.equal(restored.pieces, firstMove.record.finalPieces);
});
"""
test_path.write_text(tests)
