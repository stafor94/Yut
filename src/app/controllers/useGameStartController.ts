/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect } from 'react';
import type { BoardPiece } from '../../features/game/components/GameBoard';
import type { RoomSummary } from '../../features/room/services/roomService';
import { applySequenceEvents } from '../hooks/applySequenceEvent';
import { useTurnOrderClock, useTurnOrderPortraitScroll } from '../hooks/useTurnOrderTimers';
import type { SequenceStateSnapshot } from '../appState';
import { START_REQUEST_TIMEOUT_MS, TURN_ORDER_PRESENCE_FALLBACK_MS } from '../config/gameTimings';

export function useGameStartController(ctx: any) {
  const { refs, setters, helpers, services } = ctx;
  const {
    pendingStartRequestIdRef, appliedGameStartKeyRef, startRequestInFlightRef, startRequestVersionRef, startRequestIdRef, startStatusRef,
    startedGameRequestVersionsRef, savingStateFingerprintRef, enteredGamePresenceKeyRef, logIdRef, lastAppliedSequenceRef, lastAppliedStateVersionRef,
    pendingSequenceMetaRef, resolvedItemPromptKeysRef, completingTurnOrderIntroRef,
  } = refs;
  const {
    setIsRoomHost, setInitialGameEntryPending, setStartRequestPending, setMessage, setStartRequestVersion, setStartRequestId,
    setStartCountdownStartsAt, setStartCountdownEndsAt, setStartStatus, setCountdown, setScreen, setInitialGameStateSaveDiagnostic,
    setCoordinatorStateSaveKey, setLogs, setTurnOrderIds, setInitialTurnOrderIds, setTurnOrderIntro, setWaitingForPlayersReady,
    setAuthoritativeWinner, setGameStartedAt, setPieces, setBoardItems, setOwnedItems, setTrapNodes, setShieldedPieceIds,
    setLastMovedPieceIds, setLastMovedSeatId, setRevealedItems, setSelectedPieceId, setMovingPieceId, setTurnIndex, setRollStack,
    setSelectedRollStackIndex, setRollStackClosed, setForcedRoll, setGoldenYutPickerOpen, setItemPromptTiming, setBranchChoice,
    setCaptureEffect, setTrapEffect, setPendingTrapPlacement, setPendingAfterMoveTurnIndex, setCompletedSeatIds, setRankingSeatIds,
    setGameEndMode, setLastFinishedSeatId, setContinuationRound, setTurnOrderPhase, setRollAnimation, setTurnOrderClock,
  } = setters;
  const {
    measureFirebaseLatency, delay, getQaRequestRoomGameStartDelayMs, getQaInitializeGameStateDelayMs, getStartGameBlockMessage,
    makePieces, gameSeatSnapshotsFromSeats, spawnInitialBoardItems, createTurnOrderIntro,
    getSeatPieceColor, makeLog, makeGameStateFingerprint, applySyncedStateSnapshot, replayMissingSequencesThenApply, clearRoll,
  } = helpers;
  const {
    requestRoomGameStart, cancelRoomGameStart, initializeGameState, getLatestGameState, getGameSequencesSince, updateRoomPlayer,
    resolveTurnOrderIntro, completeTurnOrderIntro,
  } = services;

  const applyAuthoritativeStartRequest = (startState: Pick<RoomSummary, 'startRequestVersion' | 'startRequestedAt' | 'startCountdownStartsAt' | 'startCountdownEndsAt' | 'startRequestId' | 'startStatus'>, requestId = pendingStartRequestIdRef.current) => {
    if (!requestId || pendingStartRequestIdRef.current !== requestId) return false;
    const authoritativeRequestId = startState.startRequestId ?? '';
    if (authoritativeRequestId !== requestId) return false;
    const authoritativeVersion = Number(startState.startRequestVersion ?? 0);
    if (!authoritativeVersion) return false;
    const authoritativeStatus: NonNullable<RoomSummary['startStatus']> = startState.startStatus ?? 'idle';
    pendingStartRequestIdRef.current = '';
    startRequestInFlightRef.current = false;
    setStartRequestPending(false);
    startRequestVersionRef.current = authoritativeVersion;
    startRequestIdRef.current = authoritativeRequestId;
    startStatusRef.current = authoritativeStatus;
    setStartRequestVersion(authoritativeVersion);
    setStartRequestId(authoritativeRequestId);
    setStartCountdownStartsAt(Number(startState.startCountdownStartsAt ?? 0));
    setStartCountdownEndsAt(Number(startState.startCountdownEndsAt ?? 0));
    setStartStatus(authoritativeStatus);
    setCountdown(-1);
    return true;
  };

  async function handleStartGame() {
    if (startRequestInFlightRef.current || ctx.startFlowBusy) return;
    if (ctx.pendingAiSeatCount > 0) { setMessage('AI 추가를 완료하는 중입니다.'); return; }
    const blockMessage = getStartGameBlockMessage({ activeRoomId: ctx.activeRoomId, allReady: ctx.allReady, canManageRoom: ctx.canManageRoom, playMode: ctx.playMode, teamBalanced: ctx.teamBalanced });
    if (ctx.roomInGame) { setMessage('이미 진행 중인 게임이 있어 다시 시작할 수 없습니다.'); return; }
    if (blockMessage) { setMessage(blockMessage); return; }
    if (!ctx.isRoomManager) setIsRoomHost(true);
    const requestId = pendingStartRequestIdRef.current || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}:${Math.random().toString(36).slice(2)}`);
    pendingStartRequestIdRef.current = requestId;
    appliedGameStartKeyRef.current = '';
    setInitialGameEntryPending(false);
    startRequestInFlightRef.current = true;
    setStartRequestPending(true);
    setMessage('');
    const requestedAt = Date.now();
    const requestPromise = measureFirebaseLatency(async () => {
      const requestDelayMs = getQaRequestRoomGameStartDelayMs();
      if (requestDelayMs > 0) await delay(requestDelayMs);
      return requestRoomGameStart(ctx.activeRoomId, requestedAt, requestId);
    });
    requestPromise.then((startState: any) => applyAuthoritativeStartRequest(startState, requestId)).catch((error: unknown) => {
      if (pendingStartRequestIdRef.current !== requestId) return;
      pendingStartRequestIdRef.current = '';
      startRequestInFlightRef.current = false;
      setStartRequestPending(false);
      setMessage(error instanceof Error ? error.message : '게임 시작 요청에 실패했습니다.');
    }).finally(() => {
      if (pendingStartRequestIdRef.current !== requestId) return;
      startRequestInFlightRef.current = false;
      setStartRequestPending(false);
    });
    await Promise.race([
      requestPromise.then(() => 'completed' as const).catch(() => 'completed' as const),
      delay(START_REQUEST_TIMEOUT_MS).then(() => 'timeout' as const),
    ]).then((result) => {
      if (result !== 'timeout' || pendingStartRequestIdRef.current !== requestId) return;
      startRequestInFlightRef.current = false;
      setStartRequestPending(false);
    });
  }

  function cancelStartCountdown() {
    if (ctx.startCancelDisabled) return;
    const cancelVersion = ctx.startRequestVersion;
    pendingStartRequestIdRef.current = '';
    startRequestInFlightRef.current = false;
    setStartRequestPending(false);
    setInitialGameEntryPending(false);
    appliedGameStartKeyRef.current = '';
    setCountdown(-1);
    startStatusRef.current = 'cancelled';
    setStartStatus('cancelled');
    setMessage('시작이 취소되었습니다.');
    if (ctx.activeRoomId) void measureFirebaseLatency(() => cancelRoomGameStart(ctx.activeRoomId, cancelVersion, Date.now()));
    else setStartCountdownEndsAt(0);
  }

  function resetGameBoard(nextPieces: BoardPiece[], nextBoardItems: unknown[] = ctx.itemMode ? spawnInitialBoardItems(4, 8) : []) {
    setPieces(nextPieces); setBoardItems(nextBoardItems); setOwnedItems({}); setTrapNodes([]); setShieldedPieceIds([]); setLastMovedPieceIds([]); setLastMovedSeatId(''); setRevealedItems([]); setSelectedPieceId(nextPieces[0]?.id ?? ''); setMovingPieceId(''); setTurnIndex(0); clearRoll(); setRollStack([]); setSelectedRollStackIndex(null); setRollStackClosed(false); setForcedRoll(null); setGoldenYutPickerOpen(false); setItemPromptTiming(null); setBranchChoice('outer'); setCaptureEffect(null); setTrapEffect(null); setPendingTrapPlacement(null); setPendingAfterMoveTurnIndex(null); resolvedItemPromptKeysRef.current.clear();
  }

  function beginTurnOrderIntro() {
    const { intro } = createTurnOrderIntro(ctx.playableSeats, {
      roomId: ctx.activeRoomId,
      startRequestVersion: ctx.startRequestVersion,
      getSeatPieceColor,
      playMode: ctx.playModeForTurnOrder,
      startAt: Math.max(Date.now(), Number(ctx.startCountdownEndsAt ?? 0)),
    });
    if (ctx.activeRoomId) {
      const clientMutationId = `turn_order_intro:${ctx.activeRoomId}:${ctx.startRequestVersion}`;
      void measureFirebaseLatency(() => resolveTurnOrderIntro(ctx.activeRoomId, {
        turnOrderIds: [],
        initialTurnOrderIds: [],
        gameStartedAt: null,
        turnOrderIntro: intro,
        turnOrderPhase: { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 },
        waitingForPlayersReady: false,
        turnDeadlineAt: 0,
        turnDeadlineKind: '',
      }, {
        actorId: ctx.localSeatId,
        clientMutationId,
        startRequestVersion: ctx.startRequestVersion,
        payload: { startRequestVersion: ctx.startRequestVersion, roundId: intro.currentRound.id, startAt: intro.currentRound.startAt },
      })).then((result: any) => {
        if (typeof result.lastSequence === 'number') lastAppliedSequenceRef.current = Math.max(lastAppliedSequenceRef.current, result.lastSequence);
        if (result.turnVersion) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, result.turnVersion);
        if (result.status !== 'committed' && result.status !== 'duplicate') setMessage('순서 정하기 상태 저장이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
      }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '순서 정하기 상태 저장에 실패했습니다.'));
      return;
    }
    setLogs([makeLog('순서 정하기를 준비합니다.'), ...ctx.logs]);
    setTurnOrderIds([]);
    setInitialTurnOrderIds([]);
    setTurnOrderIntro(intro);
    setWaitingForPlayersReady(false);
    setAuthoritativeWinner('');
    setGameStartedAt(null);
  }

  function startLocalGame(confirmedStartRequestVersion: number, confirmedStartRequestId: string) {
    if (!ctx.activeRoomId) { setMessage('온라인 방 정보가 없어 게임을 시작할 수 없습니다.'); setScreen('lobby'); return; }
    if (!confirmedStartRequestVersion || !confirmedStartRequestId) { setMessage('게임 시작 버전을 확인할 수 없어 최신 시작 정보를 기다리고 있습니다.'); setScreen('waitingRoom'); return; }
    const startRequestKey = `${confirmedStartRequestVersion}:${confirmedStartRequestId}`;
    if (startedGameRequestVersionsRef.current.has(startRequestKey)) return;
    logIdRef.current = 0;
    startedGameRequestVersionsRef.current.add(startRequestKey);
    const nextPieces = makePieces(ctx.playableSeats, ctx.pieceCount, ctx.playModeForTurnOrder);
    const nextGameSeats = gameSeatSnapshotsFromSeats(ctx.playableSeats);
    const nextBoardItems = ctx.itemMode ? spawnInitialBoardItems(4, 8) : [];
    const initialTurnOrderPhase = { active: false, index: 0, rolls: [], deadline: 0, readyAt: 0 };
    const { intro: initialTurnOrderIntro } = createTurnOrderIntro(ctx.playableSeats, {
      roomId: ctx.activeRoomId,
      startRequestVersion: confirmedStartRequestVersion,
      getSeatPieceColor,
      playMode: ctx.playModeForTurnOrder,
      startAt: Math.max(Date.now(), Number(ctx.startCountdownEndsAt ?? 0)),
    });
    const prepLog = makeLog('순서 정하기를 준비합니다.');
    const initialSyncedState = {
      pieces: nextPieces,
      turnIndex: 0,
      turnOrderIds: [],
      initialTurnOrderIds: [],
      completedSeatIds: [],
      rankingSeatIds: [],
      gameEndMode: '' as const,
      lastFinishedSeatId: '',
      continuationRound: 0,
      roll: null,
      rollStack: [],
      selectedRollStackIndex: null,
      rollStackClosed: false,
      boardItems: nextBoardItems,
      ownedItems: {},
      trapNodes: [],
      shieldedPieceIds: [],
      logs: [prepLog],
      winner: '',
      captureEffect: null,
      trapEffect: null,
      fallEffect: null,
      gameStartedAt: null,
      turnOrderIntro: initialTurnOrderIntro,
      pendingTrapPlacement: null,
      rollLockUntil: 0,
      lastMovedPieceIds: [],
      lastMovedSeatId: '',
      itemPromptTiming: null,
      branchChoice: 'outer',
      rollResultReadyAt: 0,
      turnOrderPhase: initialTurnOrderPhase,
      waitingForPlayersReady: false,
      turnDeadlineAt: 0,
      turnDeadlineKind: '' as const,
      gameSeats: nextGameSeats,
      startRequestVersion: confirmedStartRequestVersion,
      startRequestId: confirmedStartRequestId,
    };
    const initialStateFingerprint = makeGameStateFingerprint({
      ...initialSyncedState,
      pendingItemPickup: null,
      pendingGoldenYutSelection: null,
      pendingAfterMoveTurnIndex: null,
      effectiveRollResultReadyAt: 0,
    });
    savingStateFingerprintRef.current = initialStateFingerprint;
    const initialGameStateSaveStartedAt = Date.now();
    setInitialGameStateSaveDiagnostic({ status: 'pending', turnVersion: 0, lastSequence: 0, startedAt: initialGameStateSaveStartedAt, completedAt: 0, source: 'initializeGameState', message: '', fingerprint: initialStateFingerprint.slice(0, 24) });
    void measureFirebaseLatency(async () => {
      const initializeDelayMs = getQaInitializeGameStateDelayMs();
      if (initializeDelayMs > 0) await delay(initializeDelayMs);
      return initializeGameState(ctx.activeRoomId, initialSyncedState, {
        actorId: ctx.localSeatId,
        startRequestVersion: confirmedStartRequestVersion,
        startRequestId: confirmedStartRequestId,
        initializedAt: initialGameStateSaveStartedAt,
        clientMutationId: `game_initialized:${ctx.activeRoomId}:${confirmedStartRequestVersion}:${confirmedStartRequestId}`,
        payload: { startRequestVersion: confirmedStartRequestVersion, startRequestId: confirmedStartRequestId, initializedAt: initialGameStateSaveStartedAt },
      });
    }).then(async (result: any) => {
      const lastSequence = Number(result.lastSequence ?? 0);
      const turnVersion = Number(result.turnVersion ?? 0);
      const completedAt = Date.now();
      setInitialGameStateSaveDiagnostic({ status: result.status, turnVersion, lastSequence, startedAt: initialGameStateSaveStartedAt, completedAt, source: 'initializeGameState', message: '', fingerprint: initialStateFingerprint.slice(0, 24) });
      if (result.status === 'committed' || result.status === 'duplicate') {
        savingStateFingerprintRef.current = '';
        setCoordinatorStateSaveKey('');
        const latestState = await measureFirebaseLatency(() => getLatestGameState(ctx.activeRoomId));
        if (latestState) applySyncedStateSnapshot(latestState as SequenceStateSnapshot, { allowMoveAnimation: false, allowRollAnimation: false, updateVersion: true, updateSequence: true });
        return;
      }
      startedGameRequestVersionsRef.current.delete(startRequestKey);
      if (lastSequence > 0) {
        const sequences = await measureFirebaseLatency(() => getGameSequencesSince(ctx.activeRoomId, 0));
        const latestState = applySequenceEvents({ lastSequence: 0 }, sequences.filter((sequence: any) => Number(sequence.sequence ?? 0) <= lastSequence))
          ?? (await measureFirebaseLatency(() => getLatestGameState(ctx.activeRoomId)) as SequenceStateSnapshot | null)
          ?? undefined;
        if (latestState) {
          await replayMissingSequencesThenApply(latestState, 0, lastSequence);
          setInitialGameStateSaveDiagnostic((current: any) => current ? { ...current, source: `${current.source}:sequence-replay`, message: '초기 저장 불일치 후 최신 sequence를 적용했습니다.' } : current);
          return;
        }
      }
      setInitialGameEntryPending(false);
      setMessage(result.status === 'sequence_mismatch' ? '게임 시작 정보가 갱신되어 최신 게임 상태를 기다리고 있습니다.' : '게임 상태 저장이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
    }).catch((error: unknown) => {
      setInitialGameStateSaveDiagnostic({ status: 'error', turnVersion: 0, lastSequence: 0, startedAt: initialGameStateSaveStartedAt, completedAt: Date.now(), source: 'initializeGameState', message: error instanceof Error ? error.message : '게임 상태 저장 중 알 수 없는 오류가 발생했습니다.', fingerprint: initialStateFingerprint.slice(0, 24) });
      startedGameRequestVersionsRef.current.delete(startRequestKey);
      setInitialGameEntryPending(false);
      setMessage(error instanceof Error ? error.message : '게임 상태 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }).finally(() => {
      if (savingStateFingerprintRef.current === initialStateFingerprint) savingStateFingerprintRef.current = '';
    });
  }

  useTurnOrderClock({ activeTurnOrderIntro: ctx.activeTurnOrderIntro, turnOrderPhase: ctx.turnOrderPhase, setTurnOrderClock });
  useTurnOrderPortraitScroll(ctx.screen, ctx.turnOrderPhase.active || Boolean(ctx.activeTurnOrderIntro));
  useEffect(() => {
    if (!ctx.turnOrderIntro) return undefined;
    const hideDelay = Math.max(0, ctx.turnOrderIntro.readyAt - Date.now());
    const hideTimer = window.setTimeout(() => setTurnOrderIntro((current: any) => current ? { ...current, visible: false } : current), hideDelay);
    const readyTimer = window.setTimeout(() => {
      setTurnOrderIntro(null);
      setGameStartedAt((current: number | null) => current ?? Date.now());
    }, hideDelay);
    return () => { window.clearTimeout(hideTimer); window.clearTimeout(readyTimer); };
  }, [ctx.turnOrderIntro?.readyAt]);
  useEffect(() => {
    if (!ctx.activeRoomId || !ctx.canCompleteInitialOnlineTurnOrderIntro || ctx.screen !== 'game' || !ctx.turnOrderIntro?.readyAt) return undefined;
    const readyAt = ctx.turnOrderIntro.readyAt;
    const completeIntro = () => {
      if (completingTurnOrderIntroRef.current.has(readyAt)) return;
      completingTurnOrderIntroRef.current.add(readyAt);
      void completeTurnOrderIntro(ctx.activeRoomId, { readyAt, actorId: ctx.localSeatId })
        .then((version: number) => { if (version) lastAppliedStateVersionRef.current = Math.max(lastAppliedStateVersionRef.current, version); })
        .finally(() => completingTurnOrderIntroRef.current.delete(readyAt));
    };
    const timer = window.setTimeout(completeIntro, Math.max(0, readyAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [ctx.activeRoomId, ctx.canCompleteInitialOnlineTurnOrderIntro, ctx.localSeatId, ctx.screen, ctx.turnOrderIntro?.readyAt]);
  useEffect(() => {
    if (!ctx.startCountdownEffectActive) {
      if (ctx.countdown >= 0 && ctx.startStatus !== 'requested') setCountdown(-1);
      return undefined;
    }
    let completed = false;
    const enterGameOnce = () => {
      const confirmedStartRequestVersion = ctx.startRequestVersion;
      if (completed) return;
      completed = true;
      const confirmedStartRequestId = startRequestIdRef.current || ctx.startRequestId;
      setCountdown(-1);
      setInitialGameEntryPending(true);
      if (ctx.isInitialGameCoordinator) startLocalGame(confirmedStartRequestVersion, confirmedStartRequestId);
    };
    const updateCountdown = () => {
      const now = Date.now();
      if (now >= ctx.startCountdownEndsAt) { enterGameOnce(); return; }
      if (now < ctx.startCountdownStartsAt) setCountdown(-1);
      else setCountdown(Math.max(0, Math.ceil((ctx.startCountdownEndsAt - now) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timer);
  }, [ctx.isInitialGameCoordinator, ctx.startCountdownEffectActive, ctx.startCountdownEndsAt, ctx.startCountdownStartsAt, ctx.startRequestId, ctx.startRequestVersion, ctx.startStatus]);
  useEffect(() => {
    if (!ctx.activeRoomId || !ctx.currentUserId || ctx.screen !== 'game' || !ctx.startRequestVersion) return;
    const presenceKey = `${ctx.activeRoomId}:${ctx.currentUserId}:${ctx.startRequestVersion}`;
    if (enteredGamePresenceKeyRef.current === presenceKey) return;
    enteredGamePresenceKeyRef.current = presenceKey;
    void measureFirebaseLatency(() => updateRoomPlayer(ctx.activeRoomId, ctx.currentUserId, { enteredGameAt: Date.now(), enteredStartVersion: ctx.startRequestVersion, lastGamePresenceAt: Date.now() }))
      .catch(() => { if (enteredGamePresenceKeyRef.current === presenceKey) enteredGamePresenceKeyRef.current = ''; });
  }, [ctx.activeRoomId, ctx.currentUserId, ctx.screen, ctx.startRequestVersion]);
  useEffect(() => {
    if (!ctx.activeRoomId || !ctx.canResolveInitialOnlineTurnOrder || ctx.screen !== 'game' || !ctx.waitingForPlayersReady || ctx.turnOrderIntro || ctx.turnOrderIds.length > 0 || !ctx.startRequestVersion || !ctx.allHumansEnteredGame) return;
    beginTurnOrderIntro();
  }, [ctx.activeRoomId, ctx.allHumansEnteredGame, ctx.canResolveInitialOnlineTurnOrder, ctx.screen, ctx.startRequestVersion, ctx.turnOrderIds.length, ctx.turnOrderIntro, ctx.waitingForPlayersReady]);
  useEffect(() => {
    if (!ctx.activeRoomId || !ctx.canResolveInitialOnlineTurnOrder || ctx.screen !== 'game' || !ctx.waitingForPlayersReady || ctx.turnOrderIntro || ctx.turnOrderIds.length > 0 || !ctx.startRequestVersion || ctx.allHumansEnteredGame || !ctx.allReadyForFallback || !ctx.piecesLength) return undefined;
    const timer = window.setTimeout(() => { if (!ctx.allHumansEnteredGame) beginTurnOrderIntro(); }, TURN_ORDER_PRESENCE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [ctx.activeRoomId, ctx.allHumansEnteredGame, ctx.allReadyForFallback, ctx.canResolveInitialOnlineTurnOrder, ctx.piecesLength, ctx.screen, ctx.startRequestVersion, ctx.turnOrderIds.length, ctx.turnOrderIntro, ctx.waitingForPlayersReady]);

  return { handleStartGame, cancelStartCountdown, countdown: ctx.countdown, startRequestPending: ctx.startRequestPending, initialGameEntryPending: ctx.initialGameEntryPending };
}
