import type { YutResult } from '../../../game-core/roll';

type RollFingerprint = { name: string; steps: number; bonus: boolean };
type SelectionIdentity = {
  expectedPreviousSequence: number;
  expectedTurnVersion: number;
  expectedTurnIndex: number;
  rollStackIndex: number;
  roll: RollFingerprint;
};
type StackContext = Omit<SelectionIdentity, 'rollStackIndex' | 'roll'> & {
  rollStack: RollFingerprint[];
  rollStackClosed: boolean;
};
type MoveAction = { type: string; actorId: string; payload?: Record<string, unknown> };
type MoveState = {
  lastSequence?: unknown;
  turnVersion?: unknown;
  turnIndex?: unknown;
  rollStack?: unknown;
  rollStackClosed?: unknown;
};

export const STACKED_MOVE_SELECTION_STALE_REASON = '선택한 누적 윷 결과가 최신 상태와 일치하지 않습니다. 최신 상태에서 다시 선택해주세요.';

const MAX_FROZEN_SELECTION_IDENTITIES = 64;
let authoritativeContext: StackContext | null = null;
let clientSelection: SelectionIdentity | null = null;
const frozenSelectionByActionId = new Map<string, SelectionIdentity>();

const integer = (value: unknown) => Number.isSafeInteger(Number(value)) ? Number(value) : null;
const rollFingerprint = (value: unknown): RollFingerprint | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const roll = value as { name?: unknown; steps?: unknown; bonus?: unknown };
  const steps = Number(roll.steps);
  return typeof roll.name === 'string' && roll.name && Number.isFinite(steps)
    ? { name: roll.name, steps, bonus: roll.bonus === true }
    : null;
};
const stackFingerprint = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const stack = value.map(rollFingerprint);
  return stack.every((roll): roll is RollFingerprint => Boolean(roll)) ? stack : null;
};
const rollMatches = (left: RollFingerprint, right: RollFingerprint) => (
  left.name === right.name && left.steps === right.steps && left.bonus === right.bonus
);
const stackMatches = (left: RollFingerprint[], right: RollFingerprint[]) => (
  left.length === right.length && left.every((roll, index) => rollMatches(roll, right[index]))
);
const cloneSelectionIdentity = (selection: SelectionIdentity): SelectionIdentity => ({
  ...selection,
  roll: { ...selection.roll },
});
const rememberFrozenSelection = (actionId: string, selection: SelectionIdentity) => {
  if (!actionId) return;
  frozenSelectionByActionId.set(actionId, cloneSelectionIdentity(selection));
  while (frozenSelectionByActionId.size > MAX_FROZEN_SELECTION_IDENTITIES) {
    const oldestActionId = frozenSelectionByActionId.keys().next().value;
    if (typeof oldestActionId !== 'string') break;
    frozenSelectionByActionId.delete(oldestActionId);
  }
};
const selectionMatchesAction = (
  selection: SelectionIdentity | null | undefined,
  expected: { expectedPreviousSequence: number; expectedTurnIndex: number },
  stackIndex: number,
) => Boolean(
  selection
  && selection.rollStackIndex === stackIndex
  && selection.expectedPreviousSequence === expected.expectedPreviousSequence
  && selection.expectedTurnIndex === expected.expectedTurnIndex
);
const manualIdentity = (action: MoveAction) => {
  const id = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const prefix = `move_piece:${action.actorId}:`;
  if (action.type !== 'move_piece' || !id.startsWith(prefix)
    || action.payload?.recoveredByCoordinator === true
    || action.payload?.deadlineAutoSubmitted === true
    || typeof action.payload?.automationSource === 'string'
    || typeof action.payload?.coordinatorSeatId === 'string') return null;
  const [sequenceText = '', turnText = ''] = id.slice(prefix.length).split(':', 2);
  if (!/^\d+$/.test(sequenceText) || !/^\d+$/.test(turnText)) return null;
  return { expectedPreviousSequence: Number(sequenceText), expectedTurnIndex: Number(turnText) };
};
const payloadIdentity = (action: MoveAction): SelectionIdentity | null => {
  const raw = action.payload?.stackedMoveSelection;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const identity = {
    expectedPreviousSequence: integer(value.expectedPreviousSequence),
    expectedTurnVersion: integer(value.expectedTurnVersion),
    expectedTurnIndex: integer(value.expectedTurnIndex),
    rollStackIndex: integer(value.rollStackIndex),
    roll: rollFingerprint(value.roll),
  };
  return Object.values(identity).some((entry) => entry === null) || Number(identity.rollStackIndex) < 0
    ? null
    : identity as SelectionIdentity;
};

export function publishAuthoritativeStackedMoveContext(state: unknown) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const value = state as MoveState;
  const lastSequence = integer(value.lastSequence);
  const turnVersion = integer(value.turnVersion);
  const turnIndex = integer(value.turnIndex);
  const rollStack = stackFingerprint(value.rollStack);
  if (lastSequence === null || turnVersion === null || turnIndex === null || !rollStack) return false;
  authoritativeContext = {
    expectedPreviousSequence: lastSequence,
    expectedTurnVersion: turnVersion,
    expectedTurnIndex: turnIndex,
    rollStack,
    rollStackClosed: value.rollStackClosed === true,
  };
  if (clientSelection && (
    clientSelection.expectedPreviousSequence !== lastSequence
    || clientSelection.expectedTurnVersion !== turnVersion
    || clientSelection.expectedTurnIndex !== turnIndex
  )) clientSelection = null;
  for (const [actionId, selection] of frozenSelectionByActionId) {
    if (selection.expectedPreviousSequence < lastSequence || selection.expectedTurnIndex !== turnIndex) {
      frozenSelectionByActionId.delete(actionId);
    }
  }
  return true;
}

export function clearStackedMoveSelectionIdentityContext() {
  authoritativeContext = null;
  clientSelection = null;
  frozenSelectionByActionId.clear();
}

export function captureStackedMoveSelectionIdentity({ rollStack, rollStackClosed, rollStackIndex }: {
  rollStack: YutResult[];
  rollStackClosed: boolean;
  rollStackIndex: number;
}) {
  const displayedStack = stackFingerprint(rollStack);
  const current = authoritativeContext;
  if (!displayedStack || !Number.isInteger(rollStackIndex) || !displayedStack[rollStackIndex]) {
    clientSelection = null;
    return 'invalid' as const;
  }
  if (!current) return 'untracked' as const;
  if (current.rollStackClosed !== rollStackClosed || !stackMatches(current.rollStack, displayedStack)) {
    clientSelection = null;
    return 'stale' as const;
  }
  clientSelection = {
    expectedPreviousSequence: current.expectedPreviousSequence,
    expectedTurnVersion: current.expectedTurnVersion,
    expectedTurnIndex: current.expectedTurnIndex,
    rollStackIndex,
    roll: displayedStack[rollStackIndex],
  };
  return 'ready' as const;
}

export function attachLatestStackedMoveSelectionIdentity(action: MoveAction) {
  const expected = manualIdentity(action);
  const actionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const stackIndex = typeof action.payload?.rollStackIndex === 'number' ? action.payload.rollStackIndex : null;
  if (!expected || !actionId || !Number.isInteger(stackIndex) || Number(stackIndex) < 0) return false;
  const attachedSelection = payloadIdentity(action);
  if (attachedSelection) {
    rememberFrozenSelection(actionId, attachedSelection);
    return true;
  }
  const liveSelection = selectionMatchesAction(clientSelection, expected, Number(stackIndex))
    ? clientSelection
    : null;
  const frozenSelection = selectionMatchesAction(frozenSelectionByActionId.get(actionId), expected, Number(stackIndex))
    ? frozenSelectionByActionId.get(actionId)
    : null;
  const selection = liveSelection ?? frozenSelection;
  if (!selection) return false;
  const frozen = cloneSelectionIdentity(selection);
  action.payload = { ...action.payload, stackedMoveSelection: frozen };
  rememberFrozenSelection(actionId, frozen);
  return true;
}

export function validateStackedMoveSelectionIdentity({ state, action, stackedRollMode }: {
  state: MoveState;
  action: MoveAction;
  stackedRollMode: boolean;
}) {
  const stackIndex = typeof action.payload?.rollStackIndex === 'number' ? action.payload.rollStackIndex : null;
  const expected = manualIdentity(action);
  if (!stackedRollMode || stackIndex === null || !expected) return null;
  const selection = payloadIdentity(action);
  const stack = stackFingerprint(state.rollStack);
  const stateIdentity = [integer(state.lastSequence), integer(state.turnVersion), integer(state.turnIndex)];
  const hasAuthoritativeRevision = stateIdentity.every((value) => value !== null);
  // Reducer-only fixtures may intentionally omit Firestore revision metadata. An
  // explicit selection against such a state is still stale; only legacy fixture
  // calls with neither side of the revision contract bypass this wrapper guard.
  if (!hasAuthoritativeRevision) return selection ? STACKED_MOVE_SELECTION_STALE_REASON : null;
  const valid = selection && stack
    && selection.expectedPreviousSequence === expected.expectedPreviousSequence
    && selection.expectedTurnIndex === expected.expectedTurnIndex
    && selection.expectedPreviousSequence === stateIdentity[0]
    && selection.expectedTurnVersion === stateIdentity[1]
    && selection.expectedTurnIndex === stateIdentity[2]
    && selection.rollStackIndex === stackIndex
    && Boolean(stack[stackIndex] && rollMatches(selection.roll, stack[stackIndex]));
  return valid ? null : STACKED_MOVE_SELECTION_STALE_REASON;
}
