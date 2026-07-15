import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { ItemCard } from '../../features/items/components/ItemCard';
import { ITEM_DEFINITIONS, type ItemType } from '../../features/items/logic/items';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import { TEAM_COLORS, type GameLog, type PieceCount, type PlayMode, type Seat } from '../appState';
import { getOwnedItemsPresentation, publishOwnedItemsPresentation, subscribeOwnedItemsPresentation } from '../flows/ownedItemsPresentation';
import { findRemoteConsumedItem, snapshotOwnedItems, type OwnedItemsSnapshot } from '../flows/remoteItemUseNotice';
import { getPlayTimePresentation, subscribePlayTimePresentation } from '../flows/playTimePresentation';
import { getRoomInfoCollapsed, subscribeRoomInfoPresentation } from '../flows/roomInfoPresentation';
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
  const previousOwnedItemsRef = useRef<OwnedItemsSnapshot | null>(null);
  const remoteItemNoticeTimerRef = useRef<number | null>(null);
  const [remoteItemUseNotice, setRemoteItemUseNotice] = useState<RemoteItemUseNotice | null>(null);
  const roomInfoCollapsed = useSyncExternalStore(subscribeRoomInfoPresentation, getRoomInfoCollapsed, getRoomInfoCollapsed);

  useLayoutEffect(() => {
    publishOwnedItemsPresentation(ownedItems[localSeatId] ?? [], itemMode);
  }, [itemMode, localSeatId, ownedItems]);

  useEffect(() => {
    const seatIds = seats.map((seat) => seat.id);
    const previousOwnedItems = previousOwnedItemsRef.current;
    const nextOwnedItems = snapshotOwnedItems(seatIds, ownedItems);
    previousOwnedItemsRef.current = nextOwnedItems;
    if (!previousOwnedItems) return;

    const remoteItemUse = findRemoteConsumedItem(seatIds, localSeatId, previousOwnedItems, nextOwnedItems);
    const remoteSeat = remoteItemUse ? seats.find((seat) => seat.id === remoteItemUse.seatId) : undefined;
    if (!remoteItemUse || !remoteSeat) return;

    if (remoteItemNoticeTimerRef.current !== null) window.clearTimeout(remoteItemNoticeTimerRef.current);
    setRemoteItemUseNotice({
      id: Date.now(),
      playerName: getPlayerCardName(remoteSeat),
      itemType: remoteItemUse.itemType,
      color: playMode === 'team' ? TEAM_COLORS[remoteSeat.team] : getSeatPieceColor(remoteSeat),
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

  return <>
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
    {!roomInfoCollapsed && <PlayersPanel>
      <div id="game-room-info-panel" data-testid="game-room-info-content" className="game-room-details">
        <h2 className="game-room-title">{title}</h2>
        <p className="game-end-guide room-rule-badges game-room-rule-badges" aria-label={`방 옵션: ${roomRuleText}`}>{roomRuleBadges.map((badge) => <span key={badge.key} className={`room-rule-badge ${badge.tone}`}>{badge.label}</span>)}</p>
        <div className="game-player-list">
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
        </div>
        {spectators.length > 0 && <div className="spectator-list"><h2>관전자</h2>{spectators.map((spectator) => <p key={spectator.id}>👁 {spectator.name}</p>)}</div>}
        <button className="secondary end-game" onClick={onOpenEndGameDialog}>게임 종료</button>
      </div>
    </PlayersPanel>}
  </>;
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
  const playTimePresentation = useSyncExternalStore(subscribePlayTimePresentation, getPlayTimePresentation, getPlayTimePresentation);
  const ownedItemsPresentation = useSyncExternalStore(subscribeOwnedItemsPresentation, getOwnedItemsPresentation, getOwnedItemsPresentation);
  const logListRef = useRef<HTMLDivElement | null>(null);
  const [mobileLogViewportHeight, setMobileLogViewportHeight] = useState<number | null>(null);
  const [mobileLogScrollable, setMobileLogScrollable] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const list = logListRef.current;
    if (!list) return undefined;
    const mobileQuery = window.matchMedia('(max-width: 767px)');

    const measure = () => {
      if (!mobileQuery.matches) {
        setMobileLogViewportHeight(null);
        setMobileLogScrollable(false);
        return;
      }
      const cards = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      if (cards.length <= 4) {
        setMobileLogViewportHeight(null);
        setMobileLogScrollable(false);
        return;
      }
      const visibleCards = cards.slice(0, 4);
      const style = window.getComputedStyle(list);
      const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
      const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      const cardsHeight = visibleCards.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0);
      const nextHeight = Math.ceil(cardsHeight + gap * (visibleCards.length - 1) + padding + 12);
      setMobileLogViewportHeight((current) => current === nextHeight ? current : nextHeight);
      setMobileLogScrollable(true);
    };

    measure();
    mobileQuery.addEventListener?.('change', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(list);
    Array.from(list.children).slice(0, 4).forEach((child) => observer?.observe(child));
    return () => {
      mobileQuery.removeEventListener?.('change', measure);
      observer?.disconnect();
    };
  }, [logs]);

  return <GameLogPanel>
    {ownedItemsPresentation.itemMode && <div data-testid="owned-items-panel" className="player-items game-log-owned-items">
      <h2>보유 아이템</h2>
      {ownedItemsPresentation.items.length
        ? <div className="item-grid">{ownedItemsPresentation.items.map((type, index) => <div className="item-info" key={`${type}-${index}`}><ItemCard type={type} /></div>)}</div>
        : <p className="empty-state">보유한 아이템이 없습니다.</p>}
    </div>}
    <div className="log-header">
      <h2>진행 기록</h2>
      <div className="log-header-actions">
        {playTimePresentation.visible && <div data-testid="play-timer" className={`play-time ${playTimePresentation.stopped ? 'stopped' : ''}`} aria-label={`현재 게임 플레이 타임 ${playTimePresentation.playTimeText}`}>{playTimePresentation.playTimeText}</div>}
        <button type="button" className="diagnostic-button" onClick={onOpenSequenceExportDialog} aria-label="최신 상태와 전체 시퀀스 내보내기" title="최신 상태와 전체 시퀀스 내보내기">🧾</button>
      </div>
    </div>
    <div
      ref={logListRef}
      data-testid="game-log-list"
      className={`log-list ${mobileLogScrollable ? 'scrollable' : 'page-scroll'}`}
      style={mobileLogViewportHeight === null ? undefined : { height: `${mobileLogViewportHeight}px`, flex: '0 0 auto' }}
    >{logs.map((log, index) => <p data-testid="game-log-entry" key={log.id} style={getLogCardStyle(log.text, logs[index + 1]?.text)}><span className="log-sequence">{formatStoredLogSequence(log)}</span>{renderLogText(log.text)}</p>)}</div>
  </GameLogPanel>;
}
