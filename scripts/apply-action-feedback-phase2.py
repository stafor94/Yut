from pathlib import Path

app_path = Path('src/app/App.tsx')
app = app_path.read_text()

import_anchor = "import { getStartGameBlockMessage } from './flows/gameStartFlow';\n"
feedback_import = "import { classifyTurnActionFeedback, shouldClearActionErrorDialog, shouldOpenTurnActionErrorDialog } from './flows/actionFeedback';\n"
assert app.count(import_anchor) == 1
app = app.replace(import_anchor, import_anchor + feedback_import)

state_anchor = "  const [actionErrorDialog, setActionErrorDialog] = useState('');\n"
state_new = state_anchor + "  const actionErrorDialogContextRef = useRef({ roomId: '', sequence: 0, turnIndex: 0 });\n"
assert app.count(state_anchor) == 1
app = app.replace(state_anchor, state_new)

ref_anchor = "  const lastAppliedSequenceRef = useRef(0);\n"
effect = """  const lastAppliedSequenceRef = useRef(0);
  useEffect(() => {
    if (!actionErrorDialog) return;
    const shouldClear = shouldClearActionErrorDialog({
      dialogOpenedRoomId: actionErrorDialogContextRef.current.roomId,
      currentRoomId: activeRoomId,
      dialogOpenedSequence: actionErrorDialogContextRef.current.sequence,
      currentSequence: lastAppliedSequenceRef.current,
      dialogOpenedTurnIndex: actionErrorDialogContextRef.current.turnIndex,
      currentTurnIndex: turnIndex,
    });
    if (shouldClear) setActionErrorDialog('');
  }, [actionErrorDialog, activeRoomId, pendingLocalRemoteActionCount, turnIndex]);
"""
assert app.count(ref_anchor) == 1
app = app.replace(ref_anchor, effect)

old_functions = """  function reportTurnActionBlocked(type: 'roll_yut' | 'move_piece', reasons: string[], fallbackMessage: string) {
    const normalizedReasons = reasons.length ? reasons : ['unknown'];
    const messageText = `${fallbackMessage}: ${normalizedReasons.join(', ')}`;
    setLastActionDiagnostic({ type, message: messageText, reasons: normalizedReasons, createdAt: Date.now() });
    setMessage(messageText);
    setActionErrorDialog(messageText);
  }
  function reportTurnActionFailure(type: 'roll_yut' | 'move_piece', messageText: string, reasons: string[] = []) {
    setLastActionDiagnostic({ type, message: messageText, reasons, createdAt: Date.now() });
    setMessage(messageText);
    setActionErrorDialog(messageText);
  }
"""
new_functions = """  function openCriticalActionErrorDialog(messageText: string) {
    actionErrorDialogContextRef.current = {
      roomId: activeRoomId,
      sequence: lastAppliedSequenceRef.current,
      turnIndex,
    };
    setActionErrorDialog(messageText);
  }

  function reportTurnActionBlocked(type: 'roll_yut' | 'move_piece', reasons: string[], fallbackMessage: string) {
    const normalizedReasons = reasons.length ? reasons : ['unknown'];
    const feedbackLevel = classifyTurnActionFeedback(normalizedReasons);
    const messageText = `${fallbackMessage}: ${normalizedReasons.join(', ')}`;
    setLastActionDiagnostic({ type, message: messageText, reasons: [...normalizedReasons, `feedback:${feedbackLevel}`], createdAt: Date.now() });
    setMessage(messageText);
  }
  function reportTurnActionFailure(type: 'roll_yut' | 'move_piece', messageText: string, reasons: string[] = []) {
    const feedbackLevel = classifyTurnActionFeedback(reasons);
    setLastActionDiagnostic({ type, message: messageText, reasons: [...reasons, `feedback:${feedbackLevel}`], createdAt: Date.now() });
    setMessage(messageText);
    if (shouldOpenTurnActionErrorDialog('failure', reasons)) openCriticalActionErrorDialog(messageText);
  }
"""
assert app.count(old_functions) == 1
app = app.replace(old_functions, new_functions)

mismatch_old = """      setMessage(messageText);
      setActionErrorDialog(messageText);
"""
mismatch_new = """      setMessage(messageText);
      openCriticalActionErrorDialog(messageText);
"""
assert app.count(mismatch_old) == 1, app.count(mismatch_old)
app = app.replace(mismatch_old, mismatch_new)
app_path.write_text(app)

test_path = Path('tests/unit/actionFeedback.test.ts')
test_path.write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyTurnActionFeedback,
  shouldClearActionErrorDialog,
  shouldOpenTurnActionErrorDialog,
} from '../../src/app/flows/actionFeedback.js';

test('pending local action과 애니메이션 진행은 정상 대기 상태다', () => {
  assert.equal(classifyTurnActionFeedback(['pending-local-remote-action']), 'status');
  assert.equal(classifyTurnActionFeedback(['moving-piece', 'processing-remote-action']), 'status');
  assert.equal(shouldOpenTurnActionErrorDialog('blocked', ['pending-local-remote-action']), false);
});

test('차례와 입력 안내 사유도 전체 화면 오류 modal을 열지 않는다', () => {
  assert.equal(classifyTurnActionFeedback(['not-local-turn']), 'recoverable');
  assert.equal(classifyTurnActionFeedback(['roll-already-exists']), 'recoverable');
  assert.equal(shouldOpenTurnActionErrorDialog('blocked', ['not-local-turn']), false);
});

test('실제 failure만 치명적 modal 대상이다', () => {
  assert.equal(shouldOpenTurnActionErrorDialog('failure', []), true);
  assert.equal(shouldOpenTurnActionErrorDialog('failure', ['pending-local-remote-action']), false);
  assert.equal(shouldOpenTurnActionErrorDialog('failure', ['unexpected-state']), true);
});

test('방, sequence, turn이 전진하면 남은 오류 modal을 해제한다', () => {
  const base = {
    dialogOpenedRoomId: 'room-a',
    currentRoomId: 'room-a',
    dialogOpenedSequence: 10,
    currentSequence: 10,
    dialogOpenedTurnIndex: 1,
    currentTurnIndex: 1,
  };
  assert.equal(shouldClearActionErrorDialog(base), false);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentRoomId: 'room-b' }), true);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentSequence: 11 }), true);
  assert.equal(shouldClearActionErrorDialog({ ...base, currentTurnIndex: 2 }), true);
});
""")

tsconfig_path = Path('tsconfig.test.json')
tsconfig = tsconfig_path.read_text()
anchor = '    "src/app/flows/roomCreationFlow.ts",\n'
addition = anchor + '    "src/app/flows/actionFeedback.ts",\n'
assert tsconfig.count(anchor) == 1
tsconfig_path.write_text(tsconfig.replace(anchor, addition))
