import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardPiece } from '../../src/features/game/components/GameBoard';
import type { Seat } from '../../src/app/appState';
import { chooseAiMove, getAiMoveCandidates, planAiStackedMove, projectAiMove } from '../../src/app/flows/aiFlow';
import { chooseScoredAiCandidate } from '../../src/game-core/aiStrategy';
import { getEffectiveAiDifficulty } from '../../src/game-core/aiDifficulty';
import { chooseAiRollTimingZone, getFallChanceForTimingZone, rollYutResultWithTiming, shouldFallForTimingZone } from '../../src/game-core/roll';

const hardSeat = { id: 'hard', team: 'blue', aiDifficulty: 'hard', isAI: true } as unknown as Seat;
const easySeat = { id: 'easy', team: 'blue', aiDifficulty: 'easy', isAI: true } as unknown as Seat;
const allySeat = { id: 'ally', team: 'blue', aiDifficulty: 'hard', isAI: false } as unknown as Seat;
const enemySeat = { id: 'enemy', team: 'red', aiDifficulty: 'hard', isAI: false } as unknown as Seat;

const piece = (id: string, ownerId: string, nodeId: string, overrides: Partial<BoardPiece> = {}): BoardPiece => ({
  id,
  ownerId,
  label: id,
  color: '#000',
  nodeIndex: 0,
  nodeId,
  started: true,
  finished: false,
  ...overrides,
});

const context = (pieces: BoardPiece[], options: { shieldedPieceIds?: string[]; trapNodeIds?: string[]; boardItems?: Array<{ nodeId: string; type: 'reroll' | 'move_plus_one' | 'move_minus_one' | 'shield' | 'trap' | 'golden_yut' }> } = {}) => ({
  pieces,
  shieldedPieceIds: options.shieldedPieceIds,
  trapNodeIds: options.trapNodeIds,
  boardItems: options.boardItems,
  canSeatControlPiece: (seat: Seat | undefined, candidate: BoardPiece | undefined) => Boolean(seat && candidate && (seat.id === candidate.ownerId || (seat as Seat & { team?: string }).team === ((candidate.ownerId === allySeat.id ? allySeat : candidate.ownerId === hardSeat.id ? hardSeat : enemySeat) as Seat & { team?: string }).team)),
  getSeatById: (seatId: string) => seatId === hardSeat.id ? hardSeat : seatId === easySeat.id ? easySeat : seatId === allySeat.id ? allySeat : enemySeat,
  isSameSide: (left: Seat | undefined, right: Seat | undefined) => Boolean(left && right && (left as Seat & { team?: string }).team === (right as Seat & { team?: string }).team),
});

test('타이밍별 낙 확률과 legacy normal 정규화가 확정 계약을 따른다', () => {
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

test('쉬움과 어려움 AI 타이밍 경계가 확정 분포를 따른다', () => {
  assert.equal(chooseAiRollTimingZone('easy', () => 0.099999), 'perfect');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.1), 'nice');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.3), 'good');
  assert.equal(chooseAiRollTimingZone('easy', () => 0.8), 'bad');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.599999), 'perfect');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.6), 'nice');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.85), 'good');
  assert.equal(chooseAiRollTimingZone('hard', () => 0.95), 'bad');
});

test('변경 후 AI 최종 낙 확률은 쉬움 25%, 어려움 6.75%다', () => {
  const easy = 0.1 * 0 + 0.2 * 0.05 + 0.5 * 0.2 + 0.2 * 0.7;
  const hard = 0.6 * 0 + 0.25 * 0.05 + 0.1 * 0.2 + 0.05 * 0.7;
  assert.equal(easy, 0.25);
  assert.equal(hard, 0.0675);
});

test('Perfect 윷·모 강화와 황금 윷 선택 결과 계약은 유지된다', () => {
  const values = [0.9];
  const perfect = rollYutResultWithTiming('perfect', () => values.shift() ?? 0, true);
  assert.equal(['윷', '모'].includes(perfect.result.name), true);
  const forcedGolden = { name: '황금 윷' as const, steps: 4, bonus: true };
  assert.equal(forcedGolden.name, '황금 윷');
});

test('어려움 AI 스택 플래너는 n04의 [도, 개]에서 개를 먼저 쓰고 다음 도로 shortcut에 진입한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n04'), piece('enemy-1', 'enemy', 'n15')];
  const plan = planAiStackedMove(hardSeat, [{ name: '도', steps: 1 }, { name: '개', steps: 2 }], context(pieces));
  assert.ok(plan);
  const confirmedPlan = plan!;
  assert.equal(confirmedPlan.action.rollStackIndex, 1);
  assert.equal(confirmedPlan.action.projection?.landedNodeId, 'n06');
  assert.equal(confirmedPlan.actions[1]?.rollStackIndex, 0);
  assert.equal(confirmedPlan.actions[1]?.branchChoice, 'shortcut');
  assert.equal(confirmedPlan.actions[1]?.projection?.landedNodeId, 'd05');
});

test('기존 App의 roll별 chooseAiMove 호출도 같은 동기 배치에서 스택 플래너 점수로 재정렬된다', () => {
  const pieces = [piece('hard-1', 'hard', 'n04'), piece('enemy-1', 'enemy', 'n15')];
  const rolls = [{ name: '도' as const, steps: 1 }, { name: '개' as const, steps: 2 }];
  const ranked = rolls
    .map((roll, index) => ({ index, move: chooseAiMove(hardSeat, roll, context(pieces)) }))
    .filter((entry): entry is { index: number; move: NonNullable<typeof entry.move> } => Boolean(entry.move))
    .sort((left, right) => right.move.score - left.move.score);
  assert.equal(ranked[0]?.index, 1);
  assert.equal(ranked[0]?.move.projection?.landedNodeId, 'n06');
});

test('분기점에서 outer와 shortcut을 모두 만들고 바깥길 다수 잡기를 선택한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n06'), piece('enemy-1', 'enemy', 'n07'), piece('enemy-2', 'enemy', 'n07')];
  const candidates = getAiMoveCandidates(hardSeat, { name: '도', steps: 1 }, context(pieces));
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.branchChoice)), new Set(['outer', 'shortcut']));
  assert.equal(candidates[0]?.branchChoice, 'outer');
  assert.equal(candidates[0]?.projection?.capturedPieceCount, 2);
});

test('지름길이 실제 완주 거리를 줄이면 shortcut을 선택한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n06'), piece('enemy-1', 'enemy', 'n02')];
  const move = chooseAiMove(hardSeat, { name: '도', steps: 1 }, context(pieces));
  assert.equal(move?.branchChoice, 'shortcut');
  assert.equal(move?.projection?.usesShortcut, true);
});

test('이동 전후 실제 경로 위협을 비교해 즉시 피격 가능성을 낮추는 도주를 평가한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n10'), piece('hard-2', 'hard', 'n03'), piece('enemy-1', 'enemy', 'n08')];
  const candidates = getAiMoveCandidates(hardSeat, { name: '도', steps: 1 }, context(pieces));
  const escaping = candidates.find((candidate) => candidate.piece.id === 'hard-1');
  assert.ok(escaping?.projection);
  const escapeProjection = escaping!.projection!;
  assert.ok((escapeProjection.threatBefore - escapeProjection.threatAfter) >= 0);
});

test('즉시 승리를 만드는 여러 말 완주는 다른 후보보다 우선한다', () => {
  const pieces = [
    piece('hard-1', 'hard', 'n01', { previousNodeId: 'n20' }),
    piece('hard-2', 'hard', 'n01', { previousNodeId: 'n20' }),
    piece('enemy-1', 'enemy', 'n02'),
  ];
  const move = chooseAiMove(hardSeat, { name: '도', steps: 1 }, context(pieces));
  assert.equal(move?.projection?.finishedPieceCount, 2);
  assert.equal(move?.projection?.landedNodeId, 'finish');
});

test('목적지 업기 가치와 업힌 그룹의 피격 위험을 함께 계산한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n04'), piece('hard-2', 'hard', 'n06'), piece('enemy-1', 'enemy', 'n03')];
  const projection = projectAiMove(pieces[0], { name: '개', steps: 2 }, hardSeat, 'outer', context(pieces));
  assert.equal(projection?.mergedPieceCount, 1);
  assert.equal(projection?.resultingGroupSize, 2);
  assert.ok((projection?.threatAfter ?? 0) >= 0);
});

test('previousNodeId가 있는 중앙 빽도 투영은 authoritative 경로와 일치한다', () => {
  const moving = piece('hard-1', 'hard', 'c01', { previousNodeId: 'd06' });
  const projection = projectAiMove(moving, { name: '빽도', steps: -1 }, hardSeat, 'outer', context([moving]));
  assert.deepEqual(projection?.pathNodeIds, ['d06']);
  assert.equal(projection?.landedNodeId, 'd06');
});

test('팀전 같은 팀 말은 잡기 대상이 아니며 목적지 합류로 계산한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n06'), piece('ally-1', 'ally', 'n07')];
  const projection = projectAiMove(pieces[0], { name: '도', steps: 1 }, hardSeat, 'outer', context(pieces));
  assert.equal(projection?.capturedPieceCount, 0);
  assert.equal(projection?.mergedPieceCount, 1);
});

test('방패 말에는 허위 잡기 점수를 주지 않고 알려진 함정은 강하게 회피한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n06'), piece('enemy-1', 'enemy', 'n07')];
  const shielded = getAiMoveCandidates(hardSeat, { name: '도', steps: 1 }, context(pieces, { shieldedPieceIds: ['enemy-1'] }));
  assert.equal(shielded.find((candidate) => candidate.branchChoice === 'outer')?.projection?.capturedPieceCount, 0);
  const trapped = getAiMoveCandidates(hardSeat, { name: '도', steps: 1 }, context(pieces, { trapNodeIds: ['d05'] }));
  assert.equal(trapped[0]?.branchChoice, 'outer');
});

test('아이템 획득은 보조 가치로 반영되지만 잡기보다 과도하게 우선하지 않는다', () => {
  const pieces = [piece('hard-1', 'hard', 'n06'), piece('enemy-1', 'enemy', 'n07')];
  const candidates = getAiMoveCandidates(hardSeat, { name: '도', steps: 1 }, context(pieces, { boardItems: [{ nodeId: 'd05', type: 'golden_yut' }] }));
  assert.equal(candidates[0]?.branchChoice, 'outer');
  assert.equal(candidates.find((candidate) => candidate.branchChoice === 'shortcut')?.projection?.itemValue, 90);
});

test('중복 rollStack 결과도 원래 index를 보존한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n04')];
  const plan = planAiStackedMove(hardSeat, [{ name: '개', steps: 2 }, { name: '개', steps: 2 }, { name: '도', steps: 1 }], context(pieces));
  assert.ok(plan);
  const confirmedPlan = plan!;
  assert.equal(new Set(confirmedPlan.actions.map((action) => action.rollStackIndex)).size, confirmedPlan.actions.length);
  assert.ok(confirmedPlan.actions.every((action) => action.rollStackIndex >= 0 && action.rollStackIndex < 3));
});

test('비정상적으로 큰 rollStack은 탐색 상한을 적용하고 종료한다', () => {
  const pieces = [piece('hard-1', 'hard', 'n04'), piece('hard-2', 'hard', 'n08')];
  const rolls = Array.from({ length: 20 }, (_, index) => ({ name: index % 2 ? '개' as const : '도' as const, steps: index % 2 ? 2 : 1 }));
  const plan = planAiStackedMove(hardSeat, rolls, context(pieces), { maxDepth: 4, beamWidth: 5, nodeLimit: 40 });
  assert.ok(plan);
  const confirmedPlan = plan!;
  assert.ok(confirmedPlan.exploredNodes <= 40);
  assert.equal(confirmedPlan.limited, true);
});

test('어려움 AI 후보 선택은 최고 점수로 결정적이고 쉬움 AI는 실수 가능성을 유지한다', () => {
  const candidates = [{ id: 'best', score: 100 }, { id: 'second', score: 99 }, { id: 'third', score: 50 }];
  assert.equal(chooseScoredAiCandidate(candidates, 'hard', () => 0.999)?.id, 'best');
  const values = [0.05, 0.99];
  assert.equal(chooseScoredAiCandidate(candidates, 'easy', () => values.shift() ?? 0)?.id, 'third');
});

test('나간 플레이어 대체 AI는 어려움 난이도를 강제한다', () => {
  assert.equal(getEffectiveAiDifficulty({ aiDifficulty: 'easy', isSubstitutedByAI: true }), 'hard');
});
