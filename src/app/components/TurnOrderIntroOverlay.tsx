import type { CSSProperties } from 'react';
import type { TurnOrderIntro } from '../appState';
import { getTurnOrderSlotRevealDurationMs, getTurnOrderStoppedSlotCount } from '../appUtils';

type TurnOrderIntroOverlayProps = {
  activeTurnOrderIntro: TurnOrderIntro | null;
  localSeatId: string;
  turnOrderClock: number;
  finalHoldMs: number;
};

export function TurnOrderIntroOverlay({ activeTurnOrderIntro, localSeatId, turnOrderClock, finalHoldMs }: TurnOrderIntroOverlayProps) {
  if (!activeTurnOrderIntro?.visible) return null;

  const slotUntil = activeTurnOrderIntro.slotUntil ?? activeTurnOrderIntro.readyAt - finalHoldMs;
  const order = activeTurnOrderIntro.order ?? [];
  const slotRevealDurationMs = getTurnOrderSlotRevealDurationMs(order.length);
  const slotStartedAt = slotUntil - slotRevealDurationMs;
  const elapsedRevealMs = Math.max(0, turnOrderClock - slotStartedAt);
  const stoppedCount = getTurnOrderStoppedSlotCount(order.length, elapsedRevealMs);
  const isSlotAnimating = stoppedCount < order.length;
  const slotRows = order.length ? Array.from({ length: order.length * 3 }, (_, rowIndex) => order[rowIndex % order.length]) : [];

  return <div className="turn-order-ready-overlay slot-machine" role="status" aria-live="assertive">
    <span>순서 정하기</span>
    {isSlotAnimating && <strong>순서를 섞는 중...</strong>}
    <div className="turn-order-slot-list" aria-hidden="true">
      {order.map((entry, columnIndex) => {
        const isStopped = columnIndex < stoppedCount;
        return <div className={`turn-order-slot-window ${isStopped ? 'stopped' : ''}`} key={entry.seatId} style={{ '--slot-index': columnIndex, '--slot-row-count': Math.max(order.length, 1), '--slot-target-row': order.length + columnIndex } as CSSProperties}>
          <div className="turn-order-slot-reel">
            {slotRows.map((slotEntry, rowIndex) => {
              const isTargetRow = rowIndex === order.length + columnIndex;
              return <span className={`turn-order-slot-card ${isStopped && isTargetRow ? 'final-card' : ''} ${slotEntry.seatId === localSeatId ? 'mine' : ''}`} style={{ color: slotEntry.color, borderColor: slotEntry.color }} key={`${entry.seatId}-${slotEntry.seatId}-${rowIndex}`}>{isTargetRow ? `${columnIndex + 1}. ` : ''}{slotEntry.name}</span>;
            })}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
