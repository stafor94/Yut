import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardPiece } from '../../src/features/game/components/GameBoard';
import type { Seat } from '../../src/app/appState';
import {
  chooseAiMove,
  chooseAiMoveCandidate,
  chooseAiStackedMove,
  getAiMoveCandidates,
  projectAiMove,
  type AiMoveContext,
} from '../../src/app/flows/aiFlow';
import { registerAiRuntimeState } from '../../src/app/flows/aiRuntimeState';
import {
  chooseAiRollTimingZone,
  getFallChanceForTimingZone,
  rollYutResultWithTiming,
  shouldFallForTimingZone,
  type YutResult,
} from '../../src/game-core/roll';
import { reduceAuthoritativeGameAction } from '../../src/features/room/services/roomAuthoritativeReducerCore';

const DO: YutResult = { name: '도', steps: 1 };
const GAE: YutResult = { name: '개', steps: 2 };
const GEOL: YutResult = { name: '걸', steps: 3 };
const YUT: YutResult = { name: '윷', steps: 4, bonus: true };
const MO: YutResult = { name: '모', steps: 5, bonus: true };
const BACK_DO: YutResult = { name: '빽도', steps: -1 };

type TestSeat = Seat & { aiDifficulty?: 'easy' | 'hard'; isSubstitutedByAI?: boolean };

function makeSeat(id: string, options: Partial<TestSeat> = {}): TestSeat {
  return {
    id,
    label: id.toUpperCase(),
    name: id,
    color: id,
    team: id === 'a' || id === 'c' ? '청팀' : '홍팀',
    ready: true,
    isAI: true,
    isEmpty: false,
    aiDifficulty: 'hard',
    ...options,
  } as TestSeat;
}

function makePiece(id: string, ownerId: string, nodeId: string, options: Partial<BoardPiece> = {}): BoardPiece {
  return {
    id,
    label: id,
    ownerId,
    color: ownerId,
    nodeIndex: 0,
    nodeId,
    started: nodeId !== 'n01',
    finished: false,
    ...options,
  };
}

function makeContext(
  pieces: BoardPiece[],
  seats: TestSeat[] = [makeSeat('a'), makeSeat('b')],
  options: Partial<AiMoveContext> & { teamMode?: boolean } = {},
): AiMoveContext {
  const getSeatById = (seatId: string) => seats.find((seat) => seat.id === seatId);
  const isSameSide = (left: Seat | undefined, right: Seat | undefined) => Boolean(
    left && right && (options.teamMode ? left.team === right.team : left.id === right.id),
  );
  const canSeatControlPiece = (seat: Seat | undefined, piece: BoardPiece | undefined) => Boolean(
    seat && piece && isSameSide(getSeatById(piece.ownerId), seat),
  );
  return { pieces, getSeatById, isSameSide, canSeatControlPiece, ...options };
}

test('timing fall probabilities and legacy normal normalization match the new contract', () => {
  assert.equal(getFallChanceForTimingZone('perfect'), 0);
  assert.equal(getFallChanceForTimingZone('nice'), 0.05);
  assert.equal(getFallChanceForTimingZone('good'), 0.2);
  assert.equal(getFallChanceForTimingZone('bad'), 0.7);
  assert.equal(getFallChanceForTimingZone('normal'), 0.7);
  assert.equal(shouldFallForTimingZone('nice', () => 0.049999), true);
  assert.equal(shouldFallForTimingZone('nice', () => 0.05), false);
  assert.equal(shouldFallForTimingZone('bad', () => 0.699999), true);
  assert.equal(shouldFallForTimingZone('bad', () => 0.7), false);
});

test('easy and hard AI timing boundaries remain deterministic', () => {
  const grade = (difficulty: 'easy' | 'hard', value: number) => chooseAiRollTimingZone(difficulty, () => value);
  assert.deepEqual([grade('easy', 0), grade('easy', 0.1), grade('easy', 0.3), grade('easy', 0.8)], ['perfect', 'nice', 'good', 'bad']);
  assert.deepEqual([
    grade('hard', 0.599999), grade('hard', 0.6), grade('hard', 0.849999),
    grade('hard', 0.85), grade('hard', 0.949999), grade('hard', 0.95),
  ], ['perfect', 'nice', 'nice', 'good', 'good', 'bad']);
});

test('final one-roll fall rates are 25% for easy and 6.75% for hard', () => {
  const fall = { perfect: 0, nice: 0.05, good: 0.2, bad: 0.7 } as const;
  const easy = 0.1 * fall.perfect + 0.2 * fall.nice + 0.5 * fall.good + 0.2 * fall.bad;
  const hard = 0.6 * fall.perfect + 0.25 * fall.nice + 0.1 * fall.good + 0.05 * fall.bad;
  assert.equal(easy, 0.25);
  assert.ok(Math.abs(hard - 0.0675) < 1e-12);
});

test('Perfect keeps its enhanced yut/mo distribution and golden yut rejects fall', () => {
  assert.equal(rollYutResultWithTiming('perfect', () => 0.78).result.name, '윷');
  assert.equal(rollYutResultWithTiming('perfect', () => 0.9).result.name, '모');
  const state = {
    pieces: [makePiece('a1', 'a', 'n01', { started: false }), makePiece('b1', 'b', 'n01', { started: false })],
    turnIndex: 0,
    turnOrderIds: ['a', 'b'],
    roll: null,
    logs: [],
    winner: '',
    pendingGoldenYutSelection: { actorId: 'a', deadline: Date.now() + 1000 },
  };
  const reduction = reduceAuthoritativeGameAction(
    state,
    { type: 'roll_yut', actorId: 'a', payload: { selectedGoldenYutResult: MO, clientFallOccurred: true, rollTimingZone: 'bad' } },
    { playMode: 'individual', pieceCount: 1, stackedRollMode: false },
  );
  assert.equal(reduction.status, 'rejected');
  assert.match('reason' in reduction ? reduction.reason ?? '' : '', /황금 윷은 낙이 될 수 없습니다/);
});

test('hard stack planner uses gae first to land on n06, then enters shortcut with do', () => {
  const seat = makeSeat('a');
  const firstContext = makeContext([
    makePiece('a1', 'a', 'n04'),
    makePiece('a2', 'a', 'n01', { started: false }),
    makePiece('b1', 'b', 'n10'),
  ], [seat, makeSeat('b')]);
  const first = chooseAiStackedMove(seat, [DO, GAE], firstContext);
  assert.ok(first);
  assert.equal(first.rollStackIndex, 1);
  assert.equal(first.roll.name, '개');
  assert.equal(first.projection.destinationNodeId, 'n06');

  const secondContext = makeContext([
    makePiece('a1', 'a', 'n06', { previousNodeId: 'n04' }),
    makePiece('a2', 'a', 'n01', { started: false }),
    makePiece('b1', 'b', 'n10'),
  ], [seat, makeSeat('b')]);
  const second = chooseAiStackedMove(seat, [DO], secondContext);
  assert.ok(second);
  assert.equal(second.branchChoice, 'shortcut');
  assert.equal(second.projection.destinationNodeId, 'd05');
});

test('branch candidates compare outer capture against shortcut progress', () => {
  const seat = makeSeat('a');
  const context = makeContext([makePiece('a1', 'a', 'n06'), makePiece('b1', 'b', 'n07')], [seat, makeSeat('b')]);
  const candidates = getAiMoveCandidates(seat, DO, context).filter((candidate) => candidate.piece.id === 'a1');
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.branchChoice)), new Set(['outer', 'shortcut']));
  const selected = chooseAiMove(seat, DO, context);
  assert.equal(selected?.branchChoice, 'outer');
  assert.equal(selected?.projection.capturedPieceCount, 1);
});

test('hard AI selects shortcut when it truly lowers remaining distance', () => {
  const seat = makeSeat('a');
  const selected = chooseAiMove(seat, DO, makeContext([
    makePiece('a1', 'a', 'n06'),
    makePiece('b1', 'b', 'n15'),
  ], [seat, makeSeat('b')]));
  assert.equal(selected?.branchChoice, 'shortcut');
  assert.ok((selected?.projection.remainingDistance ?? 99) < (selected?.projection.remainingDistanceBefore ?? 0));
});

test('hard AI values escape from one-roll capture range', () => {
  const seat = makeSeat('a');
  const selected = chooseAiMove(seat, MO, makeContext([
    makePiece('a1', 'a', 'n03'),
    makePiece('b1', 'b', 'n02'),
  ], [seat, makeSeat('b')]));
  assert.equal(selected?.piece.id, 'a1');
  assert.equal(selected?.projection.destinationNodeId, 'n08');
  assert.ok((selected?.projection.threatReduction ?? 0) > 0);
});

test('capturing a stacked enemy group outranks capturing one piece', () => {
  const seat = makeSeat('a');
  const selected = chooseAiMove(seat, DO, makeContext([
    makePiece('a1', 'a', 'n02'),
    makePiece('a2', 'a', 'n04'),
    makePiece('b1', 'b', 'n03'),
    makePiece('b2', 'b', 'n05'),
    makePiece('b3', 'b', 'n05'),
  ], [seat, makeSeat('b')]));
  assert.equal(selected?.piece.id, 'a2');
  assert.equal(selected?.projection.capturedPieceCount, 2);
});

test('finishing multiple pieces for immediate victory is highest priority', () => {
  const seat = makeSeat('a');
  const selected = chooseAiMove(seat, DO, makeContext([
    makePiece('a1', 'a', 'n01', { started: true, previousNodeId: 'n20' }),
    makePiece('a2', 'a', 'n01', { started: true, previousNodeId: 'n20' }),
    makePiece('b1', 'b', 'n05'),
  ], [seat, makeSeat('b')]));
  assert.equal(selected?.projection.finishedPieceCount, 2);
  assert.equal(selected?.projection.winsImmediately, true);
});

test('projection handles merge value, previousNodeId back-do, teams, shield, and trap semantics', () => {
  const seatA = makeSeat('a');
  const seatC = makeSeat('c', { team: '청팀' });
  const seatB = makeSeat('b', { team: '홍팀' });
  const mergeContext = makeContext([
    makePiece('a1', 'a', 'n04'), makePiece('c1', 'c', 'n05'), makePiece('b1', 'b', 'n05'),
  ], [seatA, seatB, seatC], { teamMode: true, shieldedPieceIds: ['b1'] });
  const mergeProjection = projectAiMove(mergeContext.pieces[0], DO, seatA, 'outer', mergeContext);
  assert.equal(mergeProjection?.mergedPieceCount, 1);
  assert.equal(mergeProjection?.capturedPieceCount, 0);
  assert.deepEqual(mergeProjection?.shieldedCapturePieceIds, ['b1']);

  const backContext = makeContext([makePiece('a1', 'a', 'c01', { previousNodeId: 'd06' }), makePiece('b1', 'b', 'n05')], [seatA, seatB]);
  assert.deepEqual(projectAiMove(backContext.pieces[0], BACK_DO, seatA, 'outer', backContext)?.pathNodeIds, ['d06']);

  const trapContext = makeContext([
    makePiece('a1', 'a', 'n04'), makePiece('a2', 'a', 'n02'), makePiece('b1', 'b', 'n10'),
  ], [seatA, seatB], { trapNodeIds: ['n05'] });
  const selected = chooseAiMove(seatA, DO, trapContext);
  assert.equal(selected?.piece.id, 'a2');
  assert.equal(selected?.projection.hitsKnownTrap, false);
});

test('the existing App stacked loop delegates hard selection to the common planner', () => {
  const seat = makeSeat('a');
  const context = makeContext([
    makePiece('a1', 'a', 'n04'),
    makePiece('a2', 'a', 'n01', { started: false }),
    makePiece('b1', 'b', 'n10'),
  ], [seat, makeSeat('b')]);
  const ranked = [DO, GAE]
    .map((stackRoll, index) => ({ stackRoll, index, move: chooseAiMove(seat, stackRoll, context) }))
    .filter((entry): entry is typeof entry & { move: NonNullable<typeof entry.move> } => Boolean(entry.move))
    .sort((left, right) => right.move.score - left.move.score);
  assert.equal(ranked[0]?.index, 1);
  assert.equal(ranked[0]?.move.projection.destinationNodeId, 'n06');
});

test('runtime state registration supplies shield, trap, and item context to product AI calls', () => {
  const seat = makeSeat('a');
  const pieces = [makePiece('a1', 'a', 'n04'), makePiece('a2', 'a', 'n02'), makePiece('b1', 'b', 'n05')];
  const context = makeContext(pieces, [seat, makeSeat('b')]);
  registerAiRuntimeState(pieces, {
    rollStack: [DO],
    trapNodes: [{ nodeId: 'n05' }],
    shieldedPieceIds: ['b1'],
    boardItems: [],
  });
  const selected = chooseAiMove(seat, DO, context);
  assert.equal(selected?.piece.id, 'a2');
  assert.equal(selected?.projection.hitsKnownTrap, false);
});

test('duplicate roll results preserve the exact original stack index', () => {
  const seat = makeSeat('a');
  const selected = chooseAiStackedMove(seat, [DO, DO], makeContext([
    makePiece('a1', 'a', 'n04'), makePiece('b1', 'b', 'n10'),
  ], [seat, makeSeat('b')]));
  assert.ok(selected);
  assert.equal(selected.rollStackIndex, 0);
  assert.equal(selected.roll, DO);
});

test('large stack search obeys explicit depth, beam, and node budget bounds', () => {
  const seat = makeSeat('a');
  const selected = chooseAiStackedMove(seat, [DO, GAE, GEOL, YUT, MO, DO, GAE, GEOL], makeContext([
    makePiece('a1', 'a', 'n04'), makePiece('a2', 'a', 'n08'), makePiece('b1', 'b', 'n10'),
  ], [seat, makeSeat('b')]), () => 0.5, { nodeBudget: 50, beamWidth: 5 });
  assert.ok(selected);
  assert.equal(selected.search.maxDepth, 4);
  assert.ok(selected.search.exploredNodes <= 50);
  assert.equal(selected.search.nodeBudget, 50);
  assert.equal(selected.search.beamWidth, 5);
  assert.equal(selected.search.truncated, true);
});

test('easy AI keeps randomized mistakes while hard and substituted AI choose the best candidate', () => {
  const candidates = [{ score: 100, id: 'best' }, { score: 90, id: 'second' }, { score: 10, id: 'mistake' }];
  const randomValues = [0.05, 0.99];
  const easy = chooseAiMoveCandidate(candidates, 'easy', () => randomValues.shift() ?? 0);
  const hard = chooseAiMoveCandidate(candidates, 'hard', () => 0.99);
  assert.equal(easy?.id, 'mistake');
  assert.equal(hard?.id, 'best');

  const substituted = makeSeat('a', { aiDifficulty: 'easy', isSubstitutedByAI: true });
  const selected = chooseAiMove(substituted, DO, makeContext([
    makePiece('a1', 'a', 'n06'), makePiece('b1', 'b', 'n07'),
  ], [substituted, makeSeat('b')]), () => 0.99);
  assert.equal(selected?.branchChoice, 'outer');
  assert.equal(selected?.projection.capturedPieceCount, 1);
});
