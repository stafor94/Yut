import { test, expect } from '@playwright/test';
import { expectHardAiStackedStrategyContract } from '../helpers/ai-stacked-strategy-contract.js';

test('Galaxy viewport에서도 어려움 AI 누적 이동 플래너 계약이 유지된다', async ({ page }) => {
  await expectHardAiStackedStrategyContract(page, expect);
});
