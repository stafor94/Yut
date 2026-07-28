import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  getGameSequencesSince,
  getLatestGameState,
  type GameSequence,
  type SyncedGameState,
} from '../../features/room/services/roomService';
import { auth } from '../../services/firebase/firebaseAuth';
import { STORAGE_KEYS } from '../appState';
import { publishGameStatisticsDialogOpenHandler } from '../flows/gameStatisticsDialogPresentation';
import {
  buildGameStatistics,
  formatStatisticsPercentage,
  resolveGameStatisticsSeats,
  type PlayerGameStatistics,
} from '../flows/gameStatistics';

type StatisticsRequest = {
  id: number;
  roomId: string;
};

type GameStatisticsQaWindow = Window & {
  __YUT_QA_GAME_STATISTICS_LOCAL_SEAT_ID__?: string;
  __YUT_QA_GAME_STATISTICS_LOADER__?: (roomId: string) => Promise<[SyncedGameState | null, GameSequence[]]> | [SyncedGameState | null, GameSequence[]];
  __YUT_QA_OPEN_GAME_STATISTICS__?: () => void;
};

const readActiveRoomId = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.activeRoomId)?.trim() ?? '';
  } catch {
    return '';
  }
};

const getBadgeClassName = (kind: 'timing' | 'yut', label: string) => (
  `game-statistics-badge ${kind} ${label.toLowerCase().replaceAll(' ', '-')}`
);

const readLocalSeatId = () => {
  const qaSeatId = typeof window === 'undefined'
    ? ''
    : String((window as GameStatisticsQaWindow).__YUT_QA_GAME_STATISTICS_LOCAL_SEAT_ID__ ?? '').trim();
  return qaSeatId || auth?.currentUser?.uid || '';
};

const loadGameStatisticsSource = async (roomId: string): Promise<[SyncedGameState | null, GameSequence[]]> => {
  const qaLoader = typeof window === 'undefined'
    ? undefined
    : (window as GameStatisticsQaWindow).__YUT_QA_GAME_STATISTICS_LOADER__;
  if (qaLoader) return qaLoader(roomId);
  return Promise.all([
    getLatestGameState(roomId),
    getGameSequencesSince(roomId, 0),
  ]);
};

const getDefaultSeatId = (statistics: readonly PlayerGameStatistics[]) => {
  const localSeatId = readLocalSeatId();
  return statistics.some((entry) => entry.seat.id === localSeatId)
    ? localSeatId
    : statistics[0]?.seat.id ?? '';
};

export function GameStatisticsHost() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statistics, setStatistics] = useState<PlayerGameStatistics[]>([]);
  const [selectedSeatId, setSelectedSeatId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [loadedRoomId, setLoadedRoomId] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const dialogOpenRef = useRef(false);
  const requestCounterRef = useRef(0);
  const activeRequestRef = useRef<StatisticsRequest | null>(null);
  const loadingRef = useRef(false);

  const closeDialog = useCallback(() => {
    dialogOpenRef.current = false;
    requestCounterRef.current += 1;
    activeRequestRef.current = null;
    loadingRef.current = false;
    setDialogOpen(false);
    setStatus('idle');
    setErrorMessage('');
    setStatistics([]);
    setSelectedSeatId('');
    setLoadedRoomId('');
  }, []);

  const loadStatistics = useCallback(async (roomId: string) => {
    if (loadingRef.current && activeRequestRef.current?.roomId === roomId) return;

    const requestId = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;
    activeRequestRef.current = { id: requestId, roomId };
    loadingRef.current = true;
    setLoadedRoomId(roomId);
    setStatistics([]);
    setSelectedSeatId('');
    setStatus('loading');
    setErrorMessage('');

    if (!roomId) {
      loadingRef.current = false;
      setStatus('error');
      setErrorMessage('현재 게임 방 정보를 찾지 못했습니다.');
      return;
    }

    try {
      const [latestState, sequences] = await loadGameStatisticsSource(roomId);
      const activeRequest = activeRequestRef.current;
      if (!mountedRef.current
        || !dialogOpenRef.current
        || activeRequest?.id !== requestId
        || activeRequest.roomId !== roomId
        || readActiveRoomId() !== roomId) return;

      const seats = resolveGameStatisticsSeats(latestState as SyncedGameState | null, sequences as GameSequence[]);
      const nextStatistics = buildGameStatistics(sequences as GameSequence[], seats);
      setStatistics(nextStatistics);
      setSelectedSeatId((current) => (
        nextStatistics.some((entry) => entry.seat.id === current)
          ? current
          : getDefaultSeatId(nextStatistics)
      ));
      setStatus('ready');
    } catch (error) {
      const activeRequest = activeRequestRef.current;
      if (!mountedRef.current
        || !dialogOpenRef.current
        || activeRequest?.id !== requestId
        || activeRequest.roomId !== roomId
        || readActiveRoomId() !== roomId) return;
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '통계 정보를 불러오지 못했습니다.');
    } finally {
      if (activeRequestRef.current?.id === requestId) loadingRef.current = false;
    }
  }, []);

  const openDialog = useCallback(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogOpenRef.current = true;
    setDialogOpen(true);
    setStatistics([]);
    setSelectedSeatId('');
    void loadStatistics(readActiveRoomId());
  }, [loadStatistics]);

  useLayoutEffect(() => {
    const unpublish = publishGameStatisticsDialogOpenHandler(openDialog);
    const qaWindow = typeof window === 'undefined' ? null : window as GameStatisticsQaWindow;
    if (qaWindow) qaWindow.__YUT_QA_OPEN_GAME_STATISTICS__ = openDialog;
    return () => {
      unpublish();
      if (qaWindow?.__YUT_QA_OPEN_GAME_STATISTICS__ === openDialog) delete qaWindow.__YUT_QA_OPEN_GAME_STATISTICS__;
    };
  }, [openDialog]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestCounterRef.current += 1;
      activeRequestRef.current = null;
      loadingRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const timer = window.setInterval(() => {
      const currentRoomId = readActiveRoomId();
      if (currentRoomId !== loadedRoomId && !loadingRef.current) void loadStatistics(currentRoomId);
    }, 300);
    return () => window.clearInterval(timer);
  }, [dialogOpen, loadStatistics, loadedRoomId]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button:not([disabled])')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [closeDialog, dialogOpen]);

  const selectedStatistics = statistics.find((entry) => entry.seat.id === selectedSeatId) ?? statistics[0] ?? null;

  const statisticsDialog = dialogOpen ? createPortal(
    <div className="modal-backdrop game-statistics-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section
        ref={dialogRef}
        data-testid="game-statistics-dialog"
        className="diagnostic-modal panel game-statistics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-statistics-title"
        onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <header className="game-statistics-header">
          <p className="section-kicker">Game Statistics</p>
          <h2 id="game-statistics-title">통계 정보</h2>
          {statistics.length > 0 && <div className="game-statistics-tabs" role="tablist" aria-label="플레이어 통계">
            {statistics.map((entry) => {
              const selected = entry.seat.id === selectedStatistics?.seat.id;
              return <button
                key={entry.seat.id}
                id={`game-statistics-tab-${entry.seat.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`game-statistics-panel-${entry.seat.id}`}
                tabIndex={selected ? 0 : -1}
                className={selected ? 'selected' : ''}
                onClick={() => setSelectedSeatId(entry.seat.id)}
              >
                <span>{entry.seat.name}</span>
                {entry.seat.isAI && <small>AI</small>}
              </button>;
            })}
          </div>}
        </header>

        <div data-testid="game-statistics-records" className="game-statistics-records" aria-live="polite">
          {status === 'loading' && <div data-testid="game-statistics-loading" className="game-statistics-state">
            <span className="loading-modal-spinner" aria-hidden="true"></span>
            <strong>통계 정보를 불러오는 중입니다.</strong>
          </div>}
          {status === 'error' && <div data-testid="game-statistics-error" className="game-statistics-state error">
            <strong>통계 정보를 불러오지 못했습니다.</strong>
            <p>{errorMessage}</p>
            <button type="button" disabled={loadingRef.current} onClick={() => { void loadStatistics(readActiveRoomId()); }}>다시 불러오기</button>
          </div>}
          {status === 'ready' && !selectedStatistics && <div className="game-statistics-state">
            <strong>표시할 플레이어 정보가 없습니다.</strong>
          </div>}
          {status === 'ready' && selectedStatistics && <div
            id={`game-statistics-panel-${selectedStatistics.seat.id}`}
            role="tabpanel"
            aria-labelledby={`game-statistics-tab-${selectedStatistics.seat.id}`}
            className="game-statistics-record-list"
          >
            {selectedStatistics.rolls.length > 0
              ? selectedStatistics.rolls.map((record) => <article data-testid="game-statistics-record" className="game-statistics-record" key={`${selectedStatistics.seat.id}-${record.sequence}`}>
                <strong>#{record.sequence}</strong>
                <span className={getBadgeClassName('timing', record.timing)}>{record.timing}</span>
                <span className={getBadgeClassName('yut', record.result)}>{record.result}</span>
              </article>)
              : <div className="game-statistics-state empty"><strong>아직 윷 던지기 기록이 없습니다.</strong></div>}
          </div>}
        </div>

        <footer data-testid="game-statistics-footer" className="game-statistics-footer">
          {selectedStatistics && <>
            <section aria-label="타이밍 결과 통계">
              <h3>타이밍 결과</h3>
              <div className="game-statistics-summary-grid timing">
                {selectedStatistics.timing.map((entry) => <p key={entry.label}>
                  <span>{entry.label}</span>
                  <strong>{entry.count}개 · {formatStatisticsPercentage(entry.percentage)}</strong>
                </p>)}
              </div>
            </section>
            <section aria-label="윷 결과 통계">
              <h3>윷 결과</h3>
              <div className="game-statistics-summary-grid yut">
                {selectedStatistics.yut.map((entry) => <p key={entry.label}>
                  <span>{entry.label}</span>
                  <strong>{entry.count}개 · {formatStatisticsPercentage(entry.percentage)}</strong>
                </p>)}
              </div>
            </section>
            <p data-testid="game-statistics-capture-count" className="game-statistics-capture-count">상대 말 잡기 <strong>{selectedStatistics.capturedPieceCount}회</strong></p>
          </>}
          <div className="modal-actions">
            <button className="secondary" type="button" onClick={closeDialog}>닫기</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  ) : null;

  return <>{statisticsDialog}</>;
}
