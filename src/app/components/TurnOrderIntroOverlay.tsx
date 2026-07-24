import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  getTurnOrderSubmission,
  submitTurnOrderSubmission,
  subscribeTurnOrderSubmissions,
  updateTurnOrderState,
  type GameStatePatch,
  type SyncedGameState,
  type TurnOrderSubmissionRecord,
} from '../../features/room/services/roomService';
import { TURN_ACTION_TIMEOUT_MS } from '../../features/room/services/roomTiming';
import { getDeadlineTimerAnimationState } from '../../features/room/services/turnDeadlinePolicy';
import {
  chooseAiRollTimingZone,
  getRollTimingZone,
  makeDisplaySticks,
  rollYutResultWithTiming,
  shouldFallForTimingZone,
  type RollTimingZone,
  type YutResult,
} from '../../game-core/roll';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import type { RollAnimation, TurnOrderIntro, TurnOrderResultName, TurnOrderSubmission } from '../appState';
import {
  activateNextTurnOrderRound,
  formatTurnOrderSummary,
  getTurnOrderScore,
  isTurnOrderFinalized,
  makeTurnOrderSubmissionId,
  submitAndMaybeAggregateTurnOrderRound,
} from '../flows/turnOrderFlow';
import {
  shouldReleaseTurnOrderSubmissionLockAfterFailure,
  shouldResetTurnOrderSubmissionLockForRound,
} from '../flows/turnOrderSubmissionPolicy';
import { RollStage } from '../containers/RollStage';
import { RollTimingControl } from './RollTimingControl';

type TurnOrderIntroOverlayProps = {
  activeTurnOrderIntro: TurnOrderIntro | null;
  localSeatId: string;
  onlineGameCoordinatorSeatId: string;
  turnOrderClock: number;
  finalHoldMs: number;
};

type QaTurnOrderWindow = Window & {
  __YUT_QA_TURN_ORDER_RESULT_QUEUE__?: TurnOrderResultName[];
  __YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__?: TurnOrderResultName[];
};

type QaResultQueue = 'local' | 'ai' | 'none';

const AUTO_ROLL_FALLBACK_DELAY_MS = 500;
const SUBMISSION_MAX_ATTEMPTS = 2;
const SUBMISSION_RETRY_DELAY_MS = 250;
const SCORE_LABELS: Record<TurnOrderResultName, string> = {
  모: '5',
  윷: '4',
  걸: '3',
  개: '2',
  도: '1',
  빽도: '-1',
  낙: '-2',
};

const getForcedResult = (name: TurnOrderResultName): { result: YutResult; fallCount: number } => {
  if (name === '낙') return { result: { name: '도', steps: 1 }, fallCount: 2 };
  if (name === '빽도') return { result: { name: '빽도', steps: -1 }, fallCount: 0 };
  const steps = { 도: 1, 개: 2, 걸: 3, 윷: 4, 모: 5 }[name];
  return { result: { name, steps, ...(name === '윷' || name === '모' ? { bonus: true } : {}) }, fallCount: 0 };
};

const takeQaResult = (queueType: Exclude<QaResultQueue, 'none'>) => {
  if (typeof window === 'undefined') return null;
  const qaWindow = window as QaTurnOrderWindow;
  const queue = queueType === 'ai'
    ? qaWindow.__YUT_QA_AI_TURN_ORDER_RESULT_QUEUE__
    : qaWindow.__YUT_QA_TURN_ORDER_RESULT_QUEUE__;
  return Array.isArray(queue) && queue.length ? queue.shift() ?? null : null;
};

const createTurnOrderSubmission = (params: {
  seatId: string;
  roundId: string;
  timingZone: RollTimingZone;
  source: TurnOrderSubmission['source'];
  now?: number;
  qaResultQueue?: QaResultQueue;
}): TurnOrderSubmission => {
  const forcedName = params.qaResultQueue === 'none' ? null : takeQaResult(params.qaResultQueue ?? 'local');
  const rolled = forcedName ? getForcedResult(forcedName) : { ...rollYutResultWithTiming(params.timingZone), fallCount: 0 };
  const fallCount = forcedName
    ? rolled.fallCount
    : shouldFallForTimingZone(params.timingZone)
      ? Math.floor(Math.random() * 4) + 1
      : 0;
  const resultName = (fallCount > 0 ? '낙' : rolled.result.name) as TurnOrderResultName;
  return {
    submissionId: makeTurnOrderSubmissionId(params.roundId, params.seatId),
    seatId: params.seatId,
    roundId: params.roundId,
    resultName,
    displayResult: rolled.result,
    sticks: makeDisplaySticks(rolled.result),
    fallCount,
    timingZone: params.timingZone,
    source: params.source,
    submittedAt: params.now ?? Date.now(),
  };
};

const getRemainingSeconds = (targetAt: number, now: number) => Math.max(0, Math.ceil((targetAt - now) / 1000));

const toTurnOrderSubmission = (submission: TurnOrderSubmissionRecord): TurnOrderSubmission => ({
  submissionId: submission.submissionId,
  seatId: submission.seatId,
  roundId: submission.roundId,
  resultName: submission.resultName as TurnOrderResultName,
  displayResult: submission.displayResult as YutResult,
  sticks: submission.sticks as TurnOrderSubmission['sticks'],
  fallCount: submission.fallCount,
  timingZone: submission.timingZone as RollTimingZone,
  source: submission.source,
  submittedAt: submission.submittedAt,
});

const makeTurnOrderStatePatch = (state: SyncedGameState, next: TurnOrderIntro): GameStatePatch => {
  if (!isTurnOrderFinalized(next)) return { turnOrderIntro: next };
  const entryById = new Map(next.order.map((entry) => [entry.seatId, entry]));
  const orderedEntries = (next.finalTurnOrderIds ?? [])
    .map((seatId) => entryById.get(seatId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const currentLogs = Array.isArray(state.logs) ? state.logs as Array<{ id?: number; text?: string }> : [];
  const maxLogId = currentLogs.reduce((max, log) => Math.max(max, Number(log.id ?? 0)), 0);
  const summary = formatTurnOrderSummary(
    orderedEntries.map((entry) => ({ id: entry.seatId, label: entry.label, name: entry.name, color: entry.color, team: entry.team, isAI: entry.isAI })),
    (entry) => entry.name || entry.label,
  );
  const logs = [{ id: maxLogId + 1, text: summary }, ...currentLogs.filter((log) => typeof log.text !== 'string' || !log.text.startsWith('순서:'))];
  return {
    turnOrderIntro: next,
    turnOrderIds: next.finalTurnOrderIds,
    initialTurnOrderIds: next.finalTurnOrderIds,
    gameStartedAt: next.gameStartAt,
    turnDeadlineAt: Number(next.gameStartAt ?? 0) + TURN_ACTION_TIMEOUT_MS,
    turnDeadlineKind: 'roll',
    waitingForPlayersReady: false,
    logs,
  };
};

export function TurnOrderIntroOverlay({ activeTurnOrderIntro, localSeatId, onlineGameCoordinatorSeatId, turnOrderClock }: TurnOrderIntroOverlayProps) {
  const [clock, setClock] = useState(() => Date.now());
  const [localSubmission, setLocalSubmission] = useState<TurnOrderSubmission | null>(null);
  const [localSubmissionStatus, setLocalSubmissionStatus] = useState<'idle' | 'pending' | 'confirmed' | 'failed'>('idle');
  const [localRollAnimation, setLocalRollAnimation] = useState<RollAnimation | null>(null);
  const [storedSubmissionSeatIds, setStoredSubmissionSeatIds] = useState<string[]>([]);
  const submittedRoundIdRef = useRef('');
  const aiSubmittingRoundIdRef = useRef('');
  const fallbackRoundIdRef = useRef('');
  const aggregatingRoundIdRef = useRef('');
  const completionSoundSessionRef = useRef('');

  useEffect(() => {
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 50);
    const syncClock = () => setClock(Date.now());
    document.addEventListener('visibilitychange', syncClock);
    window.addEventListener('focus', syncClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', syncClock);
      window.removeEventListener('focus', syncClock);
    };
  }, []);

  const sourceIntro = activeTurnOrderIntro?.version === 3 ? activeTurnOrderIntro : null;
  const now = Math.max(clock, turnOrderClock);
  const intro = useMemo(() => sourceIntro ? activateNextTurnOrderRound(sourceIntro, now) : null, [now, sourceIntro]);
  const round = intro?.currentRound;
  const roundId = round?.id ?? '';
  const roundTimerStarted = Boolean(round && now >= round.startAt);
  const roundTimerAnimation = useMemo(() => {
    const durationMs = round ? Math.max(0, round.deadlineAt - round.startAt) : 0;
    return getDeadlineTimerAnimationState({ deadlineAt: round?.deadlineAt ?? 0, durationMs, now });
  }, [round?.deadlineAt, round?.startAt, roundTimerStarted]);
  const isLocalEligible = Boolean(round?.eligibleSeatIds.includes(localSeatId));
  const storedLocalSubmission = round?.submissions.find((submission) => submission.seatId === localSeatId) ?? null;
  const visibleLocalSubmission = localSubmissionStatus !== 'failed' && localSubmission?.roundId === roundId ? localSubmission : storedLocalSubmission;
  const isCoordinator = Boolean(localSeatId && localSeatId === onlineGameCoordinatorSeatId);
  const isPreparing = Boolean(round && now < round.startAt);
  const isCollecting = Boolean(round && round.status === 'collecting' && now >= round.startAt && now < round.deadlineAt);
  const revealAt = Number(round?.revealAt ?? 0);
  const revealReady = Boolean(revealAt && now >= revealAt);
  const finalOrderVisible = Boolean(intro?.finalOrderAt && intro?.gameStartAt && now >= intro.finalOrderAt && now < intro.gameStartAt);

  useEffect(() => {
    if (storedLocalSubmission) {
      setLocalSubmission(storedLocalSubmission);
      setLocalSubmissionStatus('confirmed');
      submittedRoundIdRef.current = roundId;
      return;
    }
    if (localSubmission?.roundId === roundId) return;
    setLocalSubmission(storedLocalSubmission);
    setLocalSubmissionStatus('idle');
    setLocalRollAnimation(null);
    if (shouldResetTurnOrderSubmissionLockForRound(submittedRoundIdRef.current, roundId)) submittedRoundIdRef.current = '';
  }, [localSubmission?.roundId, roundId, storedLocalSubmission]);

  useEffect(() => {
    if (!intro || !round || !isLocalEligible || storedLocalSubmission || localSubmission?.roundId === round.id) return;
    let disposed = false;
    void getTurnOrderSubmission(intro.roomId, intro.sessionId, round.id, localSeatId)
      .then((stored) => {
        if (disposed || !stored) return;
        const submission = toTurnOrderSubmission(stored);
        setLocalSubmission(submission);
        setLocalSubmissionStatus('confirmed');
        submittedRoundIdRef.current = round.id;
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [intro, isLocalEligible, localSeatId, localSubmission?.roundId, round, storedLocalSubmission]);

  useEffect(() => {
    setStoredSubmissionSeatIds([]);
  }, [roundId]);

  useEffect(() => {
    if (!round || round.status !== 'collecting') {
      aiSubmittingRoundIdRef.current = '';
      fallbackRoundIdRef.current = '';
      aggregatingRoundIdRef.current = '';
      return;
    }
    if (aiSubmittingRoundIdRef.current && aiSubmittingRoundIdRef.current !== round.id) aiSubmittingRoundIdRef.current = '';
    if (fallbackRoundIdRef.current && fallbackRoundIdRef.current !== round.id) fallbackRoundIdRef.current = '';
    if (aggregatingRoundIdRef.current && aggregatingRoundIdRef.current !== round.id) aggregatingRoundIdRef.current = '';
  }, [round, roundId]);

  useEffect(() => {
    if (!sourceIntro?.nextRound || now < sourceIntro.nextRound.startAt || sourceIntro.currentRound.id === sourceIntro.nextRound.id) return;
    void updateTurnOrderState(sourceIntro.roomId, (state) => {
      const current = state?.turnOrderIntro as TurnOrderIntro | null | undefined;
      if (!current || current.version !== 3 || current.sessionId !== sourceIntro.sessionId) return null;
      const next = activateNextTurnOrderRound(current, Date.now());
      return next.currentRound.id === current.currentRound.id ? null : { turnOrderIntro: next };
    });
  }, [now, sourceIntro]);

  const commitSubmission = useCallback((source: TurnOrderSubmission['source'], zone: RollTimingZone) => {
    if (!intro || !round || !isLocalEligible || round.status !== 'collecting') return;
    if (source === 'manual' && Date.now() >= round.deadlineAt) return;
    if (source === 'auto' && Date.now() < round.deadlineAt) return;
    if (submittedRoundIdRef.current === round.id || visibleLocalSubmission) return;
    submittedRoundIdRef.current = round.id;
    const submission = createTurnOrderSubmission({ seatId: localSeatId, roundId: round.id, timingZone: zone, source });
    setLocalSubmission(submission);
    setLocalSubmissionStatus('pending');
    setLocalRollAnimation({
      id: submission.submittedAt,
      phase: 'resolved',
      result: submission.displayResult,
      sticks: submission.sticks,
      turnOrder: true,
      fallCount: submission.fallCount,
      timingZone: submission.timingZone,
    });
    playStoredSoundEffect('roll');
    void (async () => {
      for (let attempt = 1; attempt <= SUBMISSION_MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await submitTurnOrderSubmission(intro.roomId, {
            ...submission,
            submissionId: submission.submissionId ?? makeTurnOrderSubmissionId(submission.roundId, submission.seatId),
            sessionId: intro.sessionId,
            coordinatorSeatId: onlineGameCoordinatorSeatId,
          });
          if (result.status !== 'committed' && result.status !== 'duplicate') throw new Error('순서 정하기 제출이 authoritative 상태에 반영되지 않았습니다.');
          if (submittedRoundIdRef.current === submission.roundId) setLocalSubmissionStatus('confirmed');
          return;
        } catch {
          if (attempt < SUBMISSION_MAX_ATTEMPTS) {
            await new Promise((resolve) => window.setTimeout(resolve, SUBMISSION_RETRY_DELAY_MS));
          }
        }
      }
      if (submittedRoundIdRef.current !== submission.roundId) return;
      if (shouldReleaseTurnOrderSubmissionLockAfterFailure(source)) submittedRoundIdRef.current = '';
      setLocalSubmissionStatus('failed');
      setLocalSubmission(null);
      setLocalRollAnimation(null);
    })();
  }, [intro, isLocalEligible, localSeatId, onlineGameCoordinatorSeatId, round, visibleLocalSubmission]);

  const handleManualRoll = useCallback((timingPositionPercent?: number) => {
    commitSubmission('manual', getRollTimingZone(timingPositionPercent ?? 50));
  }, [commitSubmission]);

  useEffect(() => {
    if (!round || round.status !== 'collecting' || !isLocalEligible || visibleLocalSubmission || submittedRoundIdRef.current === round.id) return;
    if (now < round.deadlineAt) return;
    commitSubmission('auto', chooseAiRollTimingZone());
  }, [commitSubmission, isLocalEligible, now, round, visibleLocalSubmission]);

  useEffect(() => {
    if (!intro || !round || !isCoordinator || round.status !== 'collecting' || now < round.startAt) return;
    const aiSeatIds = new Set(intro.order.filter((entry) => entry.isAI).map((entry) => entry.seatId));
    const pendingAiSeatIds = round.eligibleSeatIds.filter((seatId) => aiSeatIds.has(seatId)
      && !round.submissions.some((submission) => submission.seatId === seatId));
    if (!pendingAiSeatIds.length || aiSubmittingRoundIdRef.current === round.id) return;
    const submissionNow = Math.max(Date.now(), now);
    const aiSubmissions = pendingAiSeatIds.map((seatId) => createTurnOrderSubmission({
      seatId,
      roundId: round.id,
      timingZone: chooseAiRollTimingZone(),
      source: 'auto',
      now: submissionNow,
      qaResultQueue: 'ai',
    }));
    aiSubmittingRoundIdRef.current = round.id;
    void Promise.all(aiSubmissions.map((submission) => submitTurnOrderSubmission(intro.roomId, {
      ...submission,
      submissionId: submission.submissionId ?? makeTurnOrderSubmissionId(submission.roundId, submission.seatId),
      sessionId: intro.sessionId,
      coordinatorSeatId: onlineGameCoordinatorSeatId,
    }))).catch(() => {
      if (aiSubmittingRoundIdRef.current === round.id) aiSubmittingRoundIdRef.current = '';
    });
  }, [intro, isCoordinator, now, onlineGameCoordinatorSeatId, round]);

  useEffect(() => {
    if (!intro || !round || !isCoordinator || round.status !== 'collecting' || now < round.deadlineAt + AUTO_ROLL_FALLBACK_DELAY_MS) return;
    const allSubmitted = round.eligibleSeatIds.every((seatId) => round.submissions.some((submission) => submission.seatId === seatId));
    if (allSubmitted || fallbackRoundIdRef.current === round.id) return;
    const submissionNow = Math.max(Date.now(), round.deadlineAt);
    const fallbackSubmissions = round.eligibleSeatIds
      .filter((seatId) => !round.submissions.some((submission) => submission.seatId === seatId))
      .map((seatId) => createTurnOrderSubmission({
        seatId,
        roundId: round.id,
        timingZone: chooseAiRollTimingZone(),
        source: 'auto',
        now: submissionNow,
        qaResultQueue: 'none',
      }));
    fallbackRoundIdRef.current = round.id;
    void Promise.all(fallbackSubmissions.map((submission) => submitTurnOrderSubmission(intro.roomId, {
      ...submission,
      submissionId: submission.submissionId ?? makeTurnOrderSubmissionId(submission.roundId, submission.seatId),
      sessionId: intro.sessionId,
      coordinatorSeatId: onlineGameCoordinatorSeatId,
    }))).catch(() => {
      if (fallbackRoundIdRef.current === round.id) fallbackRoundIdRef.current = '';
    });
  }, [intro, isCoordinator, now, onlineGameCoordinatorSeatId, round]);

  useEffect(() => {
    if (!intro || !round || !isCoordinator || round.status !== 'collecting') return undefined;
    const eligibleSeatIds = new Set(round.eligibleSeatIds);
    return subscribeTurnOrderSubmissions(intro.roomId, intro.sessionId, round.id, (storedSubmissions) => {
      const submissions = storedSubmissions
        .filter((submission) => eligibleSeatIds.has(submission.seatId))
        .map(toTurnOrderSubmission);
      setStoredSubmissionSeatIds(submissions.map((submission) => submission.seatId));
      if (aggregatingRoundIdRef.current === round.id) return;
      if (!round.eligibleSeatIds.every((seatId) => submissions.some((submission) => submission.seatId === seatId))) return;
      aggregatingRoundIdRef.current = round.id;
      void updateTurnOrderState(intro.roomId, (state) => {
        const current = state?.turnOrderIntro as TurnOrderIntro | null | undefined;
        const transactionNow = Date.now();
        if (!state || !current || current.version !== 3 || current.sessionId !== intro.sessionId || current.currentRound.id !== round.id || current.currentRound.status !== 'collecting') return null;
        const next = submitAndMaybeAggregateTurnOrderRound(current, submissions, transactionNow);
        return next === current ? null : makeTurnOrderStatePatch(state, next);
      }).catch(() => {
        if (aggregatingRoundIdRef.current === round.id) aggregatingRoundIdRef.current = '';
      });
    }, () => {
      if (aggregatingRoundIdRef.current === round.id) aggregatingRoundIdRef.current = '';
    });
  }, [intro, isCoordinator, round]);

  useEffect(() => {
    if (!intro || !isTurnOrderFinalized(intro) || !intro.finalOrderAt || now < intro.finalOrderAt) return;
    if (completionSoundSessionRef.current === intro.sessionId) return;
    completionSoundSessionRef.current = intro.sessionId;
    playStoredSoundEffect('countdownStart');
  }, [intro, now]);

  if (!intro?.visible || !round) return null;

  const orderedFinalEntries = (intro.finalTurnOrderIds ?? [])
    .map((seatId) => intro.order.find((entry) => entry.seatId === seatId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const submittedSeatIds = new Set([
    ...round.submissions.map((submission) => submission.seatId),
    ...storedSubmissionSeatIds,
  ]);
  const remainingSeconds = isPreparing ? getRemainingSeconds(round.startAt, now) : getRemainingSeconds(round.deadlineAt, now);
  const revealSeconds = revealAt ? getRemainingSeconds(revealAt, now) : 0;
  const nextTieSeatIds = new Set(intro.nextRound?.eligibleSeatIds ?? []);
  const roundTimerKey = `${round.id}:${round.startAt}:${round.deadlineAt}`;
  const roundTimerStyle = { '--timer-duration': `${roundTimerAnimation.durationMs}ms` } as CSSProperties;
  const roundTimerFillStyle = { animationDelay: `${roundTimerAnimation.delayMs}ms` } as CSSProperties;
  const heading = finalOrderVisible
    ? '최종 순서 확정'
    : isPreparing
      ? '잠시 후 순서 정하기가 시작됩니다'
      : isCollecting
        ? `${round.index}라운드 · 동시에 던지세요`
        : round.status === 'collecting'
          ? '자동 던지기 결과를 모으는 중입니다'
          : revealReady
            ? '전체 결과 공개'
            : '전체 결과를 모으는 중입니다';

  return <>
    <div className="turn-order-ready-overlay" data-testid="turn-order-overlay" role="status" aria-live="polite">
      <div className="turn-order-presentation-heading">
        <span>순서 정하기</span>
        <strong>{heading}</strong>
      </div>

      {finalOrderVisible ? <div className="turn-order-final-list" data-testid="turn-order-final-order">
        {orderedFinalEntries.map((entry, index) => <div className={`turn-order-final-entry ${entry.seatId === localSeatId ? 'mine' : ''}`} key={entry.seatId} style={{ '--player-color': entry.color } as CSSProperties}>
          <strong>{index + 1}</strong><span>{entry.name}</span>{entry.seatId === localSeatId && <em>나</em>}
        </div>)}
        <p>게임 시작까지 {getRemainingSeconds(Number(intro.gameStartAt ?? 0), now)}초</p>
      </div> : isPreparing ? <div className="turn-order-waiting-panel" data-testid="turn-order-preparing">
        <span className="turn-order-waiting-yut" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <strong>{remainingSeconds}초 후 시작</strong>
        <span>모든 참가자가 같은 시각에 윷을 던집니다.</span>
      </div> : <>
        <div className="turn-order-round-status">
          {round.status === 'collecting'
            ? <div key={roundTimerKey} className="time-limit-bar turn-action-timer turn-order-round-timer" data-testid="turn-order-round-timer" style={roundTimerStyle} role="img" aria-label={`남은 시간 ${remainingSeconds}초`}><span style={roundTimerFillStyle}></span></div>
            : <span>{revealReady ? '결과가 공개되었습니다' : `전체 공개까지 ${revealSeconds}초`}</span>}
          <small>{round.eligibleSeatIds.length === intro.order.length ? '전체 참가자 라운드' : '동률 참가자 재대결'}</small>
        </div>

        {round.status === 'collecting' && isLocalEligible && visibleLocalSubmission && <p className="turn-order-own-result" data-testid="turn-order-own-result">
          내 결과 <strong>{visibleLocalSubmission.resultName}</strong> <span>{SCORE_LABELS[visibleLocalSubmission.resultName]}점</span>
        </p>}

        {!isLocalEligible && round.status === 'collecting' && <div className="turn-order-spectating" data-testid="turn-order-spectating">
          <span className="turn-order-waiting-yut" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <strong>동률 재대결이 진행 중입니다</strong>
        </div>}

        <div className="turn-order-result-grid" data-testid="turn-order-result-grid">
          {intro.order.map((entry) => {
            const submission = round.submissions.find((item) => item.seatId === entry.seatId) ?? (localSubmission?.seatId === entry.seatId && localSubmission.roundId === round.id ? localSubmission : null);
            const canReveal = Boolean(submission && (entry.seatId === localSeatId || revealReady));
            const isRoundParticipant = round.eligibleSeatIds.includes(entry.seatId);
            const placement = intro.placements[entry.seatId];
            return <div className={`turn-order-result-card ${entry.seatId === localSeatId ? 'mine' : ''} ${nextTieSeatIds.has(entry.seatId) && revealReady ? 'tie' : ''}`} key={entry.seatId} style={{ '--player-color': entry.color } as CSSProperties}>
              <span>{entry.name}</span>
              {!isRoundParticipant ? placement ? <><strong>{placement}번째</strong><small>순서 확정</small></> : <strong>순위 확정</strong> : canReveal && submission ? <><strong>{submission.resultName}</strong><small>{getTurnOrderScore(submission)}점 · {submission.source === 'auto' ? '자동 던지기' : '직접 던지기'}</small></> : submittedSeatIds.has(entry.seatId) || (entry.seatId === localSeatId && localSubmission) ? <strong>결과 대기</strong> : <strong>던지는 중</strong>}
            </div>;
          })}
        </div>

        {isCollecting && isLocalEligible && !visibleLocalSubmission && <div className="turn-order-timing-panel" data-testid="turn-order-timing-panel">
          <RollTimingControl resetKey={round.id} buttonTestId="turn-order-roll-button" buttonText="윷 던지기" onRoll={handleManualRoll} />
        </div>}

        {round.status === 'reveal-pending' && revealReady && intro.nextRound && <p className="turn-order-tie-notice" data-testid="turn-order-tie-notice">같은 결과가 나온 참가자끼리 다시 던집니다.</p>}
        {round.status === 'reveal-pending' && !revealReady && <div className="turn-order-reveal-wait" aria-hidden="true"><i></i><i></i><i></i><i></i></div>}
      </>}
    </div>
    <div className="turn-order-roll-stage-anchor" data-testid="turn-order-roll-stage-anchor">
      <RollStage rollAnimation={localRollAnimation} presentationActorId={localSeatId} />
    </div>
  </>;
}
