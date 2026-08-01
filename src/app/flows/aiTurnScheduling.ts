import {
  TURN_ACTION_TIMEOUT_MS,
  TURN_ITEM_PROMPT_TIMEOUT_MS,
  getTurnActionTimeoutMsForCount,
} from '../../features/room/services/roomTiming';
import {
  getTurnActionReadyAt,
  normalizeTurnDeadlineAt,
  normalizeTurnDeadlineKind,
  type TurnDeadlineKind,
} from '../../features/room/services/turnDeadlinePolicy';
import {
  getMoveExecutionReadinessFromDiagnosticState,
  publishMoveExecutionReadiness,
} from './moveExecutionPolicy';

export const AI_TURN_READY_BOUNDARY_BUFFER_MS = 80;

const TURN_ACTION_TIMEOUT_COUNTS = [0, 1, 2] as const;

const normalizePositiveMs = (value: unknown) => {
  const milliseconds = Number(value ?? 0);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
};

const getPhaseBaseTimeoutMs = (deadlineKind: TurnDeadlineKind) => (
  deadlineKind === 'item_prompt' || deadlineKind === 'trap_placement'
    ? TURN_ITEM_PROMPT_TIMEOUT_MS
    : deadlineKind === 'roll' || deadlineKind === 'move'
      ? TURN_ACTION_TIMEOUT_MS
      : 0
);

export const getAiTurnTimeoutCandidates = (deadlineKind: unknown, hintedDurationMs?: unknown) => {
  const normalizedKind = normalizeTurnDeadlineKind(deadlineKind);
  const baseTimeoutMs = getPhaseBaseTimeoutMs(normalizedKind);
  if (!baseTimeoutMs) return [];

  const hintedDuration = normalizePositiveMs(hintedDurationMs);
  return Array.from(new Set([
    ...(hintedDuration ? [hintedDuration] : []),
    ...TURN_ACTION_TIMEOUT_COUNTS.map((count) => getTurnActionTimeoutMsForCount(count, baseTimeoutMs)),
  ]));
};

export const resolveAiTurnActionReadyAt = ({
  deadlineAt,
  deadlineKind,
  hintedDurationMs,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  hintedDurationMs?: unknown;
  now?: number;
}) => {
  const normalizedDeadlineAt = normalizeTurnDeadlineAt(deadlineAt);
  if (!normalizedDeadlineAt) return 0;

  const candidates = getAiTurnTimeoutCandidates(deadlineKind, hintedDurationMs)
    .map((durationMs) => ({
      durationMs,
      readyAt: getTurnActionReadyAt({ deadlineAt: normalizedDeadlineAt, durationMs }),
    }))
    .filter((candidate) => candidate.readyAt > 0)
    .sort((left, right) => {
      const distanceDifference = Math.abs(left.readyAt - now) - Math.abs(right.readyAt - now);
      if (distanceDifference !== 0) return distanceDifference;
      return right.durationMs - left.durationMs;
    });

  return candidates[0]?.readyAt ?? 0;
};

export const getAiTurnScheduleDelayMs = ({
  deadlineAt,
  deadlineKind,
  hintedDurationMs,
  fallbackDelayMs,
  boundaryBufferMs = AI_TURN_READY_BOUNDARY_BUFFER_MS,
  now = Date.now(),
}: {
  deadlineAt: unknown;
  deadlineKind: unknown;
  hintedDurationMs?: unknown;
  fallbackDelayMs: unknown;
  boundaryBufferMs?: unknown;
  now?: number;
}) => {
  const fallbackDelay = normalizePositiveMs(fallbackDelayMs);
  const readyAt = resolveAiTurnActionReadyAt({ deadlineAt, deadlineKind, hintedDurationMs, now });
  if (!readyAt || readyAt <= now) return fallbackDelay;

  const boundaryBuffer = normalizePositiveMs(boundaryBufferMs);
  return Math.max(fallbackDelay, Math.ceil(readyAt - now + boundaryBuffer));
};

export const getAiTurnScheduleDelayFromDiagnosticState = (
  diagnosticState: Record<string, unknown>,
  fallbackDelayMs: unknown,
  now = Date.now(),
) => {
  // useGameSyncDebugState가 매 렌더 호출하는 공통 경계에서 버튼과 동일한 최신 이동 readiness를 게시한다.
  publishMoveExecutionReadiness(getMoveExecutionReadinessFromDiagnosticState(diagnosticState));

  const activeSeat = diagnosticState.activeSeat;
  const activeSeatIsAi = Boolean(
    activeSeat
    && typeof activeSeat === 'object'
    && !Array.isArray(activeSeat)
    && (activeSeat as { isAI?: unknown }).isAI === true,
  );
  if (diagnosticState.screen !== 'game' || !activeSeatIsAi) return normalizePositiveMs(fallbackDelayMs);

  const deadlineKind = normalizeTurnDeadlineKind(diagnosticState.turnDeadlineKind);
  const hintedDurationMs = deadlineKind === 'item_prompt' || deadlineKind === 'trap_placement'
    ? diagnosticState.currentItemPromptTimeoutMs
    : diagnosticState.currentTurnActionTimeoutMs;

  return getAiTurnScheduleDelayMs({
    deadlineAt: diagnosticState.turnDeadlineAt,
    deadlineKind,
    hintedDurationMs,
    fallbackDelayMs,
    now,
  });
};
