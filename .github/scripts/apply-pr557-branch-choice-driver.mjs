import { readFileSync, writeFileSync } from 'node:fs';

const path = 'tests/regression/bug-history-smoke.spec.js';
const source = readFileSync(path, 'utf8');
const anchor = `        lastDiagnostic = \`requiredPositions=\${requiredPositions} aiMoveSteps=\${Number.isFinite(aiMoveSteps) ? aiMoveSteps : 'unknown'} mutation=\${latestAiMoveMutationId || 'pending'} positions=\${observedPositions.join('|')} state=\${JSON.stringify(state.yutDebug ?? {}, null, 2)}\`;\n        if (state.rollButton.visible && !state.rollButton.disabled) {`;
const replacement = `        lastDiagnostic = \`requiredPositions=\${requiredPositions} aiMoveSteps=\${Number.isFinite(aiMoveSteps) ? aiMoveSteps : 'unknown'} mutation=\${latestAiMoveMutationId || 'pending'} positions=\${observedPositions.join('|')} state=\${JSON.stringify(state.yutDebug ?? {}, null, 2)}\`;\n        const branchControls = page.locator('.bottom-branch-controls');\n        if (await branchControls.isVisible().catch(() => false)) {\n          await branchControls.getByRole('button', { name: '바깥길' }).click();\n          const branchMoveButton = branchControls.locator('.branch-move-button');\n          await expect(branchMoveButton, '분기 방향 선택 후 이동 버튼이 활성화되어야 합니다.').toBeEnabled({ timeout: 2_000 });\n          await branchMoveButton.click();\n          await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {\n            timeout: 8_000,\n            message: '분기점 추가 턴의 로컬 말 이동 애니메이션이 시작되어야 합니다.',\n          }).toBeGreaterThan(0);\n          await expect.poll(async () => (await getMovingPieces()).filter((piece) => piece.isLocalOwner).length, {\n            timeout: 12_000,\n            message: '분기점 추가 턴의 로컬 말 이동 애니메이션이 종료되어야 합니다.',\n          }).toBe(0);\n          continue;\n        }\n        if (state.rollButton.visible && !state.rollButton.disabled) {`;

if (source.includes("const branchControls = page.locator('.bottom-branch-controls');")) {
  console.log('PR #557 branch-choice driver is already applied.');
  process.exit(0);
}
if (!source.includes(anchor)) throw new Error('AI movement loop anchor was not found exactly.');
writeFileSync(path, source.replace(anchor, replacement));
console.log('Applied branch-choice UI handling to the AI movement QA driver.');
