import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getGameSequencesSince } from '../../features/room/services/roomService';
import {
  createGameStatistics,
  formatStatisticPercentage,
  type GameStatisticsPlayerInput,
  type GameStatisticsSequence,
} from '../flows/gameStatistics';
import '../../styles/game-statistics-dialog.css';

type GameStatisticsDialogProps = {
  open: boolean;
  roomId: string;
  players: GameStatisticsPlayerInput[];
  localSeatId: string;
  onClose: () => void;
};

type LoadState = 'idle' | 'loading' | 'success' | 'error';

export function GameStatisticsDialog({ open, roomId, players, localSeatId, onClose }: GameStatisticsDialogProps) {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [sequences, setSequences] = useState<GameStatisticsSequence[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const requestIdRef = useRef(0);
  const inFlightRequestIdRef = useRef(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const statistics = useMemo(() => createGameStatistics(sequences, players), [players, sequences]);
  const selectedStatistics = statistics.find((entry) => entry.id === selectedPlayerId) ?? statistics[0];

  const loadStatistics = useCallback(async () => {
    if (!open || inFlightRequestIdRef.current) return;
    const requestedRoomId = roomId;
    const requestId = ++requestIdRef.current;
    inFlightRequestIdRef.current = requestId;
    setLoadState('loading');
    setErrorMessage('');
    setSequences([]);

    if (!requestedRoomId) {
      if (requestIdRef.current === requestId) {
        setLoadState('error');
        setErrorMessage('현재 게임 방 정보를 찾지 못했습니다.');
        inFlightRequestIdRef.current = 0;
      }
      return;
    }

    try {
      const loadedSequences = await getGameSequencesSince(requestedRoomId, 0);
      if (!open || requestIdRef.current !== requestId || roomId !== requestedRoomId) return;
      setSequences(loadedSequences);
      setLoadState('success');
    } catch (error) {
      if (!open || requestIdRef.current !== requestId || roomId !== requestedRoomId) return;
      setLoadState('error');
      setErrorMessage(error instanceof Error ? error.message : '통계 정보를 불러오지 못했습니다.');
    } finally {
      if (inFlightRequestIdRef.current === requestId) inFlightRequestIdRef.current = 0;
    }
  }, [open, roomId]);

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      inFlightRequestIdRef.current = 0;
      setLoadState('idle');
      return undefined;
    }
    setSelectedPlayerId(players.find((player) => player.id === localSeatId)?.id ?? players[0]?.id ?? '');
    void loadStatistics();
    return () => {
      requestIdRef.current += 1;
      inFlightRequestIdRef.current = 0;
    };
  }, [loadStatistics, localSeatId, open, players]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-backdrop game-statistics-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        data-testid="game-statistics-dialog"
        className="diagnostic-modal game-statistics-modal panel"
        role="dialog"
        aria-modal="true"
        aria-label="통계 정보"
        style={{ overflow: 'hidden' }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="game-statistics-header">
          <p className="section-kicker">Game Statistics</p>
          <h2>통계 정보</h2>
          <div className="game-statistics-tabs" role="tablist" aria-label="플레이어 통계 탭">
            {players.map((player) => {
              const selected = player.id === selectedStatistics?.id;
              return <button
                key={player.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="game-statistics-player-panel"
                className={selected ? 'selected' : ''}
                onClick={() => setSelectedPlayerId(player.id)}
              ><small>{player.label}</small><span>{player.name}</span></button>;
            })}
          </div>
        </header>

        <div className="game-statistics-records" id="game-statistics-player-panel" role="tabpanel" aria-busy={loadState === 'loading'}>
          {loadState === 'loading' && <div className="game-statistics-state" role="status"><span className="loading-modal-spinner" aria-hidden="true"></span><p>전체 Sequence를 불러오는 중입니다...</p></div>}
          {loadState === 'error' && <div className="game-statistics-state error" role="alert"><strong>통계 정보를 불러오지 못했습니다.</strong><p>{errorMessage}</p><button type="button" onClick={() => { void loadStatistics(); }}>다시 불러오기</button></div>}
          {loadState === 'success' && selectedStatistics && (selectedStatistics.records.length
            ? <div className="game-statistics-record-list">{selectedStatistics.records.map((record) => <article className="game-statistics-record" key={`${selectedStatistics.id}-${record.sequence}`}>
              <strong>#{record.sequence}</strong>
              <span className={`game-statistics-badge timing timing-${record.timing.toLowerCase()}`}>{record.timing}</span>
              <span className={`game-statistics-badge result result-${record.result}`}>{record.result}</span>
            </article>)}</div>
            : <div className="game-statistics-state empty"><p>이 플레이어의 윷 던지기 기록이 없습니다.</p></div>)}
          {loadState === 'success' && !selectedStatistics && <div className="game-statistics-state empty"><p>표시할 플레이어 좌석이 없습니다.</p></div>}
        </div>

        <footer className="game-statistics-footer">
          {selectedStatistics && <div className="game-statistics-summary" aria-live="polite">
            <section><h3>타이밍 결과</h3><div className="game-statistics-summary-grid">{selectedStatistics.timing.map((entry) => <p key={entry.label}><span>{entry.label}</span><strong>{entry.count}개 · {formatStatisticPercentage(entry.percentage)}</strong></p>)}</div></section>
            <section><h3>윷 결과</h3><div className="game-statistics-summary-grid">{selectedStatistics.results.map((entry) => <p key={entry.label}><span>{entry.label}</span><strong>{entry.count}개 · {formatStatisticPercentage(entry.percentage)}</strong></p>)}</div></section>
            <p className="game-statistics-capture"><span>상대 말 잡기</span><strong>{selectedStatistics.captureCount}회</strong></p>
          </div>}
          <div className="modal-actions"><button className="secondary" type="button" onClick={onClose}>닫기</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
