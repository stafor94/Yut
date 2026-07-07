import type { CSSProperties, ReactNode } from 'react';
import { ItemCard } from '../../features/items/components/ItemCard';
import type { ItemType } from '../../features/items/logic/items';
import { TEAM_COLORS, type GameLog, type PieceCount, type PlayMode, type Seat } from '../appState';
import { GameLogPanel, PlayersPanel } from '../screens/GameScreen';
import { formatRoomRuleText, getRoomRuleBadges } from '../appUtils';

type GamePlayersPanelProps = {
  title: string;
  playMode: PlayMode;
  maxPlayers: 2 | 3 | 4;
  pieceCount: PieceCount;
  itemMode: boolean;
  stackedRollMode?: boolean;
  seats: Seat[];
  activeSeatId?: string;
  completedSeatIds: string[];
  rankingSeatIds: string[];
  spectators: Seat[];
  ownedItems: Record<string, ItemType[]>;
  localSeatId: string;
  getPlayerCardName: (seat: Seat) => string;
  getSeatPieceColor: (seat: Seat | undefined) => string;
  onOpenEndGameDialog: () => void;
};

export function GamePlayersPanel({
  title,
  playMode,
  maxPlayers,
  pieceCount,
  itemMode, stackedRollMode = false,
  seats,
  activeSeatId,
  completedSeatIds,
  rankingSeatIds,
  spectators,
  ownedItems,
  localSeatId,
  getPlayerCardName,
  getSeatPieceColor,
  onOpenEndGameDialog,
}: GamePlayersPanelProps) {
  const roomRuleText = formatRoomRuleText(playMode, maxPlayers, pieceCount, itemMode, stackedRollMode);
  const roomRuleBadges = getRoomRuleBadges(playMode, maxPlayers, pieceCount, itemMode, stackedRollMode);

  return <PlayersPanel>
    <h2>{title}</h2>
    <p className="game-end-guide room-rule-badges game-room-rule-badges" aria-label={`방 옵션: ${roomRuleText}`}>{roomRuleBadges.map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}</p>
    {seats.map((seat) => {
      const rankIndex = rankingSeatIds.indexOf(seat.id);
      const finishText = rankIndex >= 0 ? `${rankIndex + 1}위 완주` : completedSeatIds.includes(seat.id) ? '완주' : '';
      const statusText = finishText || (seat.isAI ? 'AI' : '유저');
      const displayName = getPlayerCardName(seat);
      return <div className={`player game-player-card ${seat.isAI ? 'ai' : ''} ${activeSeatId === seat.id ? 'active' : ''} ${playMode === 'team' ? (seat.team === '청팀' ? 'blue-team' : 'red-team') : ''}`} key={seat.id}>
        <span className="game-player-title">
          <b className="game-player-label" style={{ color: playMode === 'team' ? TEAM_COLORS[seat.team] : getSeatPieceColor(seat) }}>{displayName}</b>
        </span>
        <span className="player-badges game-player-meta">
          {playMode === 'team' && <small>{seat.team}</small>}
        </span>
        <em className="game-player-status">{statusText}</em>
      </div>;
    })}
    {spectators.length > 0 && <div className="spectator-list"><h2>관전자</h2>{spectators.map((spectator) => <p key={spectator.id}>👁 {spectator.name}</p>)}</div>}
    <div className="player-items"><h2>보유 아이템</h2>{(ownedItems[localSeatId] ?? []).length ? <div className="item-grid">{(ownedItems[localSeatId] ?? []).map((type, index) => <div className="item-info" key={`${type}-${index}`}><ItemCard type={type} /></div>)}</div> : <p className="empty-state">보유한 아이템이 없습니다.</p>}</div>
    <button className="secondary end-game" onClick={onOpenEndGameDialog}>게임 종료</button>
  </PlayersPanel>;
}

type GameLogPanelViewProps = {
  logs: GameLog[];
  getLogCardStyle: (text: string, nextText?: string) => CSSProperties;
  formatStoredLogSequence: (log: GameLog, displayIndex?: number) => string;
  renderLogText: (text: string) => ReactNode;
  onOpenSequenceExportDialog: () => void;
  onOpenDiagnosticDialog: () => void;
};

export function GameLogPanelView({
  logs,
  getLogCardStyle,
  formatStoredLogSequence,
  renderLogText,
  onOpenSequenceExportDialog,
  onOpenDiagnosticDialog,
}: GameLogPanelViewProps) {
  return <GameLogPanel>
    <div className="log-header"><h2>진행 기록</h2><button type="button" className="diagnostic-button" onClick={onOpenSequenceExportDialog} aria-label="최신 상태와 전체 시퀀스 내보내기" title="최신 상태와 전체 시퀀스">🧾</button><button type="button" className="diagnostic-button" onClick={onOpenDiagnosticDialog} aria-label="게임 상태 진단 열기" title="게임 상태 진단">📄</button></div>
    <div className="log-list">{logs.map((log, index) => <p key={log.id} style={getLogCardStyle(log.text, logs[index + 1]?.text)}><span className="log-sequence">{formatStoredLogSequence(log)}</span>{renderLogText(log.text)}</p>)}</div>
  </GameLogPanel>;
}
