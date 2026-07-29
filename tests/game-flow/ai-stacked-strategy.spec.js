import { test, expect } from '@playwright/test';
import { expectHardAiStackedStrategyContract } from '../helpers/ai-stacked-strategy-contract.js';

test('어려움 AI는 누적 [도, 개]에서 개로 n06 도착 후 도로 지름길에 진입한다', async ({ page }) => {
  await expectHardAiStackedStrategyContract(page, expect);
});
