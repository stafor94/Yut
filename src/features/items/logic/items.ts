export type ItemType = 'reroll' | 'move_plus_one' | 'move_minus_one' | 'shield' | 'trap' | 'golden_yut';
export type ItemTiming = 'before_roll' | 'after_roll' | 'after_move';

export type ItemDefinition = {
  name: string;
  timing: ItemTiming;
  description: string;
  icon: string;
};

export const ITEM_TYPES: ItemType[] = ['reroll','move_plus_one','move_minus_one','shield','trap','golden_yut'];

export const ITEM_TIMING_LABELS: Record<ItemTiming, string> = {
  before_roll: '윷 던지기 전',
  after_roll: '윷 던진 후',
  after_move: '말 이동 후',
};

const ITEM_DEFINITION_TABLE: Record<ItemType, ItemDefinition> = {
  reroll: { name: '다시 던지기', timing: 'after_roll', description: '윷 결과를 취소하고 한 번 다시 던집니다.', icon: '🔄' },
  move_plus_one: { name: '한 칸 더 이동', timing: 'after_roll', description: '윷 결과에 1칸을 더합니다.', icon: '➕' },
  move_minus_one: { name: '한 칸 덜 이동', timing: 'after_roll', description: '윷 결과에서 1칸을 뺍니다.', icon: '➖' },
  shield: { name: '방패', timing: 'after_move', description: '방금 이동한 말을 다음 내 턴까지 1회 보호합니다.', icon: '🛡️' },
  trap: { name: '함정 설치', timing: 'after_move', description: '방금 이동한 말 기준 1칸 이내 칸에 함정을 설치합니다.', icon: '🪤' },
  golden_yut: { name: '황금 윷', timing: 'before_roll', description: '윷을 던지기 전 원하는 결과를 선택합니다.', icon: '✨' },
};

const UNKNOWN_ITEM_DEFINITION: ItemDefinition = {
  name: '알 수 없는 아이템',
  timing: '__invalid__' as ItemTiming,
  description: '지원하지 않는 아이템 데이터입니다.',
  icon: '❓',
};

export function isItemType(value: unknown): value is ItemType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ITEM_DEFINITION_TABLE, value);
}

export function getItemDefinition(value: unknown): ItemDefinition | null {
  return isItemType(value) ? ITEM_DEFINITION_TABLE[value] : null;
}

export const ITEM_DEFINITIONS = new Proxy(ITEM_DEFINITION_TABLE, {
  get(target, property, receiver) {
    if (typeof property !== 'string') return Reflect.get(target, property, receiver);
    return Object.prototype.hasOwnProperty.call(target, property)
      ? target[property as ItemType]
      : UNKNOWN_ITEM_DEFINITION;
  },
}) as Record<ItemType, ItemDefinition>;

const AI_ITEM_VALUES: Record<ItemType, number> = {
  golden_yut: 90,
  reroll: 75,
  move_plus_one: 70,
  trap: 62,
  shield: 58,
  move_minus_one: 45,
};

export function getAiItemValue(type: ItemType) {
  return AI_ITEM_VALUES[type];
}

export function getRandomItemType(random = Math.random): ItemType {
  return ITEM_TYPES[Math.floor(random() * ITEM_TYPES.length)];
}
