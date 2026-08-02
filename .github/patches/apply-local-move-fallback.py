from pathlib import Path

ownership_path = Path('src/app/flows/localMoveOwnership.ts')
ownership = ownership_path.read_text()
helper = """export function withLocalMovePiecesFallback(
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
anchor = "const getLocalMoveReductionState = (state: LocalMoveState, action: LocalMoveAction): LocalMoveState => {"
if 'export function withLocalMovePiecesFallback(' not in ownership:
    if anchor not in ownership:
        raise SystemExit('local move reduction anchor not found')
    ownership = ownership.replace(anchor, helper + anchor, 1)
ownership_path.write_text(ownership)

controller_path = Path('src/app/controllers/useAuthoritativeGameSyncController.ts')
controller = controller_path.read_text()
old_import = """  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
} from '../flows/localMoveOwnership';"""
new_import = """  makeLocalMoveResultFingerprint,
  prepareLocalMoveOwnership,
  withLocalMovePiecesFallback,
} from '../flows/localMoveOwnership';"""
if 'withLocalMovePiecesFallback,' not in controller:
    if old_import not in controller:
        raise SystemExit('controller local move import anchor not found')
    controller = controller.replace(old_import, new_import, 1)
if 'currentPiecesRef: MutableRefObject<unknown[]>;' not in controller:
    params_anchor = "  applyingSyncedStateRef: MutableRefObject<boolean>;\n"
    if params_anchor not in controller:
        raise SystemExit('controller params anchor not found')
    controller = controller.replace(
        params_anchor,
        params_anchor + "  currentPiecesRef: MutableRefObject<unknown[]>;\n",
        1,
    )
old_state = "      state: latestSyncedStateRef.current as Record<string, unknown> | null,\n      action,"
new_state = "      state: withLocalMovePiecesFallback(\n        latestSyncedStateRef.current as Record<string, unknown> | null,\n        params.currentPiecesRef.current,\n      ),\n      action,"
if old_state in controller:
    controller = controller.replace(old_state, new_state, 1)
elif 'state: withLocalMovePiecesFallback(' not in controller:
    raise SystemExit('prepare local move state anchor not found')
old_deps = "  }, [params.acknowledgePendingLocalRemoteAction, params.activeRoomIdRef]);"
new_deps = "  }, [params.acknowledgePendingLocalRemoteAction, params.activeRoomIdRef, params.currentPiecesRef]);"
if old_deps in controller:
    controller = controller.replace(old_deps, new_deps, 1)
elif new_deps not in controller:
    raise SystemExit('prepare local move dependency anchor not found')
controller_path.write_text(controller)

app_path = Path('src/app/App.tsx')
app = app_path.read_text()
if 'currentPiecesRef: piecesRef,' not in app:
    app_anchor = "    applyingSyncedStateRef,\n    replayMissingSequencesThenApply,"
    if app_anchor not in app:
        raise SystemExit('App controller call anchor not found')
    app = app.replace(
        app_anchor,
        "    applyingSyncedStateRef,\n    currentPiecesRef: piecesRef,\n    replayMissingSequencesThenApply,",
        1,
    )
app_path.write_text(app)

test_path = Path('tests/unit/localMoveHiddenPieces.test.ts')
tests = test_path.read_text()
old_test_import = "import { prepareLocalMoveOwnership } from '../../src/app/flows/localMoveOwnership';"
new_test_import = "import { prepareLocalMoveOwnership, withLocalMovePiecesFallback } from '../../src/app/flows/localMoveOwnership';"
if old_test_import in tests:
    tests = tests.replace(old_test_import, new_test_import, 1)
elif 'withLocalMovePiecesFallback' not in tests:
    raise SystemExit('unit import anchor not found')
if "uses rendered pieces when the controller snapshot has no pieces" not in tests:
    tests += """

test('uses rendered pieces when the controller snapshot has no pieces', () => {
  const completeState = makeOnlineMoveState();
  const { pieces, ...partialState } = completeState;
  const restoredState = withLocalMovePiecesFallback(partialState, pieces);

  assert.ok(restoredState);
  assert.equal(restoredState.pieces, pieces);
  const prepared = prepareLocalMoveOwnership({
    roomId: 'room-a',
    state: restoredState,
    action: {
      type: 'move_piece',
      actorId: 'P1',
      payload: {
        pieceId: 'piece-1',
        extraSteps: 0,
        branchChoice: 'outer',
        rollStackIndex: null,
        clientActionId: `move_piece:P1:10:0:${MO}:5:fallback`,
        clientActionStartedAt: Date.now(),
      },
    },
  });

  assert.ok(prepared);
  assert.equal(prepared.record.toNodeId, 'n06');
});
"""
test_path.write_text(tests)
