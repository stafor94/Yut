export const ROOM_TITLE_MAX_LENGTH = 20;

const normalizeUnicode = (value: string) => String(value ?? '').normalize('NFC');

export function getRoomTitleLength(value: string) {
  return Array.from(normalizeUnicode(value)).length;
}

export function truncateRoomTitle(value: string) {
  return Array.from(normalizeUnicode(value)).slice(0, ROOM_TITLE_MAX_LENGTH).join('');
}

export function validateRoomTitle(value: string) {
  const normalized = normalizeUnicode(value).trim();
  if (!normalized) {
    return { valid: false as const, value: '', message: '방 제목을 입력해주세요.' };
  }
  if (getRoomTitleLength(normalized) > ROOM_TITLE_MAX_LENGTH) {
    return {
      valid: false as const,
      value: truncateRoomTitle(normalized),
      message: `방 제목은 최대 ${ROOM_TITLE_MAX_LENGTH}글자까지 입력할 수 있습니다.`,
    };
  }
  return { valid: true as const, value: normalized, message: '' };
}
