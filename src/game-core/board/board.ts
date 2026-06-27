import { getRandomItemType, type ItemType } from '../../features/items/logic/items';

export type NodeKind = 'normal' | 'corner' | 'center' | 'start' | 'finish';
export interface BoardNode { id: string; x: number; y: number; kind: NodeKind; playable: boolean; }
export interface BoardItem { id: string; type: ItemType; nodeId: string; }

export const BOARD_NODES: BoardNode[] = [
  { id: 'n01', x: 88, y: 88, kind: 'corner', playable: true }, { id: 'n02', x: 68, y: 88, kind: 'normal', playable: true },
  { id: 'n03', x: 48, y: 88, kind: 'normal', playable: true }, { id: 'n04', x: 28, y: 88, kind: 'normal', playable: true },
  { id: 'n05', x: 8, y: 88, kind: 'corner', playable: true }, { id: 'n06', x: 8, y: 68, kind: 'normal', playable: true },
  { id: 'n07', x: 8, y: 48, kind: 'normal', playable: true }, { id: 'n08', x: 8, y: 28, kind: 'normal', playable: true },
  { id: 'n09', x: 8, y: 8, kind: 'corner', playable: true }, { id: 'n10', x: 28, y: 8, kind: 'normal', playable: true },
  { id: 'n11', x: 48, y: 8, kind: 'normal', playable: true }, { id: 'n12', x: 68, y: 8, kind: 'normal', playable: true },
  { id: 'n13', x: 88, y: 8, kind: 'corner', playable: true }, { id: 'n14', x: 88, y: 28, kind: 'normal', playable: true },
  { id: 'n15', x: 88, y: 48, kind: 'normal', playable: true }, { id: 'n16', x: 88, y: 68, kind: 'normal', playable: true },
  { id: 'c1', x: 28, y: 28, kind: 'normal', playable: true }, { id: 'c2', x: 48, y: 48, kind: 'center', playable: true },
  { id: 'c3', x: 68, y: 68, kind: 'normal', playable: true }, { id: 'c4', x: 68, y: 28, kind: 'normal', playable: true },
  { id: 'c5', x: 28, y: 68, kind: 'normal', playable: true },
];

export function spawnInitialBoardItems(min = 4, max = 8): BoardItem[] {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const candidates = [...BOARD_NODES].sort(() => Math.random() - 0.5).slice(0, count);
  return candidates.map((node, index) => ({ id: `item-${Date.now()}-${index}`, type: getRandomItemType(), nodeId: node.id }));
}
