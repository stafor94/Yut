import { useEffect, useRef } from 'react';
import type { Seat, TurnOrderPhase, TurnOrderRoll } from '../appState';

export function useTurnOrderClock(params: {
  activeTurnOrderIntro: unknown;
  turnOrderPhase: TurnOrderPhase;
  setTurnOrderClock: (now: number) => void;
}) {
  const { activeTurnOrderIntro, turnOrderPhase, setTurnOrderClock } = params;
  useEffect(() => {
    if (!turnOrderPhase.active && !activeTurnOrderIntro) return undefined;
    setTurnOrderClock(Date.now());
    const timer = window.setInterval(() => setTurnOrderClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [activeTurnOrderIntro, setTurnOrderClock, turnOrderPhase.active, turnOrderPhase.index, turnOrderPhase.deadline]);
}

export function useTurnOrderPortraitScroll(screen: string, shouldScrollForTurnOrder: boolean) {
  useEffect(() => {
    if (screen !== 'game' || !shouldScrollForTurnOrder) return undefined;
    if (!window.matchMedia('(orientation: portrait)').matches) return undefined;
    const timer = window.setTimeout(() => {
      const scrollTarget = document.querySelector<HTMLElement>('.play-controls')
        ?? document.querySelector<HTMLElement>('.board-panel');
      scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [screen, shouldScrollForTurnOrder]);
}

export function useTurnOrderAutoFinish(params: {
  playableSeats: Seat[];
  turnOrderPhase: TurnOrderPhase;
  finishTurnOrderCeremony: (rolls: TurnOrderRoll[]) => void;
}) {
  const { playableSeats, turnOrderPhase, finishTurnOrderCeremony } = params;
  const finishTurnOrderCeremonyRef = useRef(finishTurnOrderCeremony);
  useEffect(() => {
    finishTurnOrderCeremonyRef.current = finishTurnOrderCeremony;
  }, [finishTurnOrderCeremony]);

  useEffect(() => {
    if (!turnOrderPhase.active || !playableSeats.length) return undefined;
    const rolledSeatIds = new Set(turnOrderPhase.rolls.map((rollEntry) => rollEntry.seat.id));
    const allSeatsRolled = playableSeats.every((seat) => rolledSeatIds.has(seat.id));
    if (!allSeatsRolled) return undefined;
    const delayMs = Math.max(0, turnOrderPhase.deadline - Date.now());
    const timer = window.setTimeout(() => finishTurnOrderCeremonyRef.current(turnOrderPhase.rolls), delayMs);
    return () => window.clearTimeout(timer);
  }, [playableSeats, turnOrderPhase]);
}
