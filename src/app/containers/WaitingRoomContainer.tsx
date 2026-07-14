import { useEffect, useRef, useState } from 'react';
import type { PieceCount, PlayMode, Seat, Team } from '../appState';
import { formatRoomRuleText, getRoomRuleBadges } from '../appUtils';
import { getWaitingRoomStartHint } from '../flows/gameStartFlow';
import { WaitingRoomScreen, WaitingRoomSeatList, WaitingRoomSettingsPanel } from '../screens/WaitingRoomScreen';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import { ROOM_START_ACTIVATION_GRACE_MS } from '../../features/room/services/roomGamePreparationPolicy';

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
  const [countdownTransitionPending, setCountdownTransitionPending] = useState(false);
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
  const roomRuleText = formatRoomRuleText(playMode, maxPlayers, pieceCount, itemMode, stackedRollMode);
  const roomRuleBadges = getRoomRuleBadges(playMode, maxPlayers, pieceCount, itemMode, stackedRollMode);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;

    const clearCompletedCountdown = () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      if (!transitionPendingRef.current) return;
      transitionPendingRef.current = false;
      setCountdownTransitionPending(false);
    };
    const holdCompletedCountdown = () => {
      if (transitionPendingRef.current) return;
      transitionPendingRef.current = true;
      setCountdownTransitionPending(true);
      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null;
        transitionPendingRef.current = false;
        setCountdownTransitionPending(false);
      }, ROOM_START_ACTIVATION_GRACE_MS);
    };
    const inspectCountdown = () => {
      const countdownElement = document.querySelector<HTMLElement>('[data-testid="start-countdown-overlay"] strong');
      if (!countdownElement) {
        lastCountdownValueRef.current = null;
        return;
      }

      const value = Number(countdownElement.textContent?.trim());
      if (!Number.isInteger(value) || value < 0 || value > 5) return;
      if (value === 0) {
        if (lastCountdownValueRef.current !== value) playStoredSoundEffect('countdownStart');
        lastCountdownValueRef.current = value;
        holdCompletedCountdown();
        return;
      }

      clearCompletedCountdown();
      if (lastCountdownValueRef.current === value) return;
      lastCountdownValueRef.current = value;
      playStoredSoundEffect('countdown');
    };

    inspectCountdown();
    const observer = new MutationObserver(inspectCountdown);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
      transitionPendingRef.current = false;
    };
  }, []);

  return <WaitingRoomScreen canManageRoom={canManageRoom}>
    <header className="waiting-header">
      <div>
        <h2 className="room-title">{activeRoomTitle || title}</h2>
      </div>
      <span className="room-rule-badges waiting-room-rule-badges" aria-label={`방 옵션: ${roomRuleText}`}>{roomRuleBadges.map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}</span>
    </header>

    <div className="waiting-main-grid">
      <WaitingRoomSettingsPanel isVisible={canManageRoom || playMode === 'team'}>
        {playMode === 'team' && <div className="team-checklist" aria-label="팀전 시작 조건"><strong>팀 균형</strong><span className={teamCounts.청팀 === 2 ? 'ok' : ''}>청팀 {teamCounts.청팀}/2</span><span className={teamCounts.홍팀 === 2 ? 'ok' : ''}>홍팀 {teamCounts.홍팀}/2</span></div>}
        {canManageRoom ? <div className="host-room-options compact-options">
          <div className="option-row option-row-top">
            <fieldset className="radio-group play-mode-group" aria-label="진행"><legend>진행</legend>{(['individual', 'team'] as PlayMode[]).map((mode) => <label key={mode}><input type="radio" name="playMode" checked={playMode === mode} onChange={() => onChangeOptions({ playMode: mode })} />{mode === 'team' ? '팀전' : '개인전'}</label>)}</fieldset>
            <fieldset className="radio-group player-count-group" aria-label="인원"><legend>인원</legend>{([2, 3, 4] as const).map((count) => <label key={count} className={playMode === 'team' && count !== 4 ? 'disabled' : ''} title={playMode === 'team' && count !== 4 ? '팀전은 4인만 가능합니다.' : undefined}><input type="radio" name="maxPlayers" checked={maxPlayers === count} disabled={playMode === 'team' && count !== 4} onChange={() => onChangeOptions({ maxPlayers: count })} />{count}인</label>)}</fieldset>
          </div>
          <div className="option-row option-row-piece">
            <fieldset className="radio-group piece-count-group" aria-label="말"><legend>말</legend>{([1, 2, 3, 4] as const).map((count) => <label key={count}><input type="radio" name="pieceCount" checked={pieceCount === count} onChange={() => onChangeOptions({ pieceCount: count })} />{count}개</label>)}</fieldset>
          </div>
          <div className="option-row option-row-toggle">
            <fieldset className="radio-group item-mode-group" aria-label="아이템"><legend>아이템</legend>{([true, false] as const).map((enabled) => <label key={String(enabled)}><input type="radio" name="itemMode" checked={itemMode === enabled} onChange={() => onChangeOptions({ itemMode: enabled })} />{enabled ? 'ON' : 'OFF'}</label>)}</fieldset>
            <fieldset className="radio-group stacked-roll-mode-group" aria-label="누적던지기"><legend>누적던지기</legend>{([true, false] as const).map((enabled) => <label key={String(enabled)}><input type="radio" name="stackedRollMode" checked={stackedRollMode === enabled} onChange={() => onChangeOptions({ stackedRollMode: enabled })} />{enabled ? 'ON' : 'OFF'}</label>)}</fieldset>
          </div>
        </div> : null}
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

    {countdownTransitionPending && <div className="countdown-scrim" role="presentation"><div data-testid="start-transition-overlay" className="countdown-overlay" role="status"><span>게임 시작</span><strong>0</strong></div></div>}
  </WaitingRoomScreen>;
}
