export type ItemType = 'reroll' | 'move_plus_one' | 'move_minus_one' | 'shield' | 'trap' | 'golden_yut';
export type ItemTiming = 'before_roll' | 'after_roll' | 'after_move';

export const ITEM_TYPES: ItemType[] = ['reroll','move_plus_one','move_minus_one','shield','trap','golden_yut'];

export const ITEM_TIMING_LABELS: Record<ItemTiming, string> = {
  before_roll: '윷 던지기 전',
  after_roll: '윷 던진 후',
  after_move: '말 이동 후',
};

export const ITEM_DEFINITIONS: Record<ItemType, { name: string; timing: ItemTiming; description: string; icon: string }> = {
  reroll: { name: '다시 던지기', timing: 'after_roll', description: '윷 결과를 취소하고 한 번 다시 던집니다.', icon: '🔄' },
  move_plus_one: { name: '한 칸 더 이동', timing: 'after_roll', description: '이번 이동에서 선택한 말이 1칸 더 이동합니다.', icon: '➕' },
  move_minus_one: { name: '한 칸 덜 이동', timing: 'after_roll', description: '이번 이동에서 선택한 말이 1칸 덜 이동합니다.', icon: '➖' },
  shield: { name: '방패', timing: 'after_move', description: '방금 이동한 말을 다음 내 턴까지 1회 보호합니다.', icon: '🛡️' },
  trap: { name: '함정 설치', timing: 'after_move', description: '선택한 내 말 위치에 함정을 설치합니다.', icon: '🪤' },
  golden_yut: { name: '황금 윷', timing: 'before_roll', description: '윷을 던지기 전 원하는 결과를 선택합니다.', icon: '✨' },
};

export function getRandomItemType(random = Math.random): ItemType {
  return ITEM_TYPES[Math.floor(random() * ITEM_TYPES.length)];
}
