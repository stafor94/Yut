export type ItemType = 'reroll' | 'move_plus_one' | 'move_minus_one' | 'shield' | 'trap' | 'golden_yut';
export type ItemTiming = 'before_roll' | 'after_roll' | 'after_move';

export const ITEM_TYPES: ItemType[] = ['reroll','move_plus_one','move_minus_one','shield','trap','golden_yut'];

export const ITEM_DEFINITIONS: Record<ItemType, { name: string; timing: ItemTiming; description: string }> = {
  reroll: { name: '다시 던지기', timing: 'after_roll', description: '윷 결과를 취소하고 한 번 다시 던집니다.' },
  move_plus_one: { name: '한 칸 더 이동', timing: 'after_roll', description: '이번 이동에서 선택한 말이 1칸 더 이동합니다.' },
  move_minus_one: { name: '한 칸 덜 이동', timing: 'after_roll', description: '이번 이동에서 선택한 말이 1칸 덜 이동합니다.' },
  shield: { name: '방패', timing: 'after_move', description: '방금 이동한 말을 다음 내 턴까지 1회 보호합니다.' },
  trap: { name: '함정 설치', timing: 'after_move', description: '이동한 말 주변 2칸 이내에 함정을 설치합니다.' },
  golden_yut: { name: '황금 윷', timing: 'before_roll', description: '윷을 던지기 전 원하는 결과를 선택합니다.' },
};

export function getRandomItemType(random = Math.random): ItemType {
  return ITEM_TYPES[Math.floor(random() * ITEM_TYPES.length)];
}
