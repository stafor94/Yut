import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe('완주 한 칸 이동 애니메이션 회귀', () => {
  test('공통 완주 경로가 authoritative payload와 원격 재생 경로에 연결된다', () => {
    const boardSource = readFileSync('src/game-core/board/board.ts', 'utf8');
    const engineSource = readFileSync('src/game-core/gameEngineCore.ts', 'utf8');
    const appSource = readFileSync('src/app/App.tsx', 'utf8');

    expect(boardSource).toMatch(/const pathNodeIds = getMovePathNodeIds\(startNodeId, steps, branchChoice\);[\s\S]*?pathNodeIds\[pathNodeIds\.length - 1\] === 'n01'[\s\S]*?pathNodeIds\.length < steps[\s\S]*?\[\.\.\.pathNodeIds, FINISH_NODE_ID\]/);
    expect(boardSource).toMatch(/const forward = getMovePathNodeIds\(nodeId, range\)/);
    expect(engineSource).toMatch(/pathNodeIds:\s*movePathNodeIds/);
    expect(appSource).toMatch(/const pathNodeIds = Array\.isArray\(payload\.pathNodeIds\)[\s\S]*?for \(const nextNodeId of pathNodeIds\)/);
    expect(appSource).toMatch(/started: nextNodeId !== 'finish', finished: nextNodeId === 'finish'/);
    expect(appSource).toMatch(/const movePathNodeIds = getMovePathNodeIdsWithPrevious\([\s\S]*?for \(const nextNodeId of movePathNodeIds\)/);
  });
});
