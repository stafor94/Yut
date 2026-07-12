import { getRandomItemType, type ItemType } from '../../features/items/logic/items';

export type NodeKind = 'normal' | 'corner' | 'center' | 'start' | 'finish';
export interface BoardNode { id: string; x: number; y: number; kind: NodeKind; playable: boolean; }
export interface BoardItem { id: string; type: ItemType; nodeId: string; }

const OUTER_MIN = 8;
const OUTER_MAX = 92;
const OUTER_STEP = (OUTER_MAX - OUTER_MIN) / 5;
const outerAt = (index: number) => Number((OUTER_MIN + OUTER_STEP * index).toFixed(1));

export const BOARD_NODES: BoardNode[] = [
  // 정식 윷놀이 말판의 바깥길: 시작점에서 첫 이동 방향이 위쪽이 되도록 오른쪽 변을 먼저 오릅니다.
  { id: 'n01', x: outerAt(5), y: outerAt(5), kind: 'start', playable: true },
  { id: 'n02', x: outerAt(5), y: outerAt(4), kind: 'normal', playable: true },
  { id: 'n03', x: outerAt(5), y: outerAt(3), kind: 'normal', playable: true },
  { id: 'n04', x: outerAt(5), y: outerAt(2), kind: 'normal', playable: true },
  { id: 'n05', x: outerAt(5), y: outerAt(1), kind: 'normal', playable: true },
  { id: 'n06', x: outerAt(5), y: outerAt(0), kind: 'corner', playable: true },
  { id: 'n07', x: outerAt(4), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n08', x: outerAt(3), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n09', x: outerAt(2), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n10', x: outerAt(1), y: outerAt(0), kind: 'normal', playable: true },
  { id: 'n11', x: outerAt(0), y: outerAt(0), kind: 'corner', playable: true },
  { id: 'n12', x: outerAt(0), y: outerAt(1), kind: 'normal', playable: true },
  { id: 'n13', x: outerAt(0), y: outerAt(2), kind: 'normal', playable: true },
  { id: 'n14', x: outerAt(0), y: outerAt(3), kind: 'normal', playable: true },
  { id: 'n15', x: outerAt(0), y: outerAt(4), kind: 'normal', playable: true },
  { id: 'n16', x: outerAt(0), y: outerAt(5), kind: 'corner', playable: true },
  { id: 'n17', x: outerAt(1), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n18', x: outerAt(2), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n19', x: outerAt(3), y: outerAt(5), kind: 'normal', playable: true },
  { id: 'n20', x: outerAt(4), y: outerAt(5), kind: 'normal', playable: true },
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

export type BranchChoice = 'outer' | 'shortcut';
export type PieceStatus = 'home' | 'onBoard' | 'finished';
export type RouteContext = 'outer' | 'n06Shortcut' | 'n11Shortcut' | 'centerToN20' | 'centerToN16';
export const FINISH_NODE_ID = 'finish';

const OUTER_ROUTE = ['n01','n02','n03','n04','n05','n06','n07','n08','n09','n10','n11','n12','n13','n14','n15','n16','n17','n18','n19','n20'];
const SHORTCUTS: Record<string, string[]> = {
  n06: ['d05','d06','c01','d07','d08','n16','n17','n18','n19','n20'],
  // Shortcut/return paths pass through the visual start point before finishing.
  n11: ['d01','d02','c01','d03','d04'],
  c01: ['d03','d04'],
};
const CENTER_OUTER_ROUTE = ['d07','d08','n16','n17','n18','n19','n20'];
export const BRANCH_NODE_IDS = ['n06','n11','c01'] as const;

export function getBoardNodeById(nodeId: string) {
  return BOARD_NODES.find((node) => node.id === nodeId);
}

export function getNextBoardNode(currentNode: BoardNode | undefined, branchChoice: BranchChoice = 'outer') {
  if (!currentNode) return BOARD_NODES[0];
  if (currentNode.id === 'c01' && branchChoice === 'outer') return getBoardNodeById(CENTER_OUTER_ROUTE[0]);
  if (branchChoice === 'shortcut' && SHORTCUTS[currentNode.id]) return getBoardNodeById(SHORTCUTS[currentNode.id][0]);
  const shortcutEntry = Object.entries(SHORTCUTS).find(([, route]) => route.includes(currentNode.id));
  if (shortcutEntry) {
    const route = shortcutEntry[1];
    const nextId = route[route.indexOf(currentNode.id) + 1];
    return nextId ? getBoardNodeById(nextId) : undefined;
  }
  const nextOuterId = OUTER_ROUTE[OUTER_ROUTE.indexOf(currentNode.id) + 1];
  return nextOuterId ? getBoardNodeById(nextOuterId) : undefined;
}

export function getMovePathNodeIds(startNodeId: string, steps: number, branchChoice: BranchChoice = 'outer') {
  if (steps < 0) return getBackwardPathNodeIds(startNodeId, Math.abs(steps));
  const pathNodeIds: string[] = [];
  let currentNodeId = startNodeId;
  let activeRoute: string[] | null = null;

  for (let step = 0; step < Math.max(0, steps); step += 1) {
    if (!activeRoute) {
      if (branchChoice === 'shortcut' && SHORTCUTS[currentNodeId]) {
        activeRoute = [currentNodeId, ...SHORTCUTS[currentNodeId]];
      } else if (currentNodeId !== 'c01') {
        const shortcutEntry = Object.entries(SHORTCUTS).find(([, route]) => route.includes(currentNodeId));
        if (shortcutEntry) activeRoute = [shortcutEntry[0], ...shortcutEntry[1]];
      }
    }

    const activeRouteIndex = activeRoute?.indexOf(currentNodeId) ?? -1;
    const nextNodeId = currentNodeId === 'n20' || currentNodeId === 'd04'
      ? 'n01'
      : activeRouteIndex >= 0
      ? activeRoute?.[activeRouteIndex + 1]
      : getNextBoardNode(getBoardNodeById(currentNodeId), branchChoice)?.id;
    if (!nextNodeId) break;

    pathNodeIds.push(nextNodeId);
    currentNodeId = nextNodeId;
    if (nextNodeId === 'n01') break;
  }

  return pathNodeIds;
}

const CENTER_ADJACENT_NODE_IDS = ['d02', 'd03', 'd06', 'd07'] as const;

export function getMovePathNodeIdsWithPrevious(startNodeId: string, steps: number, branchChoice: BranchChoice = 'outer', previousNodeId?: string) {
  if (steps > 0 && startNodeId === 'n01' && previousNodeId) return [FINISH_NODE_ID];
  if (steps >= 0 || startNodeId !== 'c01' || !previousNodeId || !CENTER_ADJACENT_NODE_IDS.includes(previousNodeId as typeof CENTER_ADJACENT_NODE_IDS[number])) {
    return getMovePathNodeIds(startNodeId, steps, branchChoice);
  }

  const pathNodeIds = [previousNodeId];
  if (Math.abs(steps) > 1) pathNodeIds.push(...getBackwardPathNodeIds(previousNodeId, Math.abs(steps) - 1));
  return pathNodeIds;
}

export function getBackwardPathNodeIds(startNodeId: string, steps: number) {
  const pathNodeIds: string[] = [];
  let currentNodeId = startNodeId;
  for (let step = 0; step < Math.max(0, steps); step += 1) {
    const routeEntry = Object.entries(SHORTCUTS).find(([, route]) => route.includes(currentNodeId));
    if (routeEntry) {
      const route = [routeEntry[0], ...routeEntry[1]];
      const previousId = route[route.indexOf(currentNodeId) - 1];
      if (!previousId) break;
      pathNodeIds.push(previousId);
      currentNodeId = previousId;
      continue;
    }
    const outerIndex = OUTER_ROUTE.indexOf(currentNodeId);
    const previousId = outerIndex > 0 ? OUTER_ROUTE[outerIndex - 1] : currentNodeId === 'n01' ? 'n20' : undefined;
    if (!previousId) break;
    pathNodeIds.push(previousId);
    currentNodeId = previousId;
  }
  return pathNodeIds;
}

const ADJACENT_BOARD_NODE_IDS: Record<string, string[]> = {
  n06: ['n05', 'n07', 'd05'],
  n11: ['n10', 'n12', 'd01'],
  c01: ['d02', 'd03', 'd06', 'd07'],
  n16: ['n15', 'n17', 'd08'],
};

export function getAdjacentBoardNodeIds(nodeId: string) {
  if (ADJACENT_BOARD_NODE_IDS[nodeId]) return [...ADJACENT_BOARD_NODE_IDS[nodeId]];
  return getNearbyNodeIds(nodeId, 1);
}

export function getNearbyNodeIds(nodeId: string, range: number) {
  const forward = getMovePathNodeIds(nodeId, range);
  const backward = getBackwardPathNodeIds(nodeId, range);
  return Array.from(new Set([...forward, ...backward]));
}

export function spawnInitialBoardItems(min = 4, max = 8): BoardItem[] {
  const count = Math.floor(Math.random() * (max - min + 1)) + min;
  const candidates = [...BOARD_NODES].filter((node) => node.id !== 'n01').sort(() => Math.random() - 0.5).slice(0, count);
  return candidates.map((node, index) => ({ id: `item-${Date.now()}-${index}`, type: getRandomItemType(), nodeId: node.id }));
}
