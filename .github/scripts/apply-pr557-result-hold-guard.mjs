import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/App.tsx';
const source = readFileSync(path, 'utf8');
const beforeGuard = `  useEffect(() => {
    const activeAiTrapPlacement = Boolean(pendingTrapPlacement && activeSeat?.isAI && pendingTrapPlacement.ownerId === activeSeat.id);
    if (screen !== 'game' || winner || turnOrderPhase.active || activeTurnOrderIntro || pendingItemPickup || !activeSeat || !activeSeat.isAI || isMyTurn || movingPieceId || (pendingTrapPlacement && !activeAiTrapPlacement)) return undefined;`;
const afterGuard = `  useEffect(() => {
    const activeAiTrapPlacement = Boolean(pendingTrapPlacement && activeSeat?.isAI && pendingTrapPlacement.ownerId === activeSeat.id);
    const pendingResolvedRollAnimation = rollAnimation?.phase === 'landing' || rollAnimation?.phase === 'result-hold';
    if (screen !== 'game' || winner || turnOrderPhase.active || activeTurnOrderIntro || pendingItemPickup || pendingResolvedRollAnimation || !activeSeat || !activeSeat.isAI || isMyTurn || movingPieceId || (pendingTrapPlacement && !activeAiTrapPlacement)) return undefined;`;
const beforeDependencies = `  }, [activeRoomId, activeSeat, activeTurnOrderIntro, canCoordinateOnlineGame, isMyTurn, pendingItemPickup, itemPromptTiming, lastMovedPieceIds, lastMovedSeatId, movingPieceId, pendingGoldenYutSelection, pendingTrapPlacement, pieces, roll, rollStack, rollStackClosed, screen, selectedRollStackIndex, turnIndex, turnOrderPhase.active, winner]);`;
const afterDependencies = `  }, [activeRoomId, activeSeat, activeTurnOrderIntro, canCoordinateOnlineGame, isMyTurn, pendingItemPickup, itemPromptTiming, lastMovedPieceIds, lastMovedSeatId, movingPieceId, pendingGoldenYutSelection, pendingTrapPlacement, pieces, roll, rollAnimation?.phase, rollStack, rollStackClosed, screen, selectedRollStackIndex, turnIndex, turnOrderPhase.active, winner]);`;

if (source.includes(afterGuard) && source.includes(afterDependencies)) {
  console.log('PR #557 result-hold guard is already applied.');
  process.exit(0);
}
if (!source.includes(beforeGuard)) throw new Error('AI autoplay guard target was not found exactly once.');
if (!source.includes(beforeDependencies)) throw new Error('AI autoplay dependency target was not found exactly once.');
const next = source.replace(beforeGuard, afterGuard).replace(beforeDependencies, afterDependencies);
if (next === source) throw new Error('App.tsx was not changed.');
writeFileSync(path, next);
console.log('Applied PR #557 result-hold autoplay guard.');
