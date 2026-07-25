import { qaPerformanceBudget } from './performance-budget.mjs';
import { qaSuiteNames } from './suite-manifest.mjs';

const failures = [];
const workflowBudget = qaPerformanceBudget.workflow;

if (!Number.isFinite(workflowBudget?.targetSeconds) || workflowBudget.targetSeconds <= 0) {
  failures.push('workflow targetSeconds는 양수여야 합니다.');
}
if (!Number.isFinite(workflowBudget?.hardLimitSeconds) || workflowBudget.hardLimitSeconds < workflowBudget.targetSeconds) {
  failures.push('workflow hardLimitSeconds는 targetSeconds 이상이어야 합니다.');
}

const budgetLaneNames = Object.keys(qaPerformanceBudget.lanes ?? {});
for (const suiteName of qaSuiteNames) {
  const targetSeconds = qaPerformanceBudget.lanes?.[suiteName]?.targetSeconds;
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    failures.push(`${suiteName}: 양수인 lane targetSeconds가 필요합니다.`);
  }
}
for (const laneName of budgetLaneNames) {
  if (!qaSuiteNames.includes(laneName)) failures.push(`manifest에 없는 성능 예산 lane입니다: ${laneName}`);
}

if (failures.length > 0) {
  console.error(`QA performance budget validation failed (${failures.length})`);
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

console.log(`QA performance budget validation passed: workflow=${workflowBudget.targetSeconds}s/${workflowBudget.hardLimitSeconds}s, lanes=${qaSuiteNames.length}`);
