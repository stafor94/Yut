import { getRandomItemType, type ItemType } from '../../features/items/logic/items';

export type NodeKind = 'normal' | 'corner' | 'center' | 'start' | 'finish';
export interface BoardNode { id: string; x: number; y: number; kind: NodeKind; playable: boolean; }
export interface BoardItem { id: string; type: ItemType; nodeId: string; }

const OUTER_MIN = 8;
const OUTER_MAX = 92;
const OUTER_STEP = (OUTER_MAX - OUTER_MIN) / 5;
const outerAt = (index: number) => Number((OUTER_MIN + OUTER_STEP * index).toFixed(1));

export const BOARD_NODES: BoardNode[] = [
  // 정식 윷놀이 말판의 바깥길: 각 변마다 모서리를 포함해 6칸, 총 20칸입니다.
  { id: 'n01', x: outerAt(5), y: outerAt(5), kind: 'corner', playable: true },
  { id: 'n02', x: outerAt(4), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n03', x: outerAt(3), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n04', x: outerAt(2), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n05', x: outerAt(1), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n06', x: outerAt(0), y: outerAt(5), kind: 'corner', playable: true },
  { id: 'n07', x: outerAt(0), y: outerAt(4), kind: 'normal', playable: true },
  { id: 'n08', x: outerAt(0), y: outerAt(3), kind: 'normal', playable: true },
  { id: 'n09', x: outerAt(0), y: outerAt(2), kind: 'normal', playable: true },
  { id: 'n10', x: outerAt(0), y: outerAt(1), kind: 'normal', playable: true },
  { id: 'n11', x: outerAt(0), y: outerAt(0), kind: 'corner', playable: true },
  { id: 'n12', x: outerAt(1), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n13', x: outerAt(2), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n14', x: outerAt(3), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n15', x: outerAt(4), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n16', x: outerAt(5), y: outerAt(0), kind: 'corner', playable: true },
  { id: 'n17', x: outerAt(5), y: outerAt(1), kind: 'normal', playable: true },
  { id: 'n18', x: outerAt(5), y: outerAt(2), kind: 'normal', playable: true },
  { id: 'n19', x: outerAt(5), y: outerAt(3), kind: 'normal', playable: true },
  { id: 'n20', x: outerAt(5), y: outerAt(4), kind: 'normal', playable: true },
  // 대각선 지름길: 각 대각선은 모서리-2칸-가운데-2칸-모서리로 이어집니다.
  { id: 'd01', x: 22, y: 22, kind: 'normal', playable: true },
  { id: 'd02', x: 36, y: 36, kind: 'normal', playable: true },
  { id: 'c01', x: 50, y: 50, kind: 'center', playable: true },
  { id: 'd03', x: 64, y: 64, kind: 'normal', playable: true },
  { id: 'd04', x: 78, y: 78, kind: 'normal', playable: true },
  { id: 'd05', x: 78, y: 22, kind: 'normal', playable: true },
  { id: 'd06', x: 64, y: 36, kind: 'normal', playable: true },
  { id: 'd07', x: 36, y: 64, kind: 'normal', playable: true },
  { id: 'd08', x: 22, y: 78, kind: 'normal', playable: true },
];

export function spawnInitialBoardItems(min = 4, max = 8): BoardItem[] {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const candidates = [...BOARD_NODES].sort(() => Math.random() - 0.5).slice(0, count);
  return candidates.map((node, index) => ({ id: `item-${Date.now()}-${index}`, type: getRandomItemType(), nodeId: node.id }));
}
