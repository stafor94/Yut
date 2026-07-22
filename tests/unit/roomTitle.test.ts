import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOM_TITLE_MAX_LENGTH, getRoomTitleLength, truncateRoomTitle, validateRoomTitle } from '../../src/app/flows/roomTitle';

test('방 제목은 한글 기준 최대 20글자까지만 유지한다', () => {
  const expected = '가'.repeat(ROOM_TITLE_MAX_LENGTH);
  assert.equal(truncateRoomTitle(`${expected}나`), expected);
  assert.equal(getRoomTitleLength(expected), ROOM_TITLE_MAX_LENGTH);
});

test('방 제목 검증은 앞뒤 공백을 제거하고 20글자 제목을 허용한다', () => {
  const title = '가'.repeat(ROOM_TITLE_MAX_LENGTH);
  assert.deepEqual(validateRoomTitle(`  ${title}  `), { valid: true, value: title, message: '' });
});

test('빈 방 제목과 20글자를 넘는 제목은 생성 전에 거부한다', () => {
  const empty = validateRoomTitle('   ');
  const tooLong = validateRoomTitle('가'.repeat(ROOM_TITLE_MAX_LENGTH + 1));

  assert.equal(empty.valid, false);
  assert.equal(empty.message, '방 제목을 입력해주세요.');
  assert.equal(tooLong.valid, false);
  assert.equal(tooLong.value, '가'.repeat(ROOM_TITLE_MAX_LENGTH));
  assert.equal(tooLong.message, '방 제목은 최대 20글자까지 입력할 수 있습니다.');
});

test('이모지처럼 대리 쌍을 사용하는 문자도 사용자 글자 단위로 계산한다', () => {
  const title = '😀'.repeat(ROOM_TITLE_MAX_LENGTH);
  assert.equal(getRoomTitleLength(title), ROOM_TITLE_MAX_LENGTH);
  assert.equal(truncateRoomTitle(`${title}😀`), title);
});
