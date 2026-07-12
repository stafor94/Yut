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
        raise RuntimeError(f'{path}: expected one literal match, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str, flags: int = re.S) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}: {pattern[:120]!r}')
    write(path, updated)


def patch_app() -> None:
    path = 'src/app/App.tsx'

    replace_once(
        path,
        "  const shouldWaitForAuthoritativeTurnSync = Boolean(activeRoomId && screen === 'game' && pendingLocalRemoteActionCount > 0 && !isMyTurn);\n"
        "  const effectivePendingLocalRemoteActionCount = shouldWaitForAuthoritativeTurnSync ? pendingLocalRemoteActionCount : 0;\n"
        "  const activeItemPromptTypes = itemPromptTiming && !trapPlacementActive ? getUsableHostItems(itemPromptTiming) : [];\n"
        "  const pendingItemPromptChoiceLabel = pendingItemPromptChoice\n"
        "    ? pendingItemPromptChoice.itemType\n"
        "      ? `${ITEM_DEFINITIONS[pendingItemPromptChoice.itemType].name} 처리 중...`\n"
        "      : '사용 안 함 처리 중...'\n"
        "    : '';\n",
        "  const pendingBlockingRemoteActionCount = Array.from(pendingLocalRemoteActionMetaRef.current.values())\n"
        "    .filter((meta) => !(meta.type === 'use_item' && meta.optimisticApplied)).length;\n"
        "  const shouldWaitForAuthoritativeTurnSync = Boolean(activeRoomId && screen === 'game' && pendingBlockingRemoteActionCount > 0 && !isMyTurn);\n"
        "  const effectivePendingLocalRemoteActionCount = shouldWaitForAuthoritativeTurnSync ? pendingBlockingRemoteActionCount : 0;\n"
        "  const activeItemPromptTypes = itemPromptTiming && !trapPlacementActive ? getUsableHostItems(itemPromptTiming) : [];\n",
    )

    replace_once(
        path,
        "    pendingLocalRemoteActionCount: activeRoomId ? pendingLocalRemoteActionCount : effectivePendingLocalRemoteActionCount,",
        "    pendingLocalRemoteActionCount: activeRoomId ? pendingBlockingRemoteActionCount : effectivePendingLocalRemoteActionCount,",
    )
    replace_once(
        path,
        "  const hasPendingOnlineMoveRequest = Boolean(activeRoomId && pendingLocalRemoteActionCount > 0);",
        "  const hasPendingOnlineMoveRequest = Boolean(activeRoomId && pendingBlockingRemoteActionCount > 0);",
    )

    sub_once(
        path,
        r"\n  async function replayRerollItemSequence\(sequence: GameSequence\) \{.*?\n  \}\n\n  async function replayMissingSequencesThenApply",
        "\n  async function replayMissingSequencesThenApply",
    )
    replace_once(
        path,
        "        if (sequence.type === 'item_used' && sequence.payload?.itemType === 'reroll') await replayRerollItemSequence(sequence);\n"
        "        else if (sequence.type === 'roll_yut') await replayRollSequence(sequence);",
        "        if (sequence.type === 'roll_yut') await replayRollSequence(sequence);",
    )

    use_item_pattern = (
        r"    const submitItemActionIfRemote = \(\) => undefined;\n"
        r"    const isAfterMoveItem = ITEM_DEFINITIONS\[type\]\.timing === 'after_move';\n"
        r"    if \(isAfterMoveItem && lastMovedSeatId !== itemOwnerId\) return;\n"
        r"    if \(activeRoomId && actorId === localSeatId\) \{.*?\n"
        r"      return;\n"
        r"    \}\n"
        r"    const consumeItem ="
    )
    use_item_replacement = """    let submitItemActionIfRemote = () => undefined;
    const isAfterMoveItem = ITEM_DEFINITIONS[type].timing === 'after_move';
    if (isAfterMoveItem && lastMovedSeatId !== itemOwnerId) return;
    if (activeRoomId && actorId === localSeatId) {
      if (hasPendingUseItemActionFor(actorId) || pendingLocalRemoteActionsRef.current.has(clientMutationId)) return;
      const promptTiming = ITEM_DEFINITIONS[type].timing;
      const payload = { ...itemActionPayload, pieceId: (type === 'trap' || type === 'shield') ? (lastMovedPieceIds[0] ?? selectedPieceId) : selectedPieceId, rollStackIndex: selectedRollStackIndex };
      const action = { type: 'use_item' as const, actorId, payload: withActorLogPayload({ ...payload, clientActionId: clientMutationId }, itemOwnerSeat) };
      submitItemActionIfRemote = () => {
        markItemPromptResolved(promptTiming, selectedRollStackIndex);
        setItemPromptTiming(null);
        setPendingItemPromptChoice({ actionKey: clientMutationId, timing: promptTiming, itemType: type });
        addPendingLocalRemoteAction(clientMutationId, { type: 'use_item', actorId, createdSequence: lastAppliedSequenceRef.current, createdTurnIndex: turnIndex, optimisticApplied: true });
        void commitQueuedAuthoritativeGameAction(activeRoomId, action)
          .then(async (result) => {
            await enqueueAuthoritativeResultApplication(activeRoomId, () => applyAuthoritativeResultSequence(result));
            if (result.status === 'committed' || result.status === 'duplicate') acknowledgePendingLocalRemoteAction(clientMutationId);
            if (result.status === 'rejected' || result.status === 'unsupported') {
              setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
              removeSettledPendingLocalRemoteAction(clientMutationId);
              await syncLatestAuthoritativeState(result.reason ?? '서버가 아이템 사용을 거부해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
            }
          })
          .catch((error) => {
            recordRemoteActionDiagnostic('roll_yut', 'use-item-error', error instanceof Error ? error.message : '아이템 사용 처리에 실패했습니다.', { actionKey: clientMutationId });
            void applyProcessedAuthoritativeAction(clientMutationId)
              .then((processedState) => {
                if (processedState) {
                  setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
                  return null;
                }
                setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
                removeSettledPendingLocalRemoteAction(clientMutationId);
                return syncLatestAuthoritativeState('아이템 사용 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
              })
              .catch(() => {
                setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
                removeSettledPendingLocalRemoteAction(clientMutationId);
                void syncLatestAuthoritativeState('아이템 사용 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
              });
          });
      };
    }
    const consumeItem ="""
    sub_once(path, use_item_pattern, use_item_replacement)

    replace_once(
        path,
        "    if (type === 'reroll') {\n"
        "      if (activeSeat?.id !== itemOwnerId || !roll) return;\n"
        "      submitItemActionIfRemote();\n"
        "      consumeItem();\n"
        "      clearRoll();\n"
        "      window.setTimeout(() => rollYutFor(itemOwnerSeat), 450);\n"
        "      return;\n"
        "    }",
        "    if (type === 'reroll') {\n"
        "      if (activeSeat?.id !== itemOwnerId || !roll) return;\n"
        "      const rerollStackIndex = typeof selectedRollStackIndex === 'number' ? selectedRollStackIndex : Math.max(0, rollStack.length - 1);\n"
        "      submitItemActionIfRemote();\n"
        "      consumeItem();\n"
        "      clearRoll();\n"
        "      if (stackedRollMode) {\n"
        "        setRollStack((current) => current.filter((_, index) => index !== rerollStackIndex));\n"
        "        setSelectedRollStackIndex(null);\n"
        "        setRollStackClosed(false);\n"
        "      }\n"
        "      setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);\n"
        "      setTurnDeadlineKind('roll');\n"
        "      addLog(`${getSeatDisplayName(itemOwnerSeat)}님이 다시 던지기 아이템을 사용했습니다. 다시 윷을 던져주세요.`);\n"
        "      return;\n"
        "    }",
    )

    skip_pattern = (
        r"        if \(activeRoomId\) \{\n"
        r"          const promptTiming = itemPromptTiming;\n"
        r"          if \(!promptTiming \|\| hasPendingUseItemActionFor\(localSeatId\)\) return;.*?\n"
        r"          return;\n"
        r"        \}\n"
        r"        clearTurnActionTimeoutPenalty\(localSeatId\);"
    )
    skip_replacement = """        if (activeRoomId) {
          const promptTiming = itemPromptTiming;
          if (!promptTiming || hasPendingUseItemActionFor(localSeatId)) return;
          const promptRollStackIndex = selectedRollStackIndex;
          const skipSeat = playableSeats.find((seat) => seat.id === localSeatId);
          const payload = promptTiming === 'before_roll'
            ? { skipBeforeRollItem: true }
            : promptTiming === 'after_roll'
              ? { skipAfterRollItem: true, rollStackIndex: promptRollStackIndex }
              : { skipAfterMoveItem: true };
          const clientMutationId = getLocalActionKey('use_item', payload);
          if (pendingLocalRemoteActionsRef.current.has(clientMutationId)) return;
          const action = { type: 'use_item' as const, actorId: localSeatId, payload: withActorLogPayload({ ...payload, clientActionId: clientMutationId }, skipSeat) };
          shouldAdvanceTurnAfterItemPromptRef.current = false;
          markItemPromptResolved(promptTiming, promptRollStackIndex);
          setItemPromptTiming(null);
          if (promptTiming === 'before_roll') {
            setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
            setTurnDeadlineKind('roll');
          } else if (promptTiming === 'after_roll') {
            setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);
            setTurnDeadlineKind('move');
          } else finishPendingAfterMoveTurnAdvance();
          setPendingItemPromptChoice({ actionKey: clientMutationId, timing: promptTiming, itemType: null });
          addPendingLocalRemoteAction(clientMutationId, { type: 'use_item', actorId: localSeatId, createdSequence: lastAppliedSequenceRef.current, createdTurnIndex: turnIndex, optimisticApplied: true });
          void commitQueuedAuthoritativeGameAction(activeRoomId, action)
            .then(async (result) => {
              await enqueueAuthoritativeResultApplication(activeRoomId, () => applyAuthoritativeResultSequence(result));
              if (result.status === 'committed' || result.status === 'duplicate') acknowledgePendingLocalRemoteAction(clientMutationId);
              if (result.status === 'rejected' || result.status === 'unsupported') {
                setPendingItemPromptChoice((current) => current?.actionKey === clientMutationId ? null : current);
                removeSettledPendingLocalRemoteAction(clientMutationId);
                await syncLatestAuthoritativeState(result.reason ?? '서버가 아이템 건너뛰기를 거부해 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' });
              }
            })
            .catch((error) => {
              recordRemoteActionDiagnostic('roll_yut', 'skip-item-prompt-error', error instanceof Error ? error.message : '아이템 건너뛰기 처리에 실패했습니다.', { actionKey: clientMutationId });
              void applyProcessedAuthoritativeAction(clientMutationId)
                .then((processedState) => processedState ? null : syncLatestAuthoritativeState('아이템 건너뛰기 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' }))
                .catch(() => { void syncLatestAuthoritativeState('아이템 건너뛰기 처리 오류로 최신 authoritative 상태로 재동기화합니다.', { diagnosticType: 'roll_yut' }); });
            });
          return;
        }
        clearTurnActionTimeoutPenalty(localSeatId);"""
    sub_once(path, skip_pattern, skip_replacement)

    replace_once(path, "      pendingItemPromptChoiceLabel={pendingItemPromptChoiceLabel}\n", "")


def patch_controls() -> None:
    path = 'src/app/containers/GameBoardControls.tsx'
    replace_once(path, "  pendingItemPromptChoiceLabel: string;\n", "")
    replace_once(path, "  pendingItemPromptChoiceLabel,\n", "")
    replace_once(
        path,
        "      {pendingItemPromptChoiceLabel ? <div className=\"inline-item-processing\" role=\"status\" aria-live=\"polite\">{pendingItemPromptChoiceLabel}</div> : <>\n"
        "        <div className=\"time-limit-bar item-prompt-timer\" style={{ '--timer-duration': `${getItemPromptTimeoutMs(localSeatId)}ms` } as CSSProperties} aria-hidden=\"true\"><span></span></div>\n"
        "        <div className=\"inline-item-actions\">\n"
        "          {activeItemPromptTypes.map((type, index) => <button className=\"inline-item-button\" key={`${type}-${index}`} onClick={() => onUseItem(type)}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}\n"
        "          <button className=\"secondary\" onClick={onSkipItemPrompt}>사용 안 함</button>\n"
        "        </div>\n"
        "      </>}",
        "      <div className=\"time-limit-bar item-prompt-timer\" style={{ '--timer-duration': `${getItemPromptTimeoutMs(localSeatId)}ms` } as CSSProperties} aria-hidden=\"true\"><span></span></div>\n"
        "      <div className=\"inline-item-actions\">\n"
        "        {activeItemPromptTypes.map((type, index) => <button className=\"inline-item-button\" key={`${type}-${index}`} onClick={() => onUseItem(type)}><span>{ITEM_DEFINITIONS[type].icon}</span>{ITEM_DEFINITIONS[type].name}</button>)}\n"
        "        <button className=\"secondary\" onClick={onSkipItemPrompt}>사용 안 함</button>\n"
        "      </div>",
    )


def patch_game_screen_view() -> None:
    path = 'src/app/components/GameScreenView.tsx'
    replace_once(path, "  pendingItemPromptChoiceLabel: string;\n", "")
    replace_once(path, "activeItemPromptTypes, pendingItemPromptChoiceLabel, activeMovablePiece", "activeItemPromptTypes, activeMovablePiece")
    replace_once(path, "        pendingItemPromptChoiceLabel={pendingItemPromptChoiceLabel}\n", "")


def patch_board() -> None:
    path = 'src/features/game/components/GameBoard.tsx'
    replace_once(
        path,
        "        aria-label={`${piece.label} 말 선택`}\n"
        "      >{piece.finished ? '완' : piece.label}</button>;",
        "        aria-label={`${piece.label} 말 선택${shieldedPieceIds.includes(piece.id) ? ', 방패 적용됨' : ''}`}\n"
        "      >\n"
        "        {piece.finished ? '완' : piece.label}\n"
        "        {shieldedPieceIds.includes(piece.id) && !piece.finished ? <span className=\"piece-shield-badge\" aria-label=\"방패 적용됨\">🛡️</span> : null}\n"
        "      </button>;",
    )


def patch_css() -> None:
    path = 'src/styles/game.css'
    replace_once(
        path,
        ".piece-token.shielded {\n"
        "  border-color: rgba(255, 223, 111, .96);\n"
        "  box-shadow:\n"
        "    0 0 0 5px rgba(255, 215, 92, .22),\n"
        "    0 0 22px rgba(255, 198, 41, .36),\n"
        "    0 8px 20px rgba(42, 30, 23, .24);\n"
        "}\n",
        ".piece-token.shielded {\n"
        "  border-color: rgba(255, 232, 142, .98);\n"
        "  box-shadow:\n"
        "    0 0 0 6px rgba(255, 215, 92, .28),\n"
        "    0 0 26px rgba(255, 198, 41, .52),\n"
        "    0 8px 20px rgba(42, 30, 23, .24);\n"
        "  isolation: isolate;\n"
        "  animation: shield-status-pulse 1.8s ease-in-out infinite;\n"
        "}\n"
        ".piece-shield-badge {\n"
        "  position: absolute;\n"
        "  top: -17px;\n"
        "  right: -15px;\n"
        "  display: grid;\n"
        "  place-items: center;\n"
        "  width: 26px;\n"
        "  height: 26px;\n"
        "  padding: 0;\n"
        "  border: 2px solid #fff;\n"
        "  border-radius: 999px;\n"
        "  background: linear-gradient(145deg, #ffe892, #f2b84b);\n"
        "  box-shadow: 0 5px 13px rgba(42, 30, 23, .3);\n"
        "  font-size: 14px;\n"
        "  line-height: 1;\n"
        "  pointer-events: none;\n"
        "  z-index: 2;\n"
        "}\n"
        "@keyframes shield-status-pulse {\n"
        "  0%, 100% { filter: brightness(1); }\n"
        "  50% { filter: brightness(1.16); }\n"
        "}\n"
        "@media (prefers-reduced-motion: reduce) {\n"
        "  .piece-token.shielded { animation: none; }\n"
        "}\n",
    )


def patch_reducer() -> None:
    path = 'src/features/room/services/roomAuthoritativeReducer.ts'
    replace_once(path, "  pendingGoldenYutSelection?: unknown;\n", "  pendingGoldenYutSelection?: unknown;\n  pendingRerollStackIndex?: number | null;\n")
    replace_once(
        path,
        "  const pendingGoldenYutSelection = state.pendingGoldenYutSelection as { actorId?: unknown; deadline?: unknown } | null | undefined;\n"
        "  if (state.itemPromptTiming === 'before_roll' || state.itemPromptTiming === 'after_roll' || state.itemPromptTiming === 'after_move' || typeof state.pendingAfterMoveTurnIndex === 'number') {",
        "  const pendingGoldenYutSelection = state.pendingGoldenYutSelection as { actorId?: unknown; deadline?: unknown } | null | undefined;\n"
        "  const pendingRerollStackIndex = typeof state.pendingRerollStackIndex === 'number' ? state.pendingRerollStackIndex : null;\n"
        "  const pendingReroll = pendingRerollStackIndex !== null;\n"
        "  if (state.itemPromptTiming === 'before_roll' || state.itemPromptTiming === 'after_roll' || state.itemPromptTiming === 'after_move' || typeof state.pendingAfterMoveTurnIndex === 'number') {",
    )
    replace_once(
        path,
        "  if (!pendingGoldenYutSelection && !state.roll && hasUsableBeforeRollItem(state, action.actorId)) return makeActionReject('아이템 사용 여부를 먼저 선택해주세요.');",
        "  if (!pendingGoldenYutSelection && !pendingReroll && !state.roll && hasUsableBeforeRollItem(state, action.actorId)) return makeActionReject('아이템 사용 여부를 먼저 선택해주세요.');",
    )
    replace_once(
        path,
        "  if (room.stackedRollMode && state.rollStackClosed === true) {",
        "  if (room.stackedRollMode && state.rollStackClosed === true && !pendingReroll) {",
    )
    replace_once(
        path,
        "      pendingGoldenYutSelection: null,\n",
        "      pendingGoldenYutSelection: null,\n      pendingRerollStackIndex: null,\n",
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
          selectedRollStackIndex: null,
          rollStackClosed: false,
          pendingRerollStackIndex: stackIndex,
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
        pendingRerollStackIndex: -1,
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
  assert.equal(result.patch?.selectedRollStackIndex, null);
  assert.equal(result.patch?.rollStackClosed, false);
  assert.equal(result.patch?.pendingRerollStackIndex, 0);
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
    } as EngineState & { pendingRerollStackIndex: number },
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', clientRollResult: { name: '걸', steps: 3 }, clientFallOccurred: false, clientFallCount: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: true },
  );

  assert.equal(rollResult.status, 'committed');
  assert.deepEqual(rollResult.patch?.rollStack, [{ name: '걸', steps: 3 }, { name: '개', steps: 2 }]);
  assert.equal(rollResult.patch?.pendingRerollStackIndex, null);
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
    patch_controls()
    patch_game_screen_view()
    patch_board()
    patch_css()
    patch_reducer()
    patch_tests()
    STATUS_PATH.write_text('ok\n', encoding='utf-8')
    ERROR_PATH.unlink(missing_ok=True)
except Exception:
    STATUS_PATH.write_text('failed\n', encoding='utf-8')
    ERROR_PATH.write_text(traceback.format_exc(), encoding='utf-8')
