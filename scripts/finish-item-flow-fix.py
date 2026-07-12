from pathlib import Path
import re
import traceback

STATUS_PATH = Path('.patch-status')
ERROR_PATH = Path('.patch-error')


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one literal match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str, flags: int = re.S) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}: {pattern[:140]!r}')
    write(path, updated)


def patch_app() -> None:
    path = 'src/app/App.tsx'
    replace_once(
        path,
        "      if (stackedRollMode) {\n"
        "        setRollStack((current) => current.filter((_, index) => index !== rerollStackIndex));\n"
        "        setSelectedRollStackIndex(null);\n"
        "        setRollStackClosed(false);\n"
        "      }",
        "      if (stackedRollMode) setRollStack((current) => current.filter((_, index) => index !== rerollStackIndex));\n"
        "      setSelectedRollStackIndex(stackedRollMode ? rerollStackIndex : -1);\n"
        "      setRollStackClosed(false);",
    )


def patch_reducer() -> None:
    path = 'src/features/room/services/roomAuthoritativeReducer.ts'
    replace_once(path, "  pendingRerollStackIndex?: number | null;\n", "")
    replace_once(
        path,
        "  const pendingRerollStackIndex = typeof state.pendingRerollStackIndex === 'number' ? state.pendingRerollStackIndex : null;\n"
        "  const pendingReroll = pendingRerollStackIndex !== null;",
        "  const pendingRerollStackIndex = state.rollStackClosed === false && typeof state.selectedRollStackIndex === 'number' ? state.selectedRollStackIndex : null;\n"
        "  const pendingReroll = pendingRerollStackIndex !== null;",
    )
    replace_once(
        path,
        "      turnDeadlineKind: shouldPromptAfterRoll || shouldPromptBeforeRollAfterFall ? 'item_prompt' : fallOccurred ? 'roll' : 'move',\n"
        "      itemPromptTiming: shouldPromptAfterRoll ? 'after_roll' : shouldPromptBeforeRollAfterFall ? 'before_roll' : null,\n"
        "      pendingGoldenYutSelection: null,\n",
        "      turnDeadlineKind: shouldPromptAfterRoll || shouldPromptBeforeRollAfterFall ? 'item_prompt' : fallOccurred ? 'roll' : 'move',\n"
        "      itemPromptTiming: shouldPromptAfterRoll ? 'after_roll' : shouldPromptBeforeRollAfterFall ? 'before_roll' : null,\n"
        "      pendingGoldenYutSelection: null,\n"
        "      ...(pendingReroll ? { selectedRollStackIndex: null } : {}),\n",
    )
    replace_once(
        path,
        "  const currentStack = ((state.rollStack as YutResult[] | undefined) ?? []);\n"
        "  const nextStack = [...currentStack, nextRoll];\n"
        "  return {\n"
        "    ...baseReduction,\n"
        "    patch: {\n"
        "      ...baseReduction.patch,\n"
        "      roll: null,\n"
        "      rollStack: nextStack,\n"
        "      selectedRollStackIndex: shouldPromptAfterRoll ? nextStack.length - 1 : null,\n"
        "      rollStackClosed: !nextRoll.bonus,\n"
        "    },\n"
        "    payload: { ...baseReduction.payload, rollStack: nextStack, rollStackClosed: !nextRoll.bonus },\n"
        "  };",
        "  const currentStack = ((state.rollStack as YutResult[] | undefined) ?? []);\n"
        "  const replacementIndex = pendingReroll && pendingRerollStackIndex !== null\n"
        "    ? Math.min(Math.max(0, pendingRerollStackIndex), currentStack.length)\n"
        "    : currentStack.length;\n"
        "  const nextStack = [...currentStack];\n"
        "  nextStack.splice(replacementIndex, 0, nextRoll);\n"
        "  return {\n"
        "    ...baseReduction,\n"
        "    patch: {\n"
        "      ...baseReduction.patch,\n"
        "      roll: null,\n"
        "      rollStack: nextStack,\n"
        "      selectedRollStackIndex: shouldPromptAfterRoll ? replacementIndex : null,\n"
        "      rollStackClosed: !nextRoll.bonus,\n"
        "    },\n"
        "    payload: { ...baseReduction.payload, rollStack: nextStack, rollStackClosed: !nextRoll.bonus, rerolledStackIndex: pendingReroll ? replacementIndex : null },\n"
        "  };",
    )

    reroll_pattern = r"  if \(itemType === 'reroll'\) \{.*?\n  \}\n\n  if \(itemType === 'trap'\) \{"
    reroll_replacement = """  if (itemType === 'reroll') {
    if (action.payload?.replacementRoll !== undefined) return makeActionReject('허용되지 않은 다시 던지기 결과입니다.');
    const rerollLog = makeAuthoritativeLog(logs, `${actorLogName}님이 다시 던지기 아이템을 사용했습니다. 다시 윷을 던집니다.`);
    if (room.stackedRollMode) {
      const currentStack = [...(((state.rollStack as YutResult[] | undefined) ?? []))];
      const stackIndex = typeof action.payload?.rollStackIndex === 'number' ? Number(action.payload.rollStackIndex) : getSelectedStackIndex(state);
      if (stackIndex === null || stackIndex < 0 || stackIndex >= currentStack.length) return makeActionReject('교체할 이동 스택을 찾을 수 없습니다.');
      const nextStack = currentStack.filter((_, index) => index !== stackIndex);
      return {
        status: 'committed',
        patch: {
          ownedItems: nextOwnedItems,
          roll: null,
          rollStack: nextStack,
          selectedRollStackIndex: stackIndex,
          rollStackClosed: false,
          rollResultReadyAt: 0,
          turnDeadlineAt: now + TURN_ACTION_TIMEOUT_MS,
          turnDeadlineKind: 'roll',
          itemPromptTiming: null,
          logs: [rerollLog, ...logs],
        },
        payload: { activeSeatId: action.actorId, itemType, rerollReady: true, rollStack: nextStack, rollStackIndex: stackIndex },
      };
    }
    if (!state.roll) return makeActionReject('교체할 윷 결과가 없습니다.');
    return {
      status: 'committed',
      patch: {
        ownedItems: nextOwnedItems,
        roll: null,
        selectedRollStackIndex: -1,
        rollStackClosed: false,
        rollResultReadyAt: 0,
        turnDeadlineAt: now + TURN_ACTION_TIMEOUT_MS,
        turnDeadlineKind: 'roll',
        itemPromptTiming: null,
        logs: [rerollLog, ...logs],
      },
      payload: { activeSeatId: action.actorId, itemType, rerollReady: true },
    };
  }

  if (itemType === 'trap') {"""
    sub_once(path, reroll_pattern, reroll_replacement)


def patch_tests() -> None:
    path = 'tests/unit/game-core.test.ts'
    reroll_tests_pattern = (
        r"test\('온라인 누적 다시 던지기는 선택된 이동 스택을 교체하고 append하지 않는다'.*?\n\}\)\);\n\n\n"
        r"test\('온라인 누적 다시 던지기는 payload가 없으면 authoritative 선택 스택을 교체하고 아이템 1개만 소비한다'.*?\n\}\)\);"
    )
    reroll_tests_replacement = """test('온라인 누적 다시 던지기는 선택 스택을 비우고 실제 재던지기 단계로 전환한다', () => {
  const result = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      rollStack: [{ name: '도', steps: 1 }, { name: '개', steps: 2 }],
      rollStackClosed: true,
      selectedRollStackIndex: 0,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll', 'shield'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(result.status, 'committed');
  assert.equal(result.patch?.roll, null);
  assert.deepEqual(result.patch?.rollStack, [{ name: '개', steps: 2 }]);
  assert.equal(result.patch?.selectedRollStackIndex, 0);
  assert.equal(result.patch?.rollStackClosed, false);
  assert.equal(result.patch?.turnDeadlineKind, 'roll');
  assert.deepEqual((result.patch?.ownedItems as Record<string, string[]>)['seat-1'], ['shield']);
  assert.match(String((result.patch?.logs as Array<{ text: string }>)[0]?.text), /다시 던지기 아이템을 사용했습니다/);
});


test('온라인 누적 다시 던지기 후 실제 roll_yut은 원래 선택 위치에 새 결과를 넣는다', () => {
  const useResult = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '도', steps: 1 },
      rollStack: [{ name: '도', steps: 1 }, { name: '개', steps: 2 }],
      rollStackClosed: true,
      selectedRollStackIndex: 0,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll', rollStackIndex: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );
  assert.equal(useResult.status, 'committed');

  const rollResult = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ...useResult.patch,
      turnOrderIds: ['seat-1', 'seat-2'],
      logs: (useResult.patch?.logs as EngineLog[]) ?? [],
    } as EngineState,
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', clientRollResult: { name: '걸', steps: 3 }, clientFallOccurred: false, clientFallCount: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(rollResult.status, 'committed');
  assert.deepEqual(rollResult.patch?.rollStack, [{ name: '걸', steps: 3 }, { name: '개', steps: 2 }]);
  assert.equal(rollResult.patch?.selectedRollStackIndex, null);
  assert.equal(rollResult.patch?.rollStackClosed, true);
});"""
    sub_once(path, reroll_tests_pattern, reroll_tests_replacement)

    source_test_pattern = r"test\('온라인 다시 던지기 item_used replay는 pending 확정 경로와 원격 1회 애니메이션 경로를 분리한다'.*?\n\}\);\s*$"
    source_test_replacement = """test('온라인 아이템 선택은 optimistic 처리하고 처리 중 문구 없이 방패 상태를 표시한다', () => {
  const appSource = readFileSync('src/app/App.tsx', 'utf8');
  const controlsSource = readFileSync('src/app/containers/GameBoardControls.tsx', 'utf8');
  const boardSource = readFileSync('src/features/game/components/GameBoard.tsx', 'utf8');

  assert.match(appSource, /type: 'use_item'.*optimisticApplied: true/s);
  assert.match(appSource, /markItemPromptResolved\(promptTiming/);
  assert.doesNotMatch(appSource, /async function replayRerollItemSequence/);
  assert.doesNotMatch(controlsSource, /pendingItemPromptChoiceLabel|처리 중\.\.\./);
  assert.match(boardSource, /piece-shield-badge/);
});
"""
    sub_once(path, source_test_pattern, source_test_replacement)


try:
    patch_app()
    patch_reducer()
    patch_tests()
    STATUS_PATH.write_text('ok\n', encoding='utf-8')
    ERROR_PATH.unlink(missing_ok=True)
except Exception:
    STATUS_PATH.write_text('failed\n', encoding='utf-8')
    ERROR_PATH.write_text(traceback.format_exc(), encoding='utf-8')
