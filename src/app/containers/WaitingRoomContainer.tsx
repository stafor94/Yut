import { useEffect, useRef, useState } from 'react';
import type { PieceCount, PlayMode, Seat, Team } from '../appState';
import { getWaitingRoomStartHint } from '../flows/gameStartFlow';
import { WAITING_ROOM_BACK_EXIT_EVENT } from '../flows/backNavigationExit';
import { WaitingRoomScreen, WaitingRoomSeatList, WaitingRoomSettingsPanel } from '../screens/WaitingRoomScreen';
import { playStoredSoundEffect } from '../../shared/audio/sound';

const COUNTDOWN_TRANSITION_SAFETY_MS = 15_000;

type WaitingRoomContainerProps = {
  canManageRoom: boolean;
  activeRoomTitle: string;
  title: string;
  seats: Seat[];
  localSeatId: string;
  playMode: PlayMode;
  maxPlayers: 2 | 3 | 4;
  pieceCount: PieceCount;
  itemMode: boolean;
  stackedRollMode: boolean;
  teamBalanced: boolean;
  teamCounts: Record<Team, number>;
  allReady: boolean;
  roomInGame: boolean;
  startFlowBusy: boolean;
  initialGameEntryPending: boolean;
  getSeatPieceColor: (seat: Seat) => string;
  onChangeOptions: (params: Partial<{ playMode: PlayMode; maxPlayers: 2 | 3 | 4; pieceCount: PieceCount; itemMode: boolean; stackedRollMode: boolean }>) => void;
  onKickPlayer: (seat: Seat) => void;
  onAddAI: (seatId: string) => void;
  onRemoveAI: (seatId: string) => void;
  onChangeTeam: (seatId: string, team: Team) => void;
  onStartGame: () => void;
  onToggleReady: () => void;
  onLeaveRoom: () => void;
};

export function WaitingRoomContainer({
  canManageRoom,
  activeRoomTitle,
  title,
  seats,
  localSeatId,
  playMode,
  maxPlayers,
  pieceCount,
  itemMode,
  stackedRollMode,
  teamBalanced,
  teamCounts,
  allReady,
  roomInGame,
  startFlowBusy,
  initialGameEntryPending,
  getSeatPieceColor,
  onChangeOptions,
  onKickPlayer,
  onAddAI,
  onRemoveAI,
  onChangeTeam,
  onStartGame,
  onToggleReady,
  onLeaveRoom,
}: WaitingRoomContainerProps) {
  const lastCountdownValueRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionPendingRef = useRef(false);
  const transitionOverlayRef = useRef<HTMLDivElement | null>(null);
  const countdownStartPlayedRef = useRef(false);
  const startFlowActiveRef = useRef(startFlowBusy || initialGameEntryPending || roomInGame);
  const [countdownTransitionPending, setCountdownTransitionPending] = useState(false);
  const [countdownTransitionOverlayVisible, setCountdownTransitionOverlayVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(canManageRoom);
  const myWaitingSeat = seats.find((seat) => seat.id === localSeatId && !seat.isEmpty && !seat.isAI);
  const readyMissingCount = seats.filter((seat) => seat.isEmpty || (!seat.ready && !seat.isAI)).length;
  const effectiveStartFlowBusy = startFlowBusy || countdownTransitionPending;
  const startBlockedHint = getWaitingRoomStartHint({
    initialGameEntryPending,
    roomInGame,
    startFlowBusy: effectiveStartFlowBusy,
    allReady,
    playMode,
    teamBalanced,
    teamCounts,
    readyMissingCount,
  });
  const roomSettingsSummary = `${playMode === 'team' ? '팀전' : '개인전'} · ${maxPlayers}인 · 말 ${pieceCount}개 · 아이템 ${itemMode ? 'ON' : 'OFF'} · 누적 ${stackedRollMode ? 'ON' : 'OFF'}`;
  const optionDisabled = !canManageRoom;
  const renderOption = <T extends string | number | boolean,>(name: string, value: T, label: string, checked: boolean, onChange: () => void, disabled = optionDisabled, title?: string) => (
    <label key={String(value)} className={disabled ? 'disabled' : ''} title={title}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );

  useEffect(() => {
    setSettingsOpen(canManageRoom);
  }, [canManageRoom]);

  useEffect(() => {
    const handleBackNavigationExit = () => onLeaveRoom();
    window.addEventListener(WAITING_ROOM_BACK_EXIT_EVENT, handleBackNavigationExit);
    return () => window.removeEventListener(WAITING_ROOM_BACK_EXIT_EVENT, handleBackNavigationExit);
  }, [onLeaveRoom]);

  useEffect(() => {
    startFlowActiveRef.current = startFlowBusy || initialGameEntryPending || roomInGame;
  }, [initialGameEntryPending, roomInGame, startFlowBusy]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;

    const setTransitionOverlayVisible = (visible: boolean) => {
      if (transitionOverlayRef.current) transitionOverlayRef.current.hidden = !visible;
      setCountdownTransitionOverlayVisible((current) => current === visible ? current : visible);
    };
    const clearTransitionTimer = () => {
      if (transitionTimerRef.current === null) return;
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    };
    const clearCompletedCountdown = () => {
      clearTransitionTimer();
      if (transitionPendingRef.current) {
        transitionPendingRef.current = false;
        setCountdownTransitionPending(false);
      }
      setTransitionOverlayVisible(false);
    };
    const armCompletedCountdown = () => {
      if (!transitionPendingRef.current) {
        transitionPendingRef.current = true;
        setCountdownTransitionPending(true);
      }
      if (transitionTimerRef.current !== null) return;
      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null;
        transitionPendingRef.current = false;
        setCountdownTransitionPending(false);
        setTransitionOverlayVisible(false);
      }, COUNTDOWN_TRANSITION_SAFETY_MS);
    };
    const inspectCountdown = () => {
      const countdownElement = document.querySelector<HTMLElement>('[data-testid="start-countdown-overlay"] strong');
      if (!countdownElement) {
        lastCountdownValueRef.current = null;
        if (transitionPendingRef.current) {
          if (!startFlowActiveRef.current) {
            clearCompletedCountdown();
            countdownStartPlayedRef.current = false;
            return;
          }
          setTransitionOverlayVisible(true);
          if (!countdownStartPlayedRef.current) {
            countdownStartPlayedRef.current = true;
            playStoredSoundEffect('countdownStart');
          }
        }
        return;
      }

      if (transitionPendingRef.current) setTransitionOverlayVisible(false);
      const value = Number(countdownElement.textContent?.trim());
      if (!Number.isInteger(value) || value < 0 || value > 5) return;
      if (lastCountdownValueRef.current === value) return;
      lastCountdownValueRef.current = value;
      if (value === 0) {
        if (!countdownStartPlayedRef.current) {
          countdownStartPlayedRef.current = true;
          playStoredSoundEffect('countdownStart');
        }
        armCompletedCountdown();
        return;
      }
      playStoredSoundEffect('countdown');
      if (value === 1) {
        armCompletedCountdown();
        return;
      }
      clearCompletedCountdown();
    };
    const handleCountdownCancel = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-testid="cancel-start-button"]')) return;
      clearCompletedCountdown();
      lastCountdownValueRef.current = null;
      countdownStartPlayedRef.current = false;
    };

    inspectCountdown();
    const observer = new MutationObserver(inspectCountdown);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    document.addEventListener('click', handleCountdownCancel, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleCountdownCancel, true);
      clearTransitionTimer();
      transitionPendingRef.current = false;
      countdownStartPlayedRef.current = false;
    };
  }, []);

  return <WaitingRoomScreen canManageRoom={canManageRoom}>
    <div className="waiting-main-grid">
      <WaitingRoomSettingsPanel
        roomTitle={activeRoomTitle || title}
        isOpen={canManageRoom && settingsOpen}
        canToggle={canManageRoom}
        summary={roomSettingsSummary}
        onToggle={() => {
          if (canManageRoom) setSettingsOpen((open) => !open);
        }}
      >
        {playMode === 'team' && <div className="team-checklist" aria-label="팀전 시작 조건"><strong>팀 균형</strong><span className={teamCounts.청팀 === 2 ? 'ok' : ''}>청팀 {teamCounts.청팀}/2</span><span className={teamCounts.홍팀 === 2 ? 'ok' : ''}>홍팀 {teamCounts.홍팀}/2</span></div>}
        <div className={`host-room-options compact-options ${canManageRoom ? '' : 'readonly'}`} aria-label={canManageRoom ? '방 설정 변경' : '방 설정 읽기 전용'}>
          <div className="option-row option-row-top">
            <fieldset className="radio-group play-mode-group" aria-label="진행"><legend>진행</legend>{(['individual', 'team'] as PlayMode[]).map((mode) => renderOption('playMode', mode, mode === 'team' ? '팀전' : '개인전', playMode === mode, () => onChangeOptions({ playMode: mode })))}</fieldset>
            <fieldset className="radio-group player-count-group" aria-label="인원"><legend>인원</legend>{([2, 3, 4] as const).map((count) => {
              const disabled = optionDisabled || (playMode === 'team' && count !== 4);
              return renderOption('maxPlayers', count, `${count}인`, maxPlayers === count, () => onChangeOptions({ maxPlayers: count }), disabled, playMode === 'team' && count !== 4 ? '팀전은 4인만 가능합니다.' : undefined);
            })}</fieldset>
          </div>
          <div className="option-row option-row-piece">
            <fieldset className="radio-group piece-count-group" aria-label="말"><legend>말</legend>{([1, 2, 3, 4] as const).map((count) => renderOption('pieceCount', count, `${count}개`, pieceCount === count, () => onChangeOptions({ pieceCount: count })))}</fieldset>
          </div>
          <div className="option-row option-row-toggle">
            <fieldset className="radio-group item-mode-group" aria-label="아이템"><legend>아이템</legend>{([true, false] as const).map((enabled) => renderOption('itemMode', enabled, enabled ? 'ON' : 'OFF', itemMode === enabled, () => onChangeOptions({ itemMode: enabled })))}</fieldset>
            <fieldset className="radio-group stacked-roll-mode-group" aria-label="누적던지기"><legend>누적던지기</legend>{([true, false] as const).map((enabled) => renderOption('stackedRollMode', enabled, enabled ? 'ON' : 'OFF', stackedRollMode === enabled, () => onChangeOptions({ stackedRollMode: enabled })))}</fieldset>
          </div>
        </div>
      </WaitingRoomSettingsPanel>

      <WaitingRoomSeatList seats={seats} roomInGame={roomInGame} canManageRoom={canManageRoom} localSeatId={localSeatId} playMode={playMode} getSeatPieceColor={getSeatPieceColor} onKickPlayer={onKickPlayer} onAddAI={onAddAI} onRemoveAI={onRemoveAI} onChangeTeam={onChangeTeam} />
    </div>

    {playMode === 'team' && !teamBalanced && <p className="notice warning inline-warning">팀전은 4인전만 가능하며 청팀 2명, 홍팀 2명이어야 시작할 수 있습니다.</p>}
    <footer className="waiting-actions role-actions">
      {startBlockedHint ? <p className="start-blocked-hint" role="status">{startBlockedHint}</p> : null}
      <div className="waiting-action-buttons">
        {canManageRoom ? <button data-testid="start-game-button" onClick={onStartGame} disabled={effectiveStartFlowBusy || !allReady}>게임 시작</button> : <button onClick={onToggleReady} disabled={roomInGame || !myWaitingSeat}>{roomInGame ? '게임중' : myWaitingSeat?.ready ? '준비 취소' : '준비 완료'}</button>}
        <button className="secondary" onClick={onLeaveRoom}>방 나가기</button>
      </div>
    </footer>

    {countdownTransitionPending && <div ref={transitionOverlayRef} hidden={!countdownTransitionOverlayVisible} className="countdown-scrim start-transition-scrim" role="presentation"><div data-testid="start-transition-overlay" className="countdown-overlay" role="status"><span>게임 시작</span><strong>0</strong></div></div>}
  </WaitingRoomScreen>;
}
