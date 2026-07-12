from pathlib import Path
import traceback

status = Path('.patch-status')
error = Path('.patch-error')
path = Path('tests/unit/game-core.test.ts')
anchor = "test('온라인 이동값 변경 아이템은 서버에서 roll과 스택을 함께 갱신한다', () => {"
insert = """test('온라인 일반 다시 던지기는 실제 roll_yut 입력 기회를 열고 사용 기록을 남긴다', () => {
  const useResult = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      roll: { name: '개', steps: 2 },
      selectedRollStackIndex: null,
      rollStackClosed: false,
      itemPromptTiming: 'after_roll',
      ownedItems: { 'seat-1': ['reroll'] },
      logs: [],
    },
    { type: 'use_item', actorId: 'seat-1', payload: { itemType: 'reroll' } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(useResult.status, 'committed');
  assert.equal(useResult.patch?.roll, null);
  assert.equal(useResult.patch?.selectedRollStackIndex, -1);
  assert.equal(useResult.patch?.turnDeadlineKind, 'roll');
  assert.match(String((useResult.patch?.logs as Array<{ text: string }>)[0]?.text), /다시 던지기 아이템을 사용했습니다/);

  const rollResult = reduceAuthoritativeGameAction(
    {
      ...baseState(),
      ...useResult.patch,
      turnOrderIds: ['seat-1', 'seat-2'],
      logs: (useResult.patch?.logs as EngineLog[]) ?? [],
    } as EngineState,
    { type: 'roll_yut', actorId: 'seat-1', payload: { rollTimingZone: 'perfect', clientRollResult: { name: '걸', steps: 3 }, clientFallOccurred: false, clientFallCount: 0 } },
    { playMode: 'individual', pieceCount: 4, stackedRollMode: false },
  );

  assert.equal(rollResult.status, 'committed');
  assert.deepEqual(rollResult.patch?.roll, { name: '걸', steps: 3 });
  assert.equal(rollResult.patch?.selectedRollStackIndex, null);
});

"""

try:
    text = path.read_text(encoding='utf-8')
    if text.count(anchor) != 1:
        raise RuntimeError(f'expected one anchor, found {text.count(anchor)}')
    path.write_text(text.replace(anchor, insert + anchor, 1), encoding='utf-8')
    status.write_text('ok\n', encoding='utf-8')
    error.unlink(missing_ok=True)
except Exception:
    status.write_text('failed\n', encoding='utf-8')
    error.write_text(traceback.format_exc(), encoding='utf-8')
