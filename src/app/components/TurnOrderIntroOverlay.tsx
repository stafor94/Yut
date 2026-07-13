import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { playStoredSoundEffect } from '../../shared/audio/sound';
import type { TurnOrderIntro } from '../appState';
import { buildTurnOrderSlotReel, getTurnOrderSlotRevealDurationMs, getTurnOrderStoppedSlotCount } from '../flows/turnOrderPresentation';

type TurnOrderIntroOverlayProps = {
  activeTurnOrderIntro: TurnOrderIntro | null;
  localSeatId: string;
  turnOrderClock: number;
  finalHoldMs: number;
};

const TURN_ORDER_EXIT_MS = 420;

export function TurnOrderIntroOverlay({ activeTurnOrderIntro, localSeatId, turnOrderClock, finalHoldMs }: TurnOrderIntroOverlayProps) {
  const previousStoppedCountRef = useRef(0);
  const completionSoundTimerRef = useRef<number | null>(null);
  const order = activeTurnOrderIntro?.order ?? [];
  const orderKey = order.map((entry) => `${entry.seatId}:${entry.label}:${entry.name}:${entry.color}`).join('|');
  const reels = useMemo(() => order.map((_, slotIndex) => buildTurnOrderSlotReel(order, slotIndex)), [orderKey]);
  const slotUntil = activeTurnOrderIntro?.slotUntil ?? ((activeTurnOrderIntro?.readyAt ?? 0) - finalHoldMs);
  const slotRevealDurationMs = getTurnOrderSlotRevealDurationMs(order.length);
  const slotStartedAt = slotUntil - slotRevealDurationMs;
  const isWaitingToStart = Boolean(activeTurnOrderIntro?.visible && turnOrderClock < slotStartedAt);
  const elapsedRevealMs = Math.max(0, turnOrderClock - slotStartedAt);
  const stoppedCount = activeTurnOrderIntro?.visible ? getTurnOrderStoppedSlotCount(order.length, elapsedRevealMs) : 0;
  const isFinalized = order.length > 0 && stoppedCount >= order.length;
  const isExiting = Boolean(activeTurnOrderIntro?.visible && isFinalized && activeTurnOrderIntro.readyAt - turnOrderClock <= TURN_ORDER_EXIT_MS);
  const starter = order[0];

  useEffect(() => {
    previousStoppedCountRef.current = 0;
    if (completionSoundTimerRef.current !== null) {
      window.clearTimeout(completionSoundTimerRef.current);
      completionSoundTimerRef.current = null;
    }
  }, [activeTurnOrderIntro?.readyAt, orderKey]);

  useEffect(() => () => {
    if (completionSoundTimerRef.current !== null) window.clearTimeout(completionSoundTimerRef.current);
  }, []);

  useEffect(() => {
    if (!activeTurnOrderIntro?.visible || !order.length || isWaitingToStart) return;
    const previousStoppedCount = previousStoppedCountRef.current;
    if (stoppedCount <= previousStoppedCount) return;

    playStoredSoundEffect(previousStoppedCount === 0 ? 'arrive' : 'move');
    previousStoppedCountRef.current = stoppedCount;
    if (stoppedCount !== order.length) return;

    if (completionSoundTimerRef.current !== null) window.clearTimeout(completionSoundTimerRef.current);
    completionSoundTimerRef.current = window.setTimeout(() => {
      playStoredSoundEffect('countdownStart');
      completionSoundTimerRef.current = null;
    }, 180);
  }, [activeTurnOrderIntro?.visible, isWaitingToStart, order.length, stoppedCount]);

  if (!activeTurnOrderIntro?.visible) return null;

  const announcement = isWaitingToStart
    ? '순서 정하기를 준비하고 있습니다.'
    : isFinalized
      ? `최종 순서가 정해졌습니다. ${order.map((entry, index) => `${index + 1}위 ${entry.name}`).join(', ')}. ${starter?.name ?? ''}님부터 시작합니다.`
      : `순서를 섞는 중입니다. ${stoppedCount}명의 순서가 공개되었습니다.`;

  return <div className={`turn-order-ready-overlay slot-machine ${isWaitingToStart ? 'waiting' : ''} ${isFinalized ? 'finalized' : ''} ${isExiting ? 'exiting' : ''}`} role="status" aria-live="polite">
    <div className="turn-order-presentation-heading">
      <span>순서 정하기</span>
      <strong>{isWaitingToStart ? '잠시 후 순서를 정합니다' : isFinalized ? '최종 순서 확정' : '순서를 섞는 중...'}</strong>
    </div>
    <div className="turn-order-slot-list" aria-hidden="true">
      {order.map((entry, columnIndex) => {
        const isStopped = columnIndex < stoppedCount;
        const reel = reels[columnIndex] ?? { rows: [], targetRow: 0 };
        return <div
          className={`turn-order-slot-window ${isStopped ? 'stopped' : ''} ${columnIndex === 0 ? 'starter' : ''}`}
          key={entry.seatId}
          style={{
            '--slot-index': columnIndex,
            '--slot-row-count': Math.max(order.length, 1),
            '--slot-target-row': reel.targetRow,
            '--slot-color': entry.color,
          } as CSSProperties}
        >
          <div className="turn-order-slot-reel">
            {reel.rows.map((slotEntry, rowIndex) => {
              const isTargetRow = rowIndex === reel.targetRow;
              const isFinalCard = isStopped && isTargetRow;
              return <span
                className={`turn-order-slot-card ${isFinalCard ? 'final-card' : ''} ${isFinalCard && slotEntry.seatId === localSeatId ? 'mine' : ''}`}
                style={{ color: slotEntry.color, borderColor: slotEntry.color }}
                key={`${entry.seatId}-${slotEntry.seatId}-${rowIndex}`}
              >
                {isTargetRow && <b className="turn-order-rank-medal">{columnIndex + 1}</b>}
                <span className="turn-order-slot-name">{slotEntry.name}</span>
                {isFinalCard && slotEntry.seatId === localSeatId && <em className="turn-order-slot-badge mine-badge">나</em>}
                {isFinalCard && columnIndex === 0 && <em className="turn-order-slot-badge starter-badge">★ 선공</em>}
              </span>;
            })}
          </div>
        </div>;
      })}
    </div>
    {isFinalized && starter && <p className="turn-order-final-summary"><span aria-hidden="true">★</span><strong>{starter.name}</strong>님부터 시작합니다.</p>}
    <p className="turn-order-live-summary">{announcement}</p>
  </div>;
}
