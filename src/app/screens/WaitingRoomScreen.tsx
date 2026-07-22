import { useEffect, useState, type ReactNode } from 'react';
import { subscribeRoomPlayers, updateRoomPlayer, type RoomPlayer } from '../../features/room/services/roomService';
import { canManageAiDifficulty, getAiDifficultyBadgeLabel, getEffectiveAiDifficulty, type AiDifficulty } from '../../game-core/aiDifficulty';
import { makeUniqueAIName } from '../flows/aiName';
import { STORAGE_KEYS, type Seat, type Team } from '../appState';

type WaitingRoomScreenProps = {
  canManageRoom: boolean;
  children: ReactNode;
};

type WaitingRoomSettingsPanelProps = {
  isVisible: boolean;
  children: ReactNode;
};

type WaitingRoomSeatListProps = {
  seats: Seat[];
  canManageRoom: boolean;
  roomInGame: boolean;
  localSeatId: string;
  playMode: 'individual' | 'team';
  getSeatPieceColor: (seat: Seat) => string;
  onKickPlayer: (seat: Seat) => void;
  onAddAI: (seatId: string) => void;
  onRemoveAI: (seatId: string) => void;
  onChangeTeam: (seatId: string, team: Team) => void;
};

type RoomPlayerWithDifficulty = RoomPlayer & { aiDifficulty?: unknown };

export function WaitingRoomScreen({ canManageRoom, children }: WaitingRoomScreenProps) {
  return <section data-testid="waiting-room" className={`panel waiting-room compact-waiting-room ${canManageRoom ? 'host-view' : 'player-view'}`} aria-label="방 대기 화면">{children}</section>;
}

export function WaitingRoomSettingsPanel({ isVisible, children }: WaitingRoomSettingsPanelProps) {
  if (!isVisible) return null;
  return <section className="waiting-setup-card" aria-label="방 설정과 시작 조건">{children}</section>;
}

export function WaitingRoomSeatList({ seats, canManageRoom, roomInGame, localSeatId, playMode, getSeatPieceColor, onKickPlayer, onAddAI, onRemoveAI, onChangeTeam }: WaitingRoomSeatListProps) {
  const [aiDifficultyBySeatId, setAiDifficultyBySeatId] = useState<Record<string, AiDifficulty>>({});
  const [pendingDifficultySeatIds, setPendingDifficultySeatIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) return undefined;
    return subscribeRoomPlayers(roomId, (players) => {
      const next: Record<string, AiDifficulty> = {};
      players.forEach((player) => {
        if (!player.isAI && !player.isSubstitutedByAI) return;
        next[player.id] = getEffectiveAiDifficulty(player as RoomPlayerWithDifficulty);
      });
      setAiDifficultyBySeatId(next);
    });
  }, []);

  const changeAiDifficulty = async (seat: Seat, difficulty: AiDifficulty) => {
    if (!canManageAiDifficulty(canManageRoom, seat) || pendingDifficultySeatIds.has(seat.id)) return;
    const roomId = window.localStorage.getItem(STORAGE_KEYS.activeRoomId) ?? '';
    if (!roomId) return;
    const previous = aiDifficultyBySeatId[seat.id] ?? 'hard';
    setAiDifficultyBySeatId((current) => ({ ...current, [seat.id]: difficulty }));
    setPendingDifficultySeatIds((current) => new Set(current).add(seat.id));
    try {
      const nickname = makeUniqueAIName(seats.filter((candidate) => candidate.id !== seat.id), difficulty);
      await updateRoomPlayer(roomId, seat.id, { aiDifficulty: difficulty, nickname } as Partial<Omit<RoomPlayerWithDifficulty, 'id'>>);
    } catch (error) {
      console.warn('AI 난이도 변경에 실패했습니다.', error);
      setAiDifficultyBySeatId((current) => ({ ...current, [seat.id]: previous }));
    } finally {
      setPendingDifficultySeatIds((current) => {
        const next = new Set(current);
        next.delete(seat.id);
        return next;
      });
    }
  };

  return <section className="ready-list compact-ready-list" aria-label="플레이어 자리">
    {seats.map((seat) => {
      const aiDifficulty = aiDifficultyBySeatId[seat.id] ?? 'hard';
      const difficultyPending = pendingDifficultySeatIds.has(seat.id);
      const showDifficultyControls = canManageAiDifficulty(canManageRoom, seat);
      return <article className={`ready-card compact-ready-card ${seat.ready && !seat.isEmpty ? 'ready' : ''} ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''} ${seat.id === localSeatId ? 'me' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}>
        <div className="seat-row">
          <div className="seat-identity">
            <b style={{ background: getSeatPieceColor(seat) }}>{seat.label}</b>
            {seat.isEmpty ? <span className="empty-seat-badge">빈 자리</span> : seat.isAI ? <span className="ai-seat-copy">
              <em className="seat-role-badge">{getAiDifficultyBadgeLabel(aiDifficulty)}</em>
              <strong>{seat.name}</strong>
            </span> : <>
              <strong>{seat.name}</strong>
              <em className="seat-role-badge">{seat.isHost ? '방장' : '플레이어'}</em>
            </>}
          </div>
          <span className={`seat-status-actions ${seat.isAI ? 'ai-seat-actions' : ''}`}>
            {canManageRoom && seat.id !== localSeatId && !seat.isEmpty && !seat.isHost && !seat.isAI && <button className="mini-button secondary kick-player-button" onClick={() => onKickPlayer(seat)}>강퇴</button>}
            {seat.isEmpty && canManageRoom && <button data-testid={`add-ai-${seat.label}`} className="mini-button ai-add-button" onClick={() => onAddAI(seat.id)}>AI 추가</button>}
            {showDifficultyControls ? <span className="ai-difficulty-selector" role="group" aria-label={`${seat.label} AI 난이도`}>
              {(['easy', 'hard'] as AiDifficulty[]).map((difficulty) => <button
                type="button"
                key={difficulty}
                data-testid={`ai-difficulty-${seat.label}-${difficulty}`}
                className={aiDifficulty === difficulty ? 'active' : ''}
                aria-pressed={aiDifficulty === difficulty}
                disabled={difficultyPending}
                onClick={() => void changeAiDifficulty(seat, difficulty)}
              >{difficulty === 'easy' ? '쉬움' : '어려움'}</button>)}
            </span> : null}
            {seat.isAI && canManageRoom && !seat.isHost && <button className="mini-button secondary ai-remove-button" onClick={() => onRemoveAI(seat.id)}>AI 제거</button>}
          </span>
          {roomInGame && !seat.isEmpty ? <span className="seat-ready-label in-game">게임중</span> : seat.ready && !seat.isEmpty && !seat.isHost && !seat.isAI ? <span className="seat-ready-label">준비</span> : null}
        </div>
        {playMode === 'team' && <div className="team-card-selector" role="group" aria-label={`${seat.label} 팀 선택`}>{(['청팀', '홍팀'] as Team[]).map((team) => <button type="button" key={team} className={`team-card-option ${team === seat.team ? 'active' : ''} ${team === '청팀' ? 'blue' : 'red'}`} disabled={!canManageRoom} onClick={() => onChangeTeam(seat.id, team)}>{team}</button>)}</div>}
      </article>;
    })}
  </section>;
}
