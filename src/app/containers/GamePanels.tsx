import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ItemCard } from '../../features/items/components/ItemCard';
import { ITEM_DEFINITIONS, type ItemType } from '../../features/items/logic/items';
import { playStoredSoundEffect } from '../../shared/audio/sound';
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

type RemoteItemUseNotice = {
  id: number;
  playerName: string;
  itemType: ItemType;
  color: string;
};

const cloneOwnedItems = (seats: Seat[], ownedItems: Record<string, ItemType[]>) => Object.fromEntries(
  seats.map((seat) => [seat.id, [...(ownedItems[seat.id] ?? [])]]),
) as Record<string, ItemType[]>;

const getRemovedItemTypes = (previousItems: ItemType[], currentItems: ItemType[]) => {
  const unmatchedCurrentItems = [...currentItems];
  return previousItems.filter((itemType) => {
    const matchingIndex = unmatchedCurrentItems.indexOf(itemType);
    if (matchingIndex < 0) return true;
    unmatchedCurrentItems.splice(matchingIndex, 1);
    return false;
  });
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
  const previousOwnedItemsRef = useRef<Record<string, ItemType[]> | null>(null);
  const remoteItemNoticeTimerRef = useRef<number | null>(null);
  const [remoteItemUseNotice, setRemoteItemUseNotice] = useState<RemoteItemUseNotice | null>(null);

  useEffect(() => {
    const previousOwnedItems = previousOwnedItemsRef.current;
    const nextOwnedItems = cloneOwnedItems(seats, ownedItems);
    previousOwnedItemsRef.current = nextOwnedItems;
    if (!previousOwnedItems) return;

    const remoteItemUse = seats
      .filter((seat) => seat.id !== localSeatId)
      .map((seat) => ({
        seat,
        removedItemType: getRemovedItemTypes(previousOwnedItems[seat.id] ?? [], nextOwnedItems[seat.id] ?? [])[0],
      }))
      .find((entry) => entry.removedItemType);
    if (!remoteItemUse?.removedItemType) return;

    if (remoteItemNoticeTimerRef.current !== null) window.clearTimeout(remoteItemNoticeTimerRef.current);
    setRemoteItemUseNotice({
      id: Date.now(),
      playerName: getPlayerCardName(remoteItemUse.seat),
      itemType: remoteItemUse.removedItemType,
      color: playMode === 'team' ? TEAM_COLORS[remoteItemUse.seat.team] : getSeatPieceColor(remoteItemUse.seat),
    });
    playStoredSoundEffect('itemUse');
    remoteItemNoticeTimerRef.current = window.setTimeout(() => {
      setRemoteItemUseNotice(null);
      remoteItemNoticeTimerRef.current = null;
    }, 3600);
  }, [getPlayerCardName, getSeatPieceColor, localSeatId, ownedItems, playMode, seats]);

  useEffect(() => () => {
    if (remoteItemNoticeTimerRef.current !== null) window.clearTimeout(remoteItemNoticeTimerRef.current);
  }, []);

  return <PlayersPanel>
    {remoteItemUseNotice && <div
      key={remoteItemUseNotice.id}
      role="status"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: '18%',
        left: '50%',
        zIndex: 120,
        width: 'min(88vw, 360px)',
        transform: 'translateX(-50%)',
        border: `2px solid ${remoteItemUseNotice.color}`,
        borderRadius: 18,
        background: 'rgba(17, 24, 39, 0.96)',
        boxShadow: '0 14px 38px rgba(0, 0, 0, 0.38)',
        color: '#fff',
        padding: '14px 18px',
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      <strong style={{ display: 'block', color: remoteItemUseNotice.color, fontSize: '1rem', marginBottom: 5 }}>{remoteItemUseNotice.playerName}</strong>
      <span style={{ display: 'block', fontSize: '1.08rem', fontWeight: 800 }}>
        {ITEM_DEFINITIONS[remoteItemUseNotice.itemType].icon} {ITEM_DEFINITIONS[remoteItemUseNotice.itemType].name} 사용
      </span>
    </div>}
    <h2>{title}</h2>
    <p className="game-end-guide room-rule-badges game-room-rule-badges" aria-label={`방 옵션: ${roomRuleText}`}>{roomRuleBadges.map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}</p>
    {seats.map((seat) => {
      const rankIndex = rankingSeatIds.indexOf(seat.id);
      const finishText = rankIndex >= 0 ? `${rankIndex + 1}위 완주` : completedSeatIds.includes(seat.id) ? '완주' : '';
      const statusText = finishText || (seat.isSubstitutedByAI ? '나감' : seat.isAI ? 'AI' : '유저');
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
};

export function GameLogPanelView({
  logs,
  getLogCardStyle,
  formatStoredLogSequence,
  renderLogText,
  onOpenSequenceExportDialog,
}: GameLogPanelViewProps) {
  return <GameLogPanel>
    <div className="log-header"><h2>진행 기록</h2><button type="button" className="diagnostic-button" onClick={onOpenSequenceExportDialog} aria-label="최신 상태와 전체 시퀀스 내보내기" title="최신 상태와 전체 시퀀스 내보내기">🧾</button></div>
    <div className="log-list">{logs.map((log, index) => <p key={log.id} style={getLogCardStyle(log.text, logs[index + 1]?.text)}><span className="log-sequence">{formatStoredLogSequence(log)}</span>{renderLogText(log.text)}</p>)}</div>
  </GameLogPanel>;
}
