import type { ReactNode } from 'react';
import type { Seat, Team } from '../appState';

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

export function WaitingRoomScreen({ canManageRoom, children }: WaitingRoomScreenProps) {
  return <section data-testid="waiting-room" className={`panel waiting-room compact-waiting-room ${canManageRoom ? 'host-view' : 'player-view'}`} aria-label="방 대기 화면">{children}</section>;
}

export function WaitingRoomSettingsPanel({ isVisible, children }: WaitingRoomSettingsPanelProps) {
  if (!isVisible) return null;
  return <section className="waiting-setup-card" aria-label="방 설정과 시작 조건">{children}</section>;
}

export function WaitingRoomSeatList({ seats, canManageRoom, roomInGame, localSeatId, playMode, getSeatPieceColor, onKickPlayer, onAddAI, onRemoveAI, onChangeTeam }: WaitingRoomSeatListProps) {
  return <section className="ready-list compact-ready-list" aria-label="플레이어 자리">
    {seats.map((seat) => <article className={`ready-card compact-ready-card ${seat.ready && !seat.isEmpty ? 'ready' : ''} ${seat.isAI ? 'ai' : ''} ${seat.isEmpty ? 'empty' : ''} ${seat.id === localSeatId ? 'me' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}>
      <div className="seat-row"><b style={{ background: getSeatPieceColor(seat) }}>{seat.label}</b>{seat.isEmpty ? <strong className="seat-name-placeholder" aria-hidden="true"></strong> : <strong>{seat.name}</strong>}<span className="seat-status-actions">{canManageRoom && seat.id !== localSeatId && !seat.isEmpty && !seat.isHost && !seat.isAI && <button className="mini-button secondary kick-player-button" onClick={() => onKickPlayer(seat)}>강퇴</button>}{seat.isEmpty && canManageRoom && <button data-testid={`add-ai-${seat.label}`} className="mini-button ai-add-button" onClick={() => onAddAI(seat.id)}>AI 추가</button>}{seat.isAI && canManageRoom && !seat.isHost && <button className="mini-button secondary ai-remove-button" onClick={() => onRemoveAI(seat.id)}>AI 제거</button>}</span>{roomInGame && !seat.isEmpty ? <span className="seat-ready-label in-game">게임중</span> : seat.ready && !seat.isEmpty && !seat.isHost && <span className="seat-ready-label">준비</span>}<em className={`seat-role-badge ${seat.isEmpty ? 'empty-seat-badge' : ''}`}>{seat.isEmpty ? '빈 자리' : seat.isHost ? '방장' : seat.isAI ? 'AI' : '플레이어'}</em></div>
      {playMode === 'team' && <div className="team-card-selector" role="group" aria-label={`${seat.label} 팀 선택`}>{(['청팀', '홍팀'] as Team[]).map((team) => <button type="button" key={team} className={`team-card-option ${team === seat.team ? 'active' : ''} ${team === '청팀' ? 'blue' : 'red'}`} disabled={!canManageRoom} onClick={() => onChangeTeam(seat.id, team)}>{team}</button>)}</div>}
    </article>)}
  </section>;
}
