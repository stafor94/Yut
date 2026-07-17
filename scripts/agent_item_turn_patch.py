from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"pattern not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"regex count {count} in {path}: {pattern[:120]!r}")
    write(path, next_text)


# 1) Shared effective move context for normal and stacked-roll movement.
write("src/app/flows/effectiveMoveContext.ts", """import type { YutResult } from '../../game-core/roll';

export type EffectiveMoveContext = {
  roll: YutResult | null;
  rollStackIndex: number | null;
  steps: number;
  fromStack: boolean;
};

export function resolveEffectiveMoveContext(params: {
  stackedRollMode: boolean;
  roll: YutResult | null;
  rollStack: YutResult[];
  rollStackClosed: boolean;
  selectedRollStackIndex: number | null;
  rollStackIndexOverride?: number | null;
}): EffectiveMoveContext {
  const {
    stackedRollMode,
    roll,
    rollStack,
    rollStackClosed,
    selectedRollStackIndex,
    rollStackIndexOverride,
  } = params;

  if (!stackedRollMode || !rollStackClosed || !rollStack.length) {
    return { roll, rollStackIndex: null, steps: roll?.steps ?? 0, fromStack: false };
  }

  const requestedIndex = typeof rollStackIndexOverride === 'number'
    ? rollStackIndexOverride
    : typeof selectedRollStackIndex === 'number'
      ? selectedRollStackIndex
      : rollStack.length === 1
        ? 0
        : null;
  const validIndex = requestedIndex !== null && requestedIndex >= 0 && requestedIndex < rollStack.length
    ? requestedIndex
    : null;
  const effectiveRoll = validIndex === null ? null : rollStack[validIndex] ?? null;
  return {
    roll: effectiveRoll,
    rollStackIndex: validIndex,
    steps: effectiveRoll?.steps ?? 0,
    fromStack: true,
  };
}
""")

# 2) Shield lifetime is no longer cleared globally by every roll.
replace_once(
    "src/game-core/gameEngineCore.ts",
    "        shieldedPieceIds: [],\n        turnIndex:",
    "        shieldedPieceIds: state.shieldedPieceIds,\n        turnIndex:",
)
replace_once(
    "src/game-core/gameEngineCore.ts",
    "      shieldedPieceIds: [],\n      fallEffect: null,",
    "      shieldedPieceIds: state.shieldedPieceIds,\n      fallEffect: null,",
)

# 3) Authoritative reducer: timeout recovery, fall-reroll prompt, trap eligibility,
#    shield expiry, deterministic stacked item targeting.
path = "src/features/room/services/roomAuthoritativeReducerCore.ts"
replace_once(
    path,
    "const isItemPromptTimeoutRecoveryPayload = (payload: Record<string, unknown> | undefined) => payload?.itemPromptTimeoutRecovery === true;\nconst isTrapPlacementTimeoutRecoveryPayload",
    "const isItemPromptTimeoutRecoveryPayload = (payload: Record<string, unknown> | undefined) => payload?.itemPromptTimeoutRecovery === true;\nconst isItemPickupTimeoutRecoveryPayload = (payload: Record<string, unknown> | undefined) => payload?.itemPickupTimeoutRecovery === true;\nconst isTrapPlacementTimeoutRecoveryPayload",
)
replace_once(
    path,
    "const validateItemPromptTimeoutRecovery = (state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>) => {\n",
    "const validateItemPickupTimeoutRecovery = (state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, pending: AuthoritativePendingItemPickup) => {\n  if (!isItemPickupTimeoutRecoveryPayload(action.payload)) return null;\n  if (pending.ownerId !== action.actorId || typeof pending.deadline !== 'number') return '아이템 교체 시간초과 대상이 아닙니다.';\n  if (action.payload?.timeoutDeadlineAt !== pending.deadline) return '아이템 교체 시간초과 deadline이 아닙니다.';\n  if (Date.now() < pending.deadline + TURN_NETWORK_GRACE_MS) return '아이템 교체 네트워크 유예 시간이 아직 남아 있습니다.';\n  return null;\n};\n\nconst validateItemPromptTimeoutRecovery = (state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>) => {\n",
)
replace_once(
    path,
    "const hasUsableAfterRollItem = (state: SyncedGameStateShape, actorId: string, roll: YutResult, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]) => {\n  const itemTypes = ((state.ownedItems as Record<string, ItemType[]> | undefined)?.[actorId] ?? []).filter((type) => ITEM_DEFINITIONS[type]?.timing === 'after_roll');\n  if (!itemTypes.length) return false;\n  if (roll.steps < 0 && !hasAuthoritativeMovablePieceForRoll(state, actorId, roll, room, sides)) return false;\n  return true;\n};",
    "const hasUsableAfterRollItem = (state: SyncedGameStateShape, actorId: string, roll: YutResult, room: RoomSummaryShape, sides: AuthoritativeSeatSide[], fallOccurred = false) => {\n  const itemTypes = ((state.ownedItems as Record<string, ItemType[]> | undefined)?.[actorId] ?? []).filter((type) => ITEM_DEFINITIONS[type]?.timing === 'after_roll');\n  if (fallOccurred) return itemTypes.includes('reroll');\n  if (!itemTypes.length) return false;\n  if (roll.steps < 0 && !hasAuthoritativeMovablePieceForRoll(state, actorId, roll, room, sides)) return false;\n  return true;\n};",
)
sub_once(
    path,
    r"const getAfterMovePromptPatch = \(state: SyncedGameStateShape, basePatch: GameStatePatch, actorId: string, nextTurnIndex: number, room: RoomSummaryShape, sides: AuthoritativeSeatSide\[\]\) => \{.*?\n\};\n\nfunction makeEngineState",
    """const getAfterMovePromptPatch = (state: SyncedGameStateShape, basePatch: GameStatePatch, actorId: string, nextTurnIndex: number, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]) => {
  const nextOwnedItems = (basePatch.ownedItems ?? state.ownedItems ?? {}) as Record<string, ItemType[]>;
  const lastMovedPieceIds = ((basePatch.lastMovedPieceIds as string[] | undefined) ?? state.lastMovedPieceIds ?? []);
  const nextPieces = (basePatch.pieces as AuthoritativePiece[] | undefined) ?? (state.pieces as AuthoritativePiece[]);
  const movedPiece = lastMovedPieceIds
    .map((pieceId) => nextPieces.find((piece) => piece.id === pieceId && piece.started && !piece.finished && canActorControlAuthoritativePiece(actorId, piece, room, sides)))
    .find((piece): piece is AuthoritativePiece => Boolean(piece));
  if (!movedPiece) return null;
  const usableAfterMoveItems = (nextOwnedItems[actorId] ?? []).filter((type) => {
    if (type === 'shield') return true;
    if (type === 'trap') return makeAuthoritativeTrapCandidateNodeIds(movedPiece.nodeId, nextPieces).length > 0;
    return false;
  });
  if (!usableAfterMoveItems.length) return null;
  return { turnIndex: Number(state.turnIndex ?? 0), turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS, turnDeadlineKind: 'item_prompt' as const, itemPromptTiming: 'after_move' as const, pendingAfterMoveTurnIndex: nextTurnIndex };
};

function makeEngineState""",
)
sub_once(
    path,
    r"function reduceAuthoritativeRoll\(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' \| 'createdAt' \| 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide\[\]\): AuthoritativeReduction \{.*?\n\}\nfunction reduceAuthoritativeMove",
    """function reduceAuthoritativeRoll(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>, room: RoomSummaryShape, sides: AuthoritativeSeatSide[]): AuthoritativeReduction {
  if ((state.turnOrderIds ?? [])[Number(state.turnIndex ?? 0)] !== action.actorId) return makeActionReject('지금은 내 차례가 아닙니다.');
  if (action.payload?.timeoutRecoveredBy !== undefined || action.payload?.timeoutDeadlineAt !== undefined) {
    const deadlineRejection = validateTimeoutDeadline(state, action.payload, 'roll');
    if (deadlineRejection) return makeActionReject(deadlineRejection);
  }
  if (action.payload?.forcedResult !== undefined || action.payload?.allowForcedResult !== undefined) return makeActionReject('허용되지 않은 윷 결과입니다.');
  const clientRollResult = action.payload?.clientRollResult;
  if (clientRollResult !== undefined && !isAllowedGoldenYutResult(clientRollResult)) return makeActionReject('클라이언트 윷 결과가 유효하지 않습니다.');
  const clientFallOccurred = action.payload?.clientFallOccurred;
  if (clientFallOccurred !== undefined && typeof clientFallOccurred !== 'boolean') return makeActionReject('클라이언트 낙 결과가 유효하지 않습니다.');
  const clientFallCount = action.payload?.clientFallCount;
  if (clientFallCount !== undefined && (typeof clientFallCount !== 'number' || !Number.isInteger(clientFallCount) || clientFallCount < 0 || clientFallCount > 4)) return makeActionReject('클라이언트 낙 개수가 유효하지 않습니다.');
  if (clientFallOccurred === true && (typeof clientFallCount !== 'number' || clientFallCount < 1)) return makeActionReject('낙 결과에는 떨어진 윷 개수가 필요합니다.');
  if (clientFallOccurred === false && clientFallCount !== undefined && clientFallCount !== 0) return makeActionReject('정상 결과의 낙 개수는 0이어야 합니다.');
  const pendingGoldenYutSelection = state.pendingGoldenYutSelection as { actorId?: unknown; deadline?: unknown } | null | undefined;
  const pendingRerollStackIndex = state.rollStackClosed === false && typeof state.selectedRollStackIndex === 'number' ? state.selectedRollStackIndex : null;
  const pendingReroll = pendingRerollStackIndex !== null;
  if (state.itemPromptTiming === 'before_roll' || state.itemPromptTiming === 'after_roll' || state.itemPromptTiming === 'after_move' || typeof state.pendingAfterMoveTurnIndex === 'number') return makeActionReject('아이템 사용 여부를 먼저 선택해주세요.');
  if (!pendingGoldenYutSelection && !pendingReroll && !state.roll && hasUsableBeforeRollItem(state, action.actorId)) return makeActionReject('아이템 사용 여부를 먼저 선택해주세요.');
  if (room.stackedRollMode && state.rollStackClosed === true && !pendingReroll) return makeActionReject('이미 윷을 던졌습니다. 말을 이동해주세요.');
  const selectedGoldenYutResult = action.payload?.selectedGoldenYutResult;
  const pendingGoldenDeadline = Number(pendingGoldenYutSelection?.deadline ?? 0);
  const pendingGoldenTimedOut = Boolean(pendingGoldenYutSelection && pendingGoldenDeadline > 0 && Date.now() >= pendingGoldenDeadline);
  if (pendingGoldenYutSelection) {
    if (pendingGoldenYutSelection.actorId !== action.actorId) return makeActionReject('황금 윷 결과를 선택할 권한이 없습니다.');
    if (selectedGoldenYutResult !== undefined && !isAllowedGoldenYutResult(selectedGoldenYutResult)) return makeActionReject('허용되지 않은 황금 윷 결과입니다.');
    if (selectedGoldenYutResult === undefined && !pendingGoldenTimedOut) return makeActionReject('황금 윷 결과를 선택해주세요.');
  } else if (selectedGoldenYutResult !== undefined) return makeActionReject('황금 윷 선택 대기 상태가 아닙니다.');
  const timingZone = action.payload?.rollTimingZone;
  if (!isValidRollTimingZone(timingZone)) return makeActionReject('허용되지 않은 윷 입력 시간입니다.');
  if (pendingGoldenYutSelection && clientFallOccurred === true) return makeActionReject('황금 윷은 낙이 될 수 없습니다.');
  if (timingZone === 'perfect' && clientFallOccurred === true) return makeActionReject('Perfect 결과는 낙이 될 수 없습니다.');
  const nextRoll = pendingGoldenYutSelection && selectedGoldenYutResult === undefined && pendingGoldenTimedOut
    ? GOLDEN_YUT_CHOICES.find((choice) => choice.name === '도') ?? GOLDEN_YUT_CHOICES[0]
    : getAuthoritativeRoll(action.payload);
  const fallOccurred = pendingGoldenYutSelection ? false : typeof clientFallOccurred === 'boolean' ? clientFallOccurred : shouldFallForTimingZone(timingZone);
  const fallCount = fallOccurred ? typeof clientFallCount === 'number' ? clientFallCount : Math.floor(Math.random() * 4) + 1 : 0;
  const now = Date.now();
  const statePieces = state.pieces as AuthoritativePiece[];
  const shieldedPieceIds = (state.shieldedPieceIds ?? []).filter((pieceId) => {
    const piece = statePieces.find((entry) => entry.id === pieceId);
    return !canActorControlAuthoritativePiece(action.actorId, piece, room, sides);
  });
  const stateForRoll = { ...state, shieldedPieceIds, roll: room.stackedRollMode ? null : state.roll };
  let shouldPromptAfterRoll = false;
  const baseReduction = toAuthoritativeReduction(reduceRollCommand({
    state: makeEngineState(stateForRoll), actorId: action.actorId, nextRoll,
    actorLogName: getActionActorLogName(action), rollResultReadyAt: now + 2600,
    makeLog: makeAuthoritativeLog, fallOccurred, timingZone,
  }));
  if (isAuthoritativeCommitReduction(baseReduction)) {
    const nextTurnIndexAfterFall = Number(baseReduction.patch.turnIndex ?? state.turnIndex ?? 0);
    const shouldPromptFallReroll = fallOccurred && hasUsableAfterRollItem(state, action.actorId, nextRoll, room, sides, true);
    shouldPromptAfterRoll = !fallOccurred && (!room.stackedRollMode || !nextRoll.bonus) && hasUsableAfterRollItem(state, action.actorId, nextRoll, room, sides);
    const nextActiveSeatIdAfterFall = fallOccurred && !shouldPromptFallReroll ? (state.turnOrderIds ?? [])[nextTurnIndexAfterFall] : null;
    const shouldPromptBeforeRollAfterFall = Boolean(nextActiveSeatIdAfterFall && hasUsableBeforeRollItem({ ...state, ...baseReduction.patch } as SyncedGameStateShape, String(nextActiveSeatIdAfterFall)));
    const nextLogs = shouldPromptFallReroll && Array.isArray(baseReduction.patch.logs)
      ? (baseReduction.patch.logs as AuthoritativeLog[]).map((log, index) => index === 0 ? { ...log, text: `${getActionActorLogName(action)}님이 낙이 나왔습니다. 다시 던지기 아이템 사용 여부를 선택합니다.` } : log)
      : baseReduction.patch.logs;
    baseReduction.patch = {
      ...baseReduction.patch,
      shieldedPieceIds,
      ...(shouldPromptFallReroll ? { roll: nextRoll, turnIndex: Number(state.turnIndex ?? 0), pendingAfterMoveTurnIndex: nextTurnIndexAfterFall, logs: nextLogs } : {}),
      turnDeadlineAt: shouldPromptAfterRoll || shouldPromptFallReroll ? now + 2600 + TURN_ACTION_TIMEOUT_MS : fallOccurred ? now + TURN_ACTION_TIMEOUT_MS : now + 2600 + TURN_ACTION_TIMEOUT_MS,
      turnDeadlineKind: shouldPromptAfterRoll || shouldPromptFallReroll || shouldPromptBeforeRollAfterFall ? 'item_prompt' : fallOccurred ? 'roll' : 'move',
      itemPromptTiming: shouldPromptAfterRoll || shouldPromptFallReroll ? 'after_roll' : shouldPromptBeforeRollAfterFall ? 'before_roll' : null,
      pendingGoldenYutSelection: null,
      ...(pendingReroll ? { selectedRollStackIndex: null } : {}),
    };
    baseReduction.payload = { ...baseReduction.payload, displayRoll: nextRoll, fallOccurred, fallCount, timedOut: Boolean(action.payload?.timedOut), timeoutRecoveredBy: action.payload?.timeoutRecoveredBy ?? null, fallRerollPrompt: shouldPromptFallReroll };
  }
  if (!isAuthoritativeCommitReduction(baseReduction) || !room.stackedRollMode) return baseReduction;
  if (fallOccurred) return { ...baseReduction, patch: { ...baseReduction.patch, rollStack: [], selectedRollStackIndex: null, rollStackClosed: false } };
  const currentStack = ((state.rollStack as YutResult[] | undefined) ?? []);
  const replacementIndex = pendingReroll && pendingRerollStackIndex !== null ? Math.min(Math.max(0, pendingRerollStackIndex), currentStack.length) : currentStack.length;
  const nextStack = [...currentStack];
  nextStack.splice(replacementIndex, 0, nextRoll);
  return { ...baseReduction, patch: { ...baseReduction.patch, roll: null, rollStack: nextStack, selectedRollStackIndex: shouldPromptAfterRoll ? replacementIndex : null, rollStackClosed: !nextRoll.bonus }, payload: { ...baseReduction.payload, rollStack: nextStack, rollStackClosed: !nextRoll.bonus, rerolledStackIndex: pendingReroll ? replacementIndex : null } };
}
function reduceAuthoritativeMove""",
)
replace_once(
    path,
    "const getSelectedStackIndex = (state: SyncedGameStateShape) => {\n  if (typeof state.selectedRollStackIndex === 'number') return state.selectedRollStackIndex;\n  const stack = (state.rollStack as YutResult[] | undefined) ?? [];\n  if (!stack.length || !state.roll) return null;\n  const currentRoll = state.roll as YutResult;\n  const index = stack.findIndex((roll) => roll.name === currentRoll.name && roll.steps === currentRoll.steps && Boolean(roll.bonus) === Boolean(currentRoll.bonus));\n  return index >= 0 ? index : null;\n};",
    "const getSelectedStackIndex = (state: SyncedGameStateShape) => {\n  if (typeof state.selectedRollStackIndex === 'number') return state.selectedRollStackIndex;\n  const stack = (state.rollStack as YutResult[] | undefined) ?? [];\n  return stack.length === 1 ? 0 : null;\n};",
)
sub_once(
    path,
    r"function reduceItemPickupDecision\(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' \| 'createdAt' \| 'processed'>\): AuthoritativeReduction \{.*?\n\}\n\nfunction reduceUseItem",
    """function reduceItemPickupDecision(state: SyncedGameStateShape, action: Omit<GameActionShape, 'id' | 'createdAt' | 'processed'>): AuthoritativeReduction {
  const pending = state.pendingItemPickup as AuthoritativePendingItemPickup | null | undefined;
  if (!pending || pending.ownerId !== action.actorId || !pending.itemType || !pending.existingItemType) return makeActionReject('처리할 아이템 교체 대기가 없습니다.');
  const timeoutRecoveryRejection = validateItemPickupTimeoutRecovery(state, action, pending);
  if (timeoutRecoveryRejection) return makeActionReject(timeoutRecoveryRejection);
  const decision = action.payload?.decision === 'replace' ? 'replace' : action.payload?.decision === 'keep' || isItemPickupTimeoutRecoveryPayload(action.payload) ? 'keep' : '';
  if (!decision) return makeActionReject('아이템 교체 선택이 유효하지 않습니다.');
  const currentOwnedItems = { ...((state.ownedItems ?? {}) as Record<string, ItemType[]>) };
  const currentItems = [...(currentOwnedItems[action.actorId] ?? [])];
  const existingIndex = currentItems.indexOf(pending.existingItemType);
  if (existingIndex < 0) return makeActionReject('교체할 기존 아이템이 없습니다.');
  if (decision === 'replace') currentItems[existingIndex] = pending.itemType;
  const nextOwnedItems = { ...currentOwnedItems, [action.actorId]: currentItems };
  const logs = (state.logs as AuthoritativeLog[] | undefined) ?? [];
  const actorLogName = getActionActorLogName(action);
  const timedOut = isItemPickupTimeoutRecoveryPayload(action.payload);
  const logText = decision === 'replace'
    ? `${actorLogName}님이 아이템 '${ITEM_DEFINITIONS[pending.existingItemType].name}'을 '${ITEM_DEFINITIONS[pending.itemType].name}'으로 교체했습니다.`
    : timedOut
      ? `${actorLogName}님의 아이템 교체 시간이 만료되어 기존 아이템을 유지했습니다.`
      : `${actorLogName}님이 새 아이템 '${ITEM_DEFINITIONS[pending.itemType].name}'을 유지하지 않았습니다.`;
  const resumeAfterMove = pending.resumeItemPromptTiming === 'after_move' && typeof pending.resumePendingAfterMoveTurnIndex === 'number';
  return { status: 'committed', patch: { ownedItems: nextOwnedItems, pendingItemPickup: null, itemPromptTiming: resumeAfterMove ? 'after_move' : null, pendingAfterMoveTurnIndex: resumeAfterMove ? pending.resumePendingAfterMoveTurnIndex : null, turnIndex: resumeAfterMove ? Number(state.turnIndex ?? 0) : Number(pending.nextTurnIndex ?? state.turnIndex ?? 0), turnDeadlineAt: Date.now() + TURN_ACTION_TIMEOUT_MS, turnDeadlineKind: resumeAfterMove ? 'item_prompt' : 'roll', logs: [makeAuthoritativeLog(logs, logText), ...logs] }, payload: { activeSeatId: action.actorId, decision, itemType: pending.itemType, existingItemType: pending.existingItemType, itemPickupTimeoutRecovery: timedOut } };
}

function reduceUseItem""",
)
replace_once(
    path,
    "    const now = Date.now();\n    return {\n      status: 'committed',\n      patch: {\n        itemPromptTiming: null,\n        ...(room.stackedRollMode",
    "    const now = Date.now();\n    const fallAdvanceTurnIndex = state.fallEffect && typeof state.pendingAfterMoveTurnIndex === 'number' ? state.pendingAfterMoveTurnIndex : null;\n    if (fallAdvanceTurnIndex !== null) {\n      const nextActiveSeatId = (state.turnOrderIds ?? [])[fallAdvanceTurnIndex];\n      const shouldPromptBeforeRoll = Boolean(nextActiveSeatId && hasUsableBeforeRollItem(state, String(nextActiveSeatId)));\n      return { status: 'committed', patch: { itemPromptTiming: shouldPromptBeforeRoll ? 'before_roll' : null, pendingAfterMoveTurnIndex: null, fallEffect: null, roll: null, turnIndex: fallAdvanceTurnIndex, turnDeadlineAt: now + TURN_ACTION_TIMEOUT_MS, turnDeadlineKind: shouldPromptBeforeRoll ? 'item_prompt' : 'roll' }, payload: { activeSeatId: action.actorId, skippedAfterRollItem: true, skippedFallReroll: true } };\n    }\n    return {\n      status: 'committed',\n      patch: {\n        itemPromptTiming: null,\n        ...(room.stackedRollMode",
)
replace_once(
    path,
    "  const nextOwnedItems = removeOneItem(state.ownedItems, action.actorId, itemType);",
    "  const pendingFallReroll = itemTiming === 'after_roll' && Boolean(state.fallEffect) && typeof state.pendingAfterMoveTurnIndex === 'number';\n  if (pendingFallReroll && itemType !== 'reroll') return makeActionReject('낙 이후에는 다시 던지기 아이템만 사용할 수 있습니다.');\n  const nextOwnedItems = removeOneItem(state.ownedItems, action.actorId, itemType);",
)
replace_once(
    path,
    "  if (itemType === 'reroll') {\n    if (action.payload?.replacementRoll !== undefined) return makeActionReject('허용되지 않은 다시 던지기 결과입니다.');\n    const rerollLog",
    "  if (itemType === 'reroll') {\n    if (action.payload?.replacementRoll !== undefined) return makeActionReject('허용되지 않은 다시 던지기 결과입니다.');\n    const rerollLog",
)
replace_once(
    path,
    "    const rerollLog = makeAuthoritativeLog(logs, `${actorLogName}님이 다시 던지기 아이템을 사용했습니다. 다시 윷을 던집니다.`);\n    if (room.stackedRollMode) {",
    "    const rerollLog = makeAuthoritativeLog(logs, `${actorLogName}님이 다시 던지기 아이템을 사용했습니다. 다시 윷을 던집니다.`);\n    if (pendingFallReroll) {\n      return { status: 'committed', patch: { ownedItems: nextOwnedItems, roll: null, rollStack: [], selectedRollStackIndex: null, rollStackClosed: false, rollResultReadyAt: 0, pendingAfterMoveTurnIndex: null, fallEffect: null, turnDeadlineAt: now + TURN_ACTION_TIMEOUT_MS, turnDeadlineKind: 'roll', itemPromptTiming: null, logs: [rerollLog, ...logs] }, payload: { activeSeatId: action.actorId, itemType, rerollReady: true, rerolledFall: true } };\n    }\n    if (room.stackedRollMode) {",
)
replace_once(
    path,
    "      pendingTrapPlacement: null,\n      pendingAfterMoveTurnIndex: null,",
    "      pendingTrapPlacement: null,\n      pendingItemPickup: null,\n      pendingAfterMoveTurnIndex: null,",
)

# Fall presentation wrapper must preserve a fall roll while asking about reroll.
path = "src/features/room/services/roomAuthoritativeReducer.ts"
replace_once(
    path,
    "  return {\n    ...reduction,\n    patch: {\n      ...reduction.patch,\n      roll: null,\n      rollResultReadyAt: readyAt,",
    "  const keepFallRerollPrompt = reduction.patch.itemPromptTiming === 'after_roll' && reduction.patch.roll != null;\n  return {\n    ...reduction,\n    patch: {\n      ...reduction.patch,\n      roll: keepFallRerollPrompt ? reduction.patch.roll : null,\n      rollResultReadyAt: readyAt,",
)

# 4) Authoritative permission for item-pickup timeout coordinator recovery and full state replacement.
path = "src/features/room/services/roomServiceCore.ts"
replace_once(
    path,
    "const isExpiredTrapPlacementTimeoutRecoveryAction = (state: SyncedGameState, action:",
    "const isExpiredItemPickupTimeoutRecoveryAction = (state: SyncedGameState, action: Omit<GameAction, 'id' | 'createdAt' | 'processed'>) => {\n  const pending = state.pendingItemPickup as { ownerId?: unknown; deadline?: unknown } | null | undefined;\n  return action.type === 'item_pickup_decision'\n    && action.payload?.itemPickupTimeoutRecovery === true\n    && pending?.ownerId === action.actorId\n    && typeof pending.deadline === 'number'\n    && action.payload?.timeoutDeadlineAt === pending.deadline\n    && Date.now() >= pending.deadline + TURN_NETWORK_GRACE_MS;\n};\n\nconst isExpiredTrapPlacementTimeoutRecoveryAction = (state: SyncedGameState, action:",
)
replace_once(
    path,
    "const allowCoordinator = isExpiredItemPromptTimeoutRecoveryAction(state, action) || isExpiredTrapPlacementTimeoutRecoveryAction(state, action);",
    "const allowCoordinator = isExpiredItemPromptTimeoutRecoveryAction(state, action) || isExpiredItemPickupTimeoutRecoveryAction(state, action) || isExpiredTrapPlacementTimeoutRecoveryAction(state, action);",
)
replace_once(
    path,
    "transaction.set(gameStateRef, { ...makeFirestoreStateData(state), updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, lastClientMutationId: meta.clientMutationId }, { merge: true });",
    "transaction.set(gameStateRef, { ...makeFirestoreStateData(state), updatedAt: serverTimestamp(), turnVersion: nextVersion, lastSequence: nextSequence, lastClientMutationId: meta.clientMutationId });",
)

# 5) Complete initial-state reset.
path = "src/app/flows/gameStartPreparation.ts"
replace_once(
    path,
    "    pendingTrapPlacement: null,\n    pendingItemPickup: null,",
    "    pendingTrapPlacement: null,\n    pendingItemPickup: null,\n    pendingAfterMoveTurnIndex: null,",
)
replace_once(
    path,
    "    lastMovedSeatId: '',\n    itemPromptTiming: null,",
    "    lastMovedSeatId: '',\n    itemPromptTiming: null,\n    pendingAfterMoveTurnIndex: null,",
)

# 6) Waiting-room reset: remove disconnected substitutes and clear non-host human readiness.
path = "src/features/room/services/roomService.ts"
sub_once(
    path,
    r"export async function updateRoomStatus\(roomId: string, status: RoomSummary\['status'\]\) \{.*?\n\}",
    """export async function updateRoomStatus(roomId: string, status: RoomSummary['status']) {
  await updateRoomStatusCore(roomId, status);
  if (!db) return;
  if (status === 'waiting') {
    const [room, players] = await Promise.all([getManagedRoom(roomId), getRoomPlayers(roomId)]);
    const remainingPlayers = players.filter((player) => !player.isSubstitutedByAI);
    const batch = writeBatch(db);
    players.forEach((player) => {
      if (player.isSubstitutedByAI) {
        batch.delete(doc(db!, 'rooms', roomId, 'players', player.id));
        if (Number.isInteger(Number(player.seatIndex)) && Number(player.seatIndex) >= 0) batch.delete(doc(db!, 'rooms', roomId, 'seats', String(Number(player.seatIndex))));
        return;
      }
      if (!player.isAI && player.id !== room?.hostId && player.ready) batch.set(doc(db!, 'rooms', roomId, 'players', player.id), { ready: false }, { merge: true });
    });
    batch.set(doc(db, 'rooms', roomId), { currentPlayers: countActivePlayers(remainingPlayers), lastActivityAt: Date.now(), deletingAt: null }, { merge: true });
    await batch.commit();
    return;
  }
  await setDoc(doc(db, 'rooms', roomId), { lastActivityAt: Date.now(), ...(status !== 'finished' ? { deletingAt: null } : {}) }, { merge: true });
}""",
)

# 7) App integration.
path = "src/app/App.tsx"
replace_once(
    path,
    "import { calculatePieceSelection } from './flows/pieceSelection';",
    "import { calculatePieceSelection } from './flows/pieceSelection';\nimport { resolveEffectiveMoveContext } from './flows/effectiveMoveContext';",
)
replace_once(
    path,
    "  const stackedRollSelectedResult = stackedRollMode && rollStackClosed && rollStack.length ? (typeof selectedRollStackIndex === 'number' ? rollStack[selectedRollStackIndex] : rollStack.length === 1 ? rollStack[0] : null) : null;\n  const selectedMoveSteps = (stackedRollSelectedResult ?? roll)?.steps ?? 0;",
    "  const effectiveMoveContext = useMemo(() => resolveEffectiveMoveContext({ stackedRollMode, roll, rollStack, rollStackClosed, selectedRollStackIndex }), [roll, rollStack, rollStackClosed, selectedRollStackIndex, stackedRollMode]);\n  const stackedRollSelectedResult = effectiveMoveContext.fromStack ? effectiveMoveContext.roll : null;\n  const selectedMoveSteps = effectiveMoveContext.steps;",
)
replace_once(
    path,
    "const previewNodeIds = useMemo(() => canRequestMove && canSeatControlPiece(activeSeat, selectedPiece) ? getMovePreviewNodeIds(selectedPiece, roll, displayBranchChoice) : [], [activeSeat, canRequestMove, displayBranchChoice, roll, selectedPiece]);",
    "const previewNodeIds = useMemo(() => canRequestMove && canSeatControlPiece(activeSeat, selectedPiece) ? getMovePreviewNodeIds(selectedPiece, effectiveMoveContext.roll, displayBranchChoice) : [], [activeSeat, canRequestMove, displayBranchChoice, effectiveMoveContext.roll, selectedPiece]);",
)
sub_once(
    path,
    r"  const stalledTurnMovablePieces = useMemo\(\(\) => \{.*?\n  \}, \[activeSeat, pieces, roll\]\);",
    """  const stalledTurnMovablePieces = useMemo(() => {
    const stalledRoll = effectiveMoveContext.roll;
    if (!stalledRoll || !activeSeat) return [];
    const steps = stalledRoll.steps;
    return pieces.filter((piece) => canSeatControlPiece(activeSeat, piece) && !piece.finished && (steps >= 0 || piece.started));
  }, [activeSeat, effectiveMoveContext.roll, pieces]);""",
)
replace_once(
    path,
    "    const overriddenStackRoll = typeof options.rollStackIndexOverride === 'number' ? rollStack[options.rollStackIndexOverride] : null;\n    const effectiveMoveRoll = overriddenStackRoll ?? stackedRollSelectedResult ?? roll;",
    "    const moveContext = resolveEffectiveMoveContext({ stackedRollMode, roll, rollStack, rollStackClosed, selectedRollStackIndex, rollStackIndexOverride: options.rollStackIndexOverride });\n    const overriddenStackRoll = typeof options.rollStackIndexOverride === 'number' ? moveContext.roll : null;\n    const effectiveMoveRoll = moveContext.roll;",
)
replace_once(
    path,
    "if (type === 'move_piece') return `${type}:${localSeatId}:${turnKey}:${payload.pieceId ?? ''}:${payload.extraSteps ?? 0}:${payload.branchChoice ?? ''}`;",
    "if (type === 'move_piece') return `${type}:${localSeatId}:${turnKey}:${payload.pieceId ?? ''}:${payload.extraSteps ?? 0}:${payload.branchChoice ?? ''}:stack:${payload.rollStackIndex ?? 'none'}`;",
)
replace_once(
    path,
    "return `${type}:${localSeatId}:${turnKey}:${payload.itemType ?? ''}:${payload.pieceId ?? ''}`;",
    "return `${type}:${localSeatId}:${turnKey}:${payload.itemType ?? ''}:${payload.pieceId ?? ''}:stack:${payload.rollStackIndex ?? 'none'}:${payload.skipBeforeRollItem ? 'skip-before' : payload.skipAfterRollItem ? 'skip-after' : payload.skipAfterMoveItem ? 'skip-move' : ''}`;",
)
replace_once(
    path,
    "  function submitPendingItemPickupDecision(pickup: PendingItemPickup, decision: 'keep' | 'replace') {",
    "  function submitPendingItemPickupDecision(pickup: PendingItemPickup, decision: 'keep' | 'replace', options: { timedOut?: boolean } = {}) {",
)
replace_once(
    path,
    "    const payload = { decision, itemId: pickup.itemId, itemType: pickup.item, existingItemType: pickup.existingItem };",
    "    const payload = { decision, itemId: pickup.itemId, itemType: pickup.item, existingItemType: pickup.existingItem, ...(options.timedOut ? { itemPickupTimeoutRecovery: true, timeoutDeadlineAt: pickup.deadline, timeoutRecoveredBy: localSeatId } : {}) };",
)
sub_once(
    path,
    r"    const syncedPendingItemPickup = \(state as \{ pendingItemPickup\?: \{ ownerId\?: unknown; itemType\?: unknown; itemId\?: unknown; existingItemType\?: unknown; deadline\?: unknown \} \| null \}\)\.pendingItemPickup \?\? null;\n    if \(syncedPendingItemPickup && syncedPendingItemPickup\.ownerId === localSeatId.*?\n    \} else if \(!syncedPendingItemPickup && pendingItemPickupRef\.current && activeRoomId\) \{",
    """    const syncedPendingItemPickup = (state as { pendingItemPickup?: { ownerId?: unknown; itemType?: unknown; itemId?: unknown; existingItemType?: unknown; deadline?: unknown } | null }).pendingItemPickup ?? null;
    if (syncedPendingItemPickup && typeof syncedPendingItemPickup.ownerId === 'string' && typeof syncedPendingItemPickup.itemType === 'string' && typeof syncedPendingItemPickup.existingItemType === 'string') {
      const nextPendingItemPickup = { seatId: String(syncedPendingItemPickup.ownerId), item: syncedPendingItemPickup.itemType as ItemType, itemId: String(syncedPendingItemPickup.itemId ?? ''), existingItem: syncedPendingItemPickup.existingItemType as ItemType, deadline: Number(syncedPendingItemPickup.deadline ?? Date.now() + ITEM_REPLACE_TIMEOUT_MS) };
      pendingItemPickupRef.current = nextPendingItemPickup;
      setPendingItemPickup(nextPendingItemPickup);
    } else if (!syncedPendingItemPickup && pendingItemPickupRef.current && activeRoomId) {""",
)
sub_once(
    path,
    r"  useEffect\(\(\) => \{\n    if \(!pendingItemPickup\) return undefined;\n    setItemPickupClock\(Date\.now\(\)\);.*?\n  \}, \[pendingItemPickup\?\.deadline\]\);",
    """  useEffect(() => {
    if (!pendingItemPickup) return undefined;
    setItemPickupClock(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      setItemPickupClock(now);
      if (now < pendingItemPickup.deadline) return;
      if (activeRoomId) {
        if (pendingItemPickup.seatId !== localSeatId && !canCoordinateOnlineGame) return;
        if (submitPendingItemPickupDecision(pendingItemPickup, 'keep', { timedOut: true })) resolvePendingItemPickup();
        return;
      }
      keepPendingItemPickup(pendingItemPickup);
    }, 250);
    return () => window.clearInterval(timer);
  }, [activeRoomId, canCoordinateOnlineGame, localSeatId, pendingItemPickup?.deadline, pendingItemPickup?.seatId]);""",
)
replace_once(
    path,
    "      pendingItemPickup={pendingItemPickup}",
    "      pendingItemPickup={pendingItemPickup?.seatId === localSeatId ? pendingItemPickup : null}",
)
sub_once(
    path,
    r"  function getUsableHostItems\(timing: ItemTiming\) \{.*?\n  \}",
    """  function getUsableHostItems(timing: ItemTiming) {
    if (movingPieceId || winner) return [];
    if (timing === 'before_roll' && (!isMyTurn || effectiveMoveContext.roll)) return [];
    if (timing === 'after_roll' && selectedMoveSteps < 0 && !activeSeatPiecesOnBoard && typeof pendingAfterMoveTurnIndex !== 'number') return [];
    if (timing === 'after_roll' && (!isMyTurn || !effectiveMoveContext.roll)) return [];
    if (timing === 'after_move' && lastMovedSeatId !== localSeatId) return [];
    const pendingFallReroll = timing === 'after_roll' && typeof pendingAfterMoveTurnIndex === 'number';
    return (ownedItems[localSeatId] ?? []).filter((type) => {
      if (ITEM_DEFINITIONS[type].timing !== timing) return false;
      if (pendingFallReroll) return type === 'reroll';
      const movedPiece = lastMovedPieceIds.map((id) => pieces.find((piece) => piece.id === id && canSeatControlPiece(getSeatById(localSeatId), piece) && piece.started && !piece.finished)).find((piece): piece is BoardPiece => Boolean(piece));
      if ((type === 'shield' || type === 'trap') && !movedPiece) return false;
      if (type === 'trap' && movedPiece && getTrapCandidateNodeIds(movedPiece.nodeId).length === 0) return false;
      return true;
    });
  }""",
)
replace_once(
    path,
    "    const itemActionPayload = { itemType: type, pieceId: selectedPieceId, branchChoice };",
    "    const itemActionPayload = { itemType: type, pieceId: selectedPieceId, branchChoice, rollStackIndex: effectiveMoveContext.rollStackIndex };",
)
replace_once(
    path,
    "      const payload = { ...itemActionPayload, pieceId: (type === 'trap' || type === 'shield') ? (lastMovedPieceIds[0] ?? selectedPieceId) : selectedPieceId, rollStackIndex: selectedRollStackIndex };",
    "      const payload = { ...itemActionPayload, pieceId: (type === 'trap' || type === 'shield') ? (lastMovedPieceIds[0] ?? selectedPieceId) : selectedPieceId, rollStackIndex: effectiveMoveContext.rollStackIndex };",
)
replace_once(
    path,
    "      if (activeSeat?.id !== itemOwnerId || !roll) return;\n      const rerollStackIndex = typeof selectedRollStackIndex === 'number' ? selectedRollStackIndex : Math.max(0, rollStack.length - 1);",
    "      const itemRoll = effectiveMoveContext.roll;\n      if (activeSeat?.id !== itemOwnerId || !itemRoll) return;\n      const rerollStackIndex = effectiveMoveContext.rollStackIndex ?? Math.max(0, rollStack.length - 1);",
)
replace_once(
    path,
    "      if (activeSeat?.id !== itemOwnerId || !roll) return;\n      submitItemActionIfRemote();\n      const itemMoveSteps = type === 'move_plus_one' ? 1 : -1;\n      const nextRoll = { ...roll, steps: roll.steps + itemMoveSteps };",
    "      const itemRoll = effectiveMoveContext.roll;\n      if (activeSeat?.id !== itemOwnerId || !itemRoll) return;\n      submitItemActionIfRemote();\n      const itemMoveSteps = type === 'move_plus_one' ? 1 : -1;\n      const nextRoll = { ...itemRoll, steps: itemRoll.steps + itemMoveSteps };",
)
replace_once(
    path,
    "      setSelectedRollStackIndex(stackedRollMode ? rerollStackIndex : -1);\n      setRollStackClosed(false);",
    "      setSelectedRollStackIndex(stackedRollMode ? rerollStackIndex : -1);\n      setPendingAfterMoveTurnIndex(null);\n      setFallEffect(null);\n      setRollStackClosed(false);",
)
sub_once(
    path,
    r"  function applyLocalFall\(seat: Seat, timingZone: RollTimingZone, displayRoll: YutResult, sourceAction: Omit<GameAction, 'id' \| 'createdAt' \| 'processed'> \| null = null, options: \{ recordSequence\?: boolean \} = \{\}\) \{.*?\n  \}\n\n  function openCriticalActionErrorDialog",
    """  function applyLocalFall(seat: Seat, timingZone: RollTimingZone, displayRoll: YutResult, sourceAction: Omit<GameAction, 'id' | 'createdAt' | 'processed'> | null = null, options: { recordSequence?: boolean } = {}) {
    const fallStartedAt = Date.now();
    const fallCount = Math.floor(Math.random() * 4) + 1;
    const nextTurnIndex = (turnIndex + 1) % Math.max(turnSeats.length, 1);
    const canPromptReroll = (ownedItems[seat.id] ?? []).includes('reroll');
    rollInProgressRef.current = true;
    rollInProgressStartedAtRef.current = fallStartedAt;
    setRollInProgress(true);
    setShieldedPieceIds((ids) => ids.filter((id) => {
      const piece = pieces.find((entry) => entry.id === id);
      return !canSeatControlPiece(seat, piece);
    }));
    setRoll(canPromptReroll ? displayRoll : null);
    currentRollRef.current = canPromptReroll ? displayRoll : null;
    setRollResultReadyAt(0);
    setTurnDeadlineAt(fallStartedAt + ROLL_ANIMATION_MS + (canPromptReroll ? getItemPromptTimeoutMs(seat.id) : TURN_ACTION_TIMEOUT_MS));
    setTurnDeadlineKind(canPromptReroll ? 'item_prompt' : 'roll');
    setBranchChoice('outer');
    setLastMovedPieceIds([]);
    setLastMovedSeatId(seat.id);
    setFallEffect({ id: fallStartedAt, seatId: seat.id, timingZone });
    setLastRollTimingZone(timingZone);
    playRollAnimationOnce(displayRoll, makeDisplaySticks(displayRoll), `fall:${seat.id}:${turnIndex}:${fallStartedAt}`, false, fallCount, timingZone);
    playSfx('roll');
    window.setTimeout(() => {
      rollInProgressRef.current = false;
      rollInProgressStartedAtRef.current = 0;
      setRollInProgress(false);
      if (canPromptReroll) {
        setItemPromptTiming('after_roll');
        setPendingAfterMoveTurnIndex(nextTurnIndex);
        addLog(`${getSeatDisplayName(seat)}님이 낙이 나왔습니다. 다시 던지기 아이템 사용 여부를 선택합니다.`);
      } else {
        setTurnIndex(nextTurnIndex);
        addLog(`${getSeatDisplayName(seat)}님이 낙이 나와 차례를 넘깁니다.`);
      }
      if (options.recordSequence !== false) pendingSequenceMetaRef.current = { type: 'roll_yut', actorId: seat.id, clientMutationId: sourceAction && typeof sourceAction.payload?.clientActionId === 'string' ? sourceAction.payload.clientActionId : `roll_yut_fall:${seat.id}:${turnIndex}:${fallStartedAt}`, payload: { turnIndex, activeSeatId: seat.id, fallOccurred: true, rollTimingZone: timingZone }, action: sourceAction ?? null };
    }, ROLL_ANIMATION_MS);
  }

  function openCriticalActionErrorDialog""",
)
replace_once(
    path,
    "    if (steps === 0) {\n      addLog(`${getSeatDisplayName(seat)}님의 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);\n      setBranchChoice('outer');\n      if (!options.deferFinalizationToAuthoritative) {\n        clearRoll();\n        setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));\n      }\n      setMoveInProgressState(false);\n      return true;\n    }",
    "    if (steps === 0) {\n      addLog(`${getSeatDisplayName(seat)}님의 말은 이동할 칸 수가 없어 제자리에 머뭅니다.`);\n      setBranchChoice('outer');\n      setLastMovedPieceIds([movingPiece.id]);\n      setLastMovedSeatId(seat.id);\n      if (!options.deferFinalizationToAuthoritative) {\n        const hasAfterMoveItem = (ownedItems[seat.id] ?? []).some((type) => type === 'shield' || (type === 'trap' && getTrapCandidateNodeIds(movingPiece.nodeId).length > 0));\n        clearRoll();\n        if (hasAfterMoveItem) {\n          shouldAdvanceTurnAfterItemPromptRef.current = true;\n          setItemPromptTiming('after_move');\n          setPendingAfterMoveTurnIndex((turnIndex + 1) % Math.max(turnSeats.length, 1));\n          setTurnDeadlineAt(Date.now() + getItemPromptTimeoutMs(seat.id));\n          setTurnDeadlineKind('item_prompt');\n        } else {\n          setTurnIndex((current) => (current + 1) % Math.max(turnSeats.length, 1));\n          setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);\n          setTurnDeadlineKind('roll');\n        }\n      }\n      setMoveInProgressState(false);\n      return true;\n    }",
)
replace_once(
    path,
    "        setItemPromptTiming(null);\n        markItemPromptResolved(itemPromptTiming, selectedRollStackIndex);\n        if (itemPromptTiming === 'after_move') finishPendingAfterMoveTurnAdvance();",
    "        const skippedTiming = itemPromptTiming;\n        setItemPromptTiming(null);\n        markItemPromptResolved(skippedTiming, selectedRollStackIndex);\n        if (skippedTiming === 'after_move') finishPendingAfterMoveTurnAdvance();\n        else if (skippedTiming === 'after_roll' && typeof pendingAfterMoveTurnIndex === 'number') {\n          clearRoll();\n          setTurnIndex(pendingAfterMoveTurnIndex);\n          setPendingAfterMoveTurnIndex(null);\n          setFallEffect(null);\n          setTurnDeadlineAt(Date.now() + TURN_ACTION_TIMEOUT_MS);\n          setTurnDeadlineKind('roll');\n        }",
)
sub_once(
    path,
    r"  function returnToWaitingRoom\(\) \{.*?\n  \}",
    """  function returnToWaitingRoom() {
    const finishedRoomId = activeRoomId;
    setSeats((currentSeats) => currentSeats.map((seat) => {
      if (seat.isSubstitutedByAI) return { ...seat, id: `slot-${Number(seat.label.replace('P', ''))}`, name: '빈 자리', ready: false, isAI: false, isSubstitutedByAI: false, isEmpty: true, isHost: false };
      if (!seat.isAI && seat.id !== activeRoomHostId) return { ...seat, ready: false };
      return seat;
    }));
    setScreen(finishedRoomId ? 'waitingRoom' : 'lobby');
    setCountdown(-1);
    setItemPromptTiming(null);
    setPendingItemPickup(null);
    pendingItemPickupRef.current = null;
    setEndGameDialogOpen(false);
    setMessage(finishedRoomId ? '방 대기실로 돌아왔습니다.' : '첫 대기화면으로 돌아왔습니다.');
    if (finishedRoomId) void updateRoomStatus(finishedRoomId, 'waiting').catch((error) => console.warn('완주 후 방 대기실 전환에 실패했습니다.', error));
  }""",
)
replace_once(
    path,
    "       pendingTrapPlacement: null,\n       rollLockUntil: 0,",
    "       pendingTrapPlacement: null,\n       pendingItemPickup: null,\n       pendingGoldenYutSelection: null,\n       pendingAfterMoveTurnIndex: null,\n       rollLockUntil: 0,",
)
replace_once(
    path,
    "         pendingTrapPlacement: null,\n         rollLockUntil: 0,",
    "         pendingTrapPlacement: null,\n         pendingItemPickup: null,\n         pendingGoldenYutSelection: null,\n         pendingAfterMoveTurnIndex: null,\n         rollLockUntil: 0,",
)

# 8) Basic unit coverage for shared effective context and reducer regressions.
write("tests/unit/effectiveMoveContext.test.ts", """import assert from 'node:assert/strict';
import { resolveEffectiveMoveContext } from '../../src/app/flows/effectiveMoveContext.js';

const doRoll = { name: '도' as const, steps: 1, bonus: false };
const geolRoll = { name: '걸' as const, steps: 3, bonus: false };

assert.deepEqual(resolveEffectiveMoveContext({ stackedRollMode: false, roll: doRoll, rollStack: [], rollStackClosed: false, selectedRollStackIndex: null }), { roll: doRoll, rollStackIndex: null, steps: 1, fromStack: false });
assert.equal(resolveEffectiveMoveContext({ stackedRollMode: true, roll: null, rollStack: [doRoll, geolRoll], rollStackClosed: true, selectedRollStackIndex: 1 }).steps, 3);
assert.equal(resolveEffectiveMoveContext({ stackedRollMode: true, roll: null, rollStack: [doRoll], rollStackClosed: true, selectedRollStackIndex: null }).rollStackIndex, 0);
assert.equal(resolveEffectiveMoveContext({ stackedRollMode: true, roll: null, rollStack: [doRoll, geolRoll], rollStackClosed: true, selectedRollStackIndex: null }).roll, null);
""")
replace_once(
    "tsconfig.test.json",
    '    "src/app/flows/gameStartPreparation.ts",',
    '    "src/app/flows/gameStartPreparation.ts",\n    "src/app/flows/effectiveMoveContext.ts",',
)

# Remove the temporary patch machinery in the committed result.
(ROOT / "scripts/agent_item_turn_patch.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/agent-item-turn-patch.yml").unlink(missing_ok=True)
print("patch applied")
