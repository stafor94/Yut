import { expectAppShell } from './ui.js';

export async function expectHardAiStackedStrategyContract(page, expect) {
  await expectAppShell(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.__YUT_AI_STRATEGY__?.planAiStackedMove))).toBe(true);

  const plan = await page.evaluate(() => {
    const hardSeat = { id: 'hard', team: 'blue', aiDifficulty: 'hard', isAI: true };
    const enemySeat = { id: 'enemy', team: 'red', aiDifficulty: 'hard', isAI: false };
    const pieces = [
      { id: 'hard-1', ownerId: 'hard', label: 'H1', color: '#000', nodeIndex: 3, nodeId: 'n04', started: true, finished: false },
      { id: 'enemy-1', ownerId: 'enemy', label: 'E1', color: '#fff', nodeIndex: 14, nodeId: 'n15', started: true, finished: false },
    ];
    const seats = { hard: hardSeat, enemy: enemySeat };
    const context = {
      pieces,
      shieldedPieceIds: [],
      trapNodeIds: [],
      boardItems: [],
      canSeatControlPiece: (seat, candidate) => Boolean(seat && candidate && seat.id === candidate.ownerId),
      getSeatById: (seatId) => seats[seatId],
      isSameSide: (left, right) => Boolean(left && right && left.team === right.team),
    };
    const result = window.__YUT_AI_STRATEGY__.planAiStackedMove(
      hardSeat,
      [{ name: '도', steps: 1 }, { name: '개', steps: 2 }],
      context,
    );
    if (!result) return null;
    return {
      first: {
        rollStackIndex: result.action.rollStackIndex,
        landedNodeId: result.action.projection?.landedNodeId,
        branchChoice: result.action.branchChoice,
      },
      second: result.actions[1] ? {
        rollStackIndex: result.actions[1].rollStackIndex,
        landedNodeId: result.actions[1].projection?.landedNodeId,
        branchChoice: result.actions[1].branchChoice,
      } : null,
      exploredNodes: result.exploredNodes,
      limited: result.limited,
    };
  });

  expect(plan).toEqual({
    first: { rollStackIndex: 1, landedNodeId: 'n06', branchChoice: 'outer' },
    second: { rollStackIndex: 0, landedNodeId: 'd05', branchChoice: 'shortcut' },
    exploredNodes: expect.any(Number),
    limited: false,
  });
}
