from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(source.replace(old, new, 1))


app_path = Path('src/app/App.tsx')

replace_once(
    app_path,
    "import { RoomCreationTimeoutError, createRoomRequestIdentity, isMatchingCreatedRoom, isRoomTransitionInProgress, withOperationTimeout } from './flows/roomCreationFlow';\n",
    "import { RoomCreationTimeoutError, createRoomRequestIdentity, isMatchingCreatedRoom, isRoomTransitionInProgress, withOperationTimeout } from './flows/roomCreationFlow';\nimport { getTurnActionFeedback, makeActionFeedbackProgressKey } from './flows/actionFeedbackPolicy';\n",
    'action feedback import',
)

replace_once(
    app_path,
    "  const [actionErrorDialog, setActionErrorDialog] = useState('');\n",
    "  const [actionErrorDialog, setActionErrorDialog] = useState('');\n  const [transientActionFeedback, setTransientActionFeedback] = useState<{ message: string; progressKey: string } | null>(null);\n",
    'transient action feedback state',
)

pending_hook = """  } = usePendingRemoteActions();
  const localActionCommitQueueRef = useRef(Promise.resolve());
"""
pending_replacement = """  } = usePendingRemoteActions();
  const actionFeedbackResyncKeyRef = useRef('');
  const actionFeedbackProgressKey = makeActionFeedbackProgressKey({
    roomId: activeRoomId,
    screen,
    turnIndex,
    pendingActionCount: pendingLocalRemoteActionCount,
    movingPieceId,
    rollInProgress,
    moveInProgress,
  });
  useEffect(() => {
    if (!transientActionFeedback) return undefined;
    const clearTransientFeedback = () => {
      setTransientActionFeedback((current) => current === transientActionFeedback ? null : current);
      setMessage((current) => current === transientActionFeedback.message ? '' : current);
    };
    if (transientActionFeedback.progressKey !== actionFeedbackProgressKey) {
      clearTransientFeedback();
      return undefined;
    }
    const timer = window.setTimeout(clearTransientFeedback, 2400);
    return () => window.clearTimeout(timer);
  }, [actionFeedbackProgressKey, transientActionFeedback]);
  const localActionCommitQueueRef = useRef(Promise.resolve());
"""
replace_once(app_path, pending_hook, pending_replacement, 'action feedback progress lifecycle')

report_block = """  function reportTurnActionBlocked(type: 'roll_yut' | 'move_piece', reasons: string[], fallbackMessage: string) {
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
report_replacement = """  function reportTurnActionBlocked(type: 'roll_yut' | 'move_piece', reasons: string[], fallbackMessage: string) {
    const feedback = getTurnActionFeedback(reasons, fallbackMessage);
    setLastActionDiagnostic({ type, message: feedback.message, reasons: feedback.reasons, createdAt: Date.now() });
    setMessage(feedback.message);
    if (feedback.severity === 'fatal') {
      setTransientActionFeedback(null);
      setActionErrorDialog(feedback.message);
      return;
    }

    setActionErrorDialog('');
    setTransientActionFeedback({ message: feedback.message, progressKey: actionFeedbackProgressKey });
    if (feedback.severity === 'recoverable' && activeRoomId) {
      const recoveryKey = `${actionFeedbackProgressKey}:${feedback.reasons.join('|')}`;
      if (actionFeedbackResyncKeyRef.current !== recoveryKey) {
        actionFeedbackResyncKeyRef.current = recoveryKey;
        void syncLatestAuthoritativeState('현재 차례 정보를 확인하기 위해 최신 authoritative 상태를 다시 불러옵니다.', { diagnosticType: type });
      }
    }
  }
  function reportTurnActionFailure(type: 'roll_yut' | 'move_piece', messageText: string, reasons: string[] = []) {
    setTransientActionFeedback(null);
    setLastActionDiagnostic({ type, message: messageText, reasons, createdAt: Date.now() });
    setMessage(messageText);
    setActionErrorDialog(messageText);
  }
"""
replace_once(app_path, report_block, report_replacement, 'turn action feedback classification')

policy_path = Path('src/app/flows/actionFeedbackPolicy.ts')
policy_path.write_text("""export type ActionFeedbackSeverity = 'transient' | 'recoverable' | 'fatal';

const TRANSIENT_BLOCK_REASONS = new Set([
  'not-local-turn',
  'ai-turn',
  'spectator',
  'winner',
  'waiting-for-turn-order',
  'turn-order-phase-active',
  'turn-order-intro-active',
  'moving-piece',
  'pending-trap-placement',
  'pending-item-prompt',
  'saving-game-state',
  'pending-local-remote-action',
  'processing-remote-action',
  'roll-already-exists',
  'roll-locked',
  'roll-in-progress',
]);

const RECOVERABLE_BLOCK_REASONS = new Set(['no-active-seat']);

const REASON_MESSAGES: Record<string, string> = {
  'no-active-seat': '현재 차례 정보를 확인하고 있습니다.',
  'not-local-turn': '지금은 다른 플레이어의 차례입니다.',
  'ai-turn': 'AI의 차례가 진행 중입니다.',
  spectator: '관전 중에는 게임 액션을 실행할 수 없습니다.',
  winner: '이미 게임 결과가 확정되었습니다.',
  'waiting-for-turn-order': '차례 순서를 정하는 중입니다.',
  'turn-order-phase-active': '순서 정하기가 진행 중입니다.',
  'turn-order-intro-active': '순서 안내가 끝난 뒤 진행할 수 있습니다.',
  'moving-piece': '말 이동이 진행 중입니다.',
  'pending-trap-placement': '함정 설치 위치를 먼저 선택해주세요.',
  'pending-item-prompt': '아이템 선택을 먼저 완료해주세요.',
  'saving-game-state': '게임 상태를 저장하고 있습니다.',
  'pending-local-remote-action': '이전 요청을 처리하고 있습니다.',
  'processing-remote-action': '서버 요청을 적용하고 있습니다.',
  'roll-already-exists': '이미 나온 윷 결과로 말을 이동해주세요.',
  'roll-locked': '윷 결과 연출이 끝난 뒤 진행할 수 있습니다.',
  'roll-in-progress': '윷 던지기가 진행 중입니다.',
  unknown: '현재 상태에서는 요청을 처리할 수 없습니다.',
};

export type TurnActionFeedback = {
  severity: ActionFeedbackSeverity;
  reasons: string[];
  message: string;
};

export function getTurnActionFeedback(reasons: string[], fallbackMessage: string): TurnActionFeedback {
  const normalizedReasons = Array.from(new Set(reasons.filter(Boolean)));
  if (!normalizedReasons.length) normalizedReasons.push('unknown');

  const hasUnknownReason = normalizedReasons.some((reason) => !TRANSIENT_BLOCK_REASONS.has(reason) && !RECOVERABLE_BLOCK_REASONS.has(reason));
  const severity: ActionFeedbackSeverity = hasUnknownReason
    ? 'fatal'
    : normalizedReasons.some((reason) => RECOVERABLE_BLOCK_REASONS.has(reason))
      ? 'recoverable'
      : 'transient';
  const descriptions = normalizedReasons.map((reason) => REASON_MESSAGES[reason] ?? REASON_MESSAGES.unknown);

  return {
    severity,
    reasons: normalizedReasons,
    message: `${fallbackMessage}. ${descriptions.join(' ')}`,
  };
}

export type ActionFeedbackProgressInput = {
  roomId: string;
  screen: string;
  turnIndex: number;
  pendingActionCount: number;
  movingPieceId: string;
  rollInProgress: boolean;
  moveInProgress: boolean;
};

export function makeActionFeedbackProgressKey(input: ActionFeedbackProgressInput) {
  return JSON.stringify([
    input.roomId,
    input.screen,
    input.turnIndex,
    input.pendingActionCount,
    input.movingPieceId,
    input.rollInProgress,
    input.moveInProgress,
  ]);
}
""")

test_path = Path('tests/unit/actionFeedbackPolicy.test.ts')
test_path.write_text("""import assert from 'node:assert/strict';
import test from 'node:test';
import { getTurnActionFeedback, makeActionFeedbackProgressKey } from '../../src/app/flows/actionFeedbackPolicy.js';

test('pending 요청과 연출 진행은 화면을 막지 않는 transient 안내로 분류한다', () => {
  for (const reason of ['pending-local-remote-action', 'processing-remote-action', 'moving-piece', 'roll-in-progress']) {
    const feedback = getTurnActionFeedback([reason], '액션을 진행할 수 없습니다');
    assert.equal(feedback.severity, 'transient');
    assert.equal(feedback.message.includes(reason), false);
  }
});

test('현재 차례 정보가 없는 상태는 authoritative 재동기화가 가능한 recoverable 상태다', () => {
  const feedback = getTurnActionFeedback(['no-active-seat'], '액션을 진행할 수 없습니다');
  assert.equal(feedback.severity, 'recoverable');
  assert.match(feedback.message, /차례 정보를 확인/);
});

test('알 수 없는 guard 이유는 불변식 위반 가능성이 있어 fatal로 유지한다', () => {
  const feedback = getTurnActionFeedback(['unexpected-state'], '액션을 진행할 수 없습니다');
  assert.equal(feedback.severity, 'fatal');
  assert.deepEqual(feedback.reasons, ['unexpected-state']);
});

test('진행 key는 pending 해제, 턴 전환, 이동 상태 변화를 구분한다', () => {
  const base = {
    roomId: 'room-1',
    screen: 'game',
    turnIndex: 1,
    pendingActionCount: 1,
    movingPieceId: '',
    rollInProgress: false,
    moveInProgress: false,
  };
  const baseKey = makeActionFeedbackProgressKey(base);
  assert.notEqual(baseKey, makeActionFeedbackProgressKey({ ...base, pendingActionCount: 0 }));
  assert.notEqual(baseKey, makeActionFeedbackProgressKey({ ...base, turnIndex: 2 }));
  assert.notEqual(baseKey, makeActionFeedbackProgressKey({ ...base, movingPieceId: 'piece-1' }));
});
""")

tsconfig_path = Path('tsconfig.test.json')
tsconfig = tsconfig_path.read_text()
anchor = '    "src/app/flows/roomCreationFlow.ts",\n'
addition = anchor + '    "src/app/flows/actionFeedbackPolicy.ts",\n'
if tsconfig.count(anchor) != 1:
    raise SystemExit(f'tsconfig action feedback anchor: expected 1 match, found {tsconfig.count(anchor)}')
tsconfig_path.write_text(tsconfig.replace(anchor, addition, 1))

print('phase 2 action feedback patch applied without validation')
