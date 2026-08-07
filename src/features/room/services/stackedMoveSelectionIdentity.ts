import type { YutResult } from '../../../game-core/roll';

export type StackedRollFingerprint = {
  name: string;
  steps: number;
  bonus: boolean;
};

export type StackedMoveSelectionIdentity = {
  expectedPreviousSequence: number;
  expectedTurnVersion: number;
  expectedTurnIndex: number;
  rollStackIndex: number;
  roll: StackedRollFingerprint;
};

type AuthoritativeStackedMoveContext = {
  lastSequence: number;
  turnVersion: number;
  turnIndex: number;
  rollStack: StackedRollFingerprint[];
  rollStackClosed: boolean;
};

type StackedMoveAction = {
  type: string;
  actorId: string;
  payload?: Record<string, unknown>;
};

type StackedMoveState = {
  lastSequence?: unknown;
  turnVersion?: unknown;
  turnIndex?: unknown;
  rollStack?: unknown;
  rollStackClosed?: unknown;
};

export const STACKED_MOVE_SELECTION_STALE_REASON = '선택한 누적 윷 결과가 최신 상태와 일치하지 않습니다. 최신 상태에서 다시 선택해주세요.';

let latestAuthoritativeContext: AuthoritativeStackedMoveContext | null = null;
let latestClientSelection: StackedMoveSelectionIdentity | null = null;

const toSafeInteger = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) ? numericValue : null;
};

export const makeStackedRollFingerprint = (roll: unknown): StackedRollFingerprint | null => {
  if (!roll || typeof roll !== 'object' || Array.isArray(roll)) return null;
  const source = roll as { name?: unknown; steps?: unknown; bonus?: unknown };
  const name = typeof source.name === 'string' ? source.name : '';
  const steps = Number(source.steps);
  if (!name || !Number.isFinite(steps)) return null;
  return { name, steps, bonus: source.bonus === true };
};

const makeStackFingerprint = (rollStack: unknown) => {
  if (!Array.isArray(rollStack)) return null;
  const normalized = rollStack.map(makeStackedRollFingerprint);
  return normalized.every((roll): roll is StackedRollFingerprint => Boolean(roll)) ? normalized : null;
};

const rollsMatch = (left: StackedRollFingerprint, right: StackedRollFingerprint) => (
  left.name === right.name
  && left.steps === right.steps
  && left.bonus === right.bonus
);

const stacksMatch = (left: StackedRollFingerprint[], right: StackedRollFingerprint[]) => (
  left.length === right.length && left.every((roll, index) => rollsMatch(roll, right[index]))
);

const parseManualMoveClientIdentity = (action: StackedMoveAction) => {
  const clientActionId = typeof action.payload?.clientActionId === 'string' ? action.payload.clientActionId : '';
  const prefix = `move_piece:${action.actorId}:`;
  if (action.type !== 'move_piece'
    || !action.actorId
    || !clientActionId.startsWith(prefix)
    || action.payload?.recoveredByCoordinator === true
    || action.payload?.deadlineAutoSubmitted === true
    || typeof action.payload?.automationSource === 'string'
    || typeof action.payload?.coordinatorSeatId === 'string') return null;
  const [sequenceText = '', turnIndexText = ''] = clientActionId.slice(prefix.length).split(':', 2);
  if (!/^\d+$/.test(sequenceText) || !/^\d+$/.test(turnIndexText)) return null;
  const expectedPreviousSequence = Number(sequenceText);
  const expectedTurnIndex = Number(turnIndexText);
  if (!Number.isSafeInteger(expectedPreviousSequence) || !Number.isSafeInteger(expectedTurnIndex)) return null;
  return { expectedPreviousSequence, expectedTurnIndex };
};

const readPayloadSelectionIdentity = (action: StackedMoveAction): StackedMoveSelectionIdentity | null => {
  const rawIdentity = action.payload?.stackedMoveSelection;
  if (!rawIdentity || typeof rawIdentity !== 'object' || Array.isArray(rawIdentity)) return null;
  const source = rawIdentity as Record<string, unknown>;
  const expectedPreviousSequence = toSafeInteger(source.expectedPreviousSequence);
  const expectedTurnVersion = toSafeInteger(source.expectedTurnVersion);
  const expectedTurnIndex = toSafeInteger(source.expectedTurnIndex);
  const rollStackIndex = toSafeInteger(source.rollStackIndex);
  const roll = makeStackedRollFingerprint(source.roll);
  if (expectedPreviousSequence === null
    || expectedTurnVersion === null
    || expectedTurnIndex === null
    || rollStackIndex === null
    || rollStackIndex < 0
    || !roll) return null;
  return {
    expectedPreviousSequence,
    expectedTurnVersion,
    expectedTurnIndex,
    rollStackIndex,
    roll,
  };
};

export function publishAuthoritativeStackedMoveContext(state: unknown) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const source = state as StackedMoveState;
  const lastSequence = toSafeInteger(source.lastSequence);
  const turnVersion = toSafeInteger(source.turnVersion);
  const turnIndex = toSafeInteger(source.turnIndex);
  const rollStack = makeStackFingerprint(source.rollStack);
  if (lastSequence === null || turnVersion === null || turnIndex === null || !rollStack) return false;
  latestAuthoritativeContext = {
    lastSequence,
    turnVersion,
    turnIndex,
    rollStack,
    rollStackClosed: source.rollStackClosed === true,
  };
  if (latestClientSelection
    && (latestClientSelection.expectedPreviousSequence !== lastSequence
      || latestClientSelection.expectedTurnVersion !== turnVersion
      || latestClientSelection.expectedTurnIndex !== turnIndex)) {
    latestClientSelection = null;
  }
  return true;
}

export function clearStackedMoveSelectionIdentityContext() {
  latestAuthoritativeContext = null;
  latestClientSelection = null;
}

export function captureStackedMoveSelectionIdentity({
  rollStack,
  rollStackClosed,
  rollStackIndex,
}: {
  rollStack: YutResult[];
  rollStackClosed: boolean;
  rollStackIndex: number;
}) {
  const displayedStack = makeStackFingerprint(rollStack);
  const authoritative = latestAuthoritativeContext;
  if (!displayedStack || !Number.isInteger(rollStackIndex) || rollStackIndex < 0 || rollStackIndex >= displayedStack.length) {
    latestClientSelection = null;
    return { status: 'invalid' as const, identity: null };
  }
  if (!authoritative) {
    latestClientSelection = null;
    return { status: 'untracked' as const, identity: null };
  }
  if (authoritative.rollStackClosed !== rollStackClosed || !stacksMatch(authoritative.rollStack, displayedStack)) {
    latestClientSelection = null;
    return { status: 'stale' as const, identity: null };
  }
  const selectedRoll = displayedStack[rollStackIndex];
  const identity: StackedMoveSelectionIdentity = {
    expectedPreviousSequence: authoritative.lastSequence,
    expectedTurnVersion: authoritative.turnVersion,
    expectedTurnIndex: authoritative.turnIndex,
    rollStackIndex,
    roll: selectedRoll,
  };
  latestClientSelection = identity;
  return { status: 'ready' as const, identity };
}

export function attachLatestStackedMoveSelectionIdentity(action: StackedMoveAction) {
  const manualIdentity = parseManualMoveClientIdentity(action);
  const rollStackIndex = typeof action.payload?.rollStackIndex === 'number'
    ? Number(action.payload.rollStackIndex)
    : null;
  if (!manualIdentity || !Number.isInteger(rollStackIndex) || Number(rollStackIndex) < 0) return false;
  if (readPayloadSelectionIdentity(action)) return true;
  const selection = latestClientSelection;
  if (!selection
    || selection.rollStackIndex !== rollStackIndex
    || selection.expectedPreviousSequence !== manualIdentity.expectedPreviousSequence
    || selection.expectedTurnIndex !== manualIdentity.expectedTurnIndex) return false;
  action.payload = {
    ...(action.payload ?? {}),
    stackedMoveSelection: {
      expectedPreviousSequence: selection.expectedPreviousSequence,
      expectedTurnVersion: selection.expectedTurnVersion,
      expectedTurnIndex: selection.expectedTurnIndex,
      rollStackIndex: selection.rollStackIndex,
      roll: { ...selection.roll },
    },
  };
  return true;
}

export function validateStackedMoveSelectionIdentity({
  state,
  action,
  stackedRollMode,
}: {
  state: StackedMoveState;
  action: StackedMoveAction;
  stackedRollMode: boolean;
}) {
  const rollStackIndex = typeof action.payload?.rollStackIndex === 'number'
    ? Number(action.payload.rollStackIndex)
    : null;
  const manualIdentity = parseManualMoveClientIdentity(action);
  if (!stackedRollMode || rollStackIndex === null || !manualIdentity) return null;
  const selection = readPayloadSelectionIdentity(action);
  const stateSequence = toSafeInteger(state.lastSequence);
  const stateTurnVersion = toSafeInteger(state.turnVersion);
  const stateTurnIndex = toSafeInteger(state.turnIndex);
  const rollStack = makeStackFingerprint(state.rollStack);
  if (!selection
    || stateSequence === null
    || stateTurnVersion === null
    || stateTurnIndex === null
    || !rollStack
    || selection.expectedPreviousSequence !== manualIdentity.expectedPreviousSequence
    || selection.expectedTurnIndex !== manualIdentity.expectedTurnIndex
    || selection.expectedPreviousSequence !== stateSequence
    || selection.expectedTurnVersion !== stateTurnVersion
    || selection.expectedTurnIndex !== stateTurnIndex
    || selection.rollStackIndex !== rollStackIndex
    || rollStackIndex < 0
    || rollStackIndex >= rollStack.length
    || !rollsMatch(selection.roll, rollStack[rollStackIndex])) {
    return STACKED_MOVE_SELECTION_STALE_REASON;
  }
  return null;
}
