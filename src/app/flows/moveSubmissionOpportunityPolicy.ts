import type { YutResult } from '../../game-core/roll';

export type AutoMoveOpportunity = {
  key: string;
  readyAt: number;
  submitted: boolean;
};

type ManualStackMoveSelection = {
  activeSeatId: string;
  turnDeadlineAt: number;
  rollStackIndex: number;
  rollName: YutResult['name'];
  rollSteps: number;
};

let latestManualStackMoveSelection: ManualStackMoveSelection | null = null;

export function getOrCreateAutoMoveOpportunity(
  current: AutoMoveOpportunity | null,
  key: string,
  now: number,
  canStart: boolean,
): AutoMoveOpportunity | null {
  if (!key) return null;
  if (current?.key === key) return current;
  if (!canStart) return null;
  return {
    key,
    readyAt: now,
    submitted: false,
  };
}

export function markManualStackMoveSelection({
  activeSeatId,
  turnDeadlineAt,
  rollStackIndex,
  roll,
}: {
  activeSeatId: string;
  turnDeadlineAt: number;
  rollStackIndex: number;
  roll: YutResult;
}) {
  latestManualStackMoveSelection = {
    activeSeatId,
    turnDeadlineAt,
    rollStackIndex,
    rollName: roll.name,
    rollSteps: roll.steps,
  };
}

export function isManualStackMoveSelectionCurrent({
  activeSeatId,
  turnDeadlineAt,
  rollStackIndex,
  roll,
}: {
  activeSeatId: string;
  turnDeadlineAt: number;
  rollStackIndex: number | null;
  roll: YutResult;
}) {
  const current = latestManualStackMoveSelection;
  return Boolean(
    current
    && rollStackIndex !== null
    && current.activeSeatId === activeSeatId
    && current.turnDeadlineAt === turnDeadlineAt
    && current.rollStackIndex === rollStackIndex
    && current.rollName === roll.name
    && current.rollSteps === roll.steps,
  );
}

export function resetManualStackMoveSelectionForTests() {
  latestManualStackMoveSelection = null;
}

export function shouldAttemptAutoMove({
  opportunity,
  key,
  now,
  moveRequestReady,
  moveActionReady,
  transitionActionReady,
  submissionPending,
}: {
  opportunity: AutoMoveOpportunity | null;
  key: string;
  now: number;
  moveRequestReady: boolean;
  moveActionReady: boolean;
  transitionActionReady: boolean;
  submissionPending: boolean;
}) {
  return Boolean(
    opportunity
    && opportunity.key === key
    && !opportunity.submitted
    && !submissionPending
    && moveRequestReady
    && moveActionReady
    && transitionActionReady
    && now >= opportunity.readyAt,
  );
}

export function markAutoMoveSubmitted(current: AutoMoveOpportunity | null, key: string) {
  if (current?.key === key) current.submitted = true;
}
