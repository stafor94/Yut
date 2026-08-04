# AGENTS.md

## Project operating rules

This repository is managed with Codex-assisted development.

## Mandatory first read

Before planning, investigating, editing, creating a PR, or handling Actions, read [`DEVELOPMENT_PLAYBOOK.md`](./DEVELOPMENT_PLAYBOOK.md) in full.

This applies equally to plans written in Work and changes executed in Chat/Codex. The playbook defines the start gate, scope limits, verification map, GitHub/Actions restrictions, forced stop conditions, and merge-completion criteria. Also read `BUG_HISTORY.md` and any area-specific documentation required by the playbook.

Do not proceed from remembered or copied instructions when the repository files can be read. Re-read the current versions at the start of every task and after a session interruption.

Codex must act as a careful patch generator, not as an autonomous product owner.

The highest priority is to avoid repeated failed fixes, unrelated changes, and speculative refactoring.

---

## Request interpretation and execution discipline

The current user message takes priority over earlier conversation context. Classify the current message before using tools or modifying the repository.

- A complaint, retrospective, question, explanation request, or documentation request is not permission to resume an earlier code, PR, merge, or Actions task.
- Do not run repository mutations merely because an earlier task remains unfinished. Resume it only when the current message explicitly asks for that work.
- Preserve approvals already given for the same scope. Do not ask for the same plan, implementation, push, review, or merge approval again unless the scope materially expands or a forced stop condition is reached.
- After a tool or command fails, identify whether the cause is authentication, input, missing resource, unsupported capability, transient infrastructure, or a real product/CI failure before changing tools.
- Do not repeat the same lookup through multiple tools without a specific missing datum. Reuse confirmed repository, branch, PR, SHA, Run, and issue identifiers.
- Do not report that another approach will be tried unless it is immediately executed and produces a concrete result. Report results, not intentions.
- Do not create extra branches, PRs, Issues, workflows, commits, or Runs to work around an information-access problem.
- For documentation-only work, keep the change and verification documentation-only. Do not add or modify product code, tests, dependencies, fixtures, or workflows unless the user separately approves that expanded scope.

When the user explicitly waives automated tests for a documentation-only change, manual review of the final Markdown diff, links, contradictions, and changed-file scope is the verification. Record automated checks as not run by request; do not invent replacement product QA.

---

## Standard workflow

For every task:

1. Read the user's request carefully.
2. Identify the task type: bug fix, feature implementation, UI adjustment, refactor, documentation, or investigation only.
3. Read all directly relevant files before editing.
4. Do not modify files until the root cause or implementation target is clear.
5. Make the smallest safe change possible and avoid unrelated changes.
6. Verify the result using available commands or manual reasoning.
7. Report exactly what changed and how it was verified.

---

## Bug fix workflow

For bug fixes:

1. Reproduce or clearly describe the reported issue.
2. Identify and explain the root cause.
3. Check `BUG_HISTORY.md` for previous failed attempts related to the same issue.
4. Make the minimum necessary code change.
5. Do not change unrelated UI, layout, styling, naming, file structure, or behavior.
6. Verify the fix.
7. Report the root cause, files changed, change summary, verification result, and remaining risks.

If the same bug has already failed to be fixed two times:

1. Stop making code changes.
2. Re-read the relevant files.
3. Re-check `BUG_HISTORY.md`.
4. Identify why previous fixes failed.
5. Propose a new fix plan.
6. Wait for approval before editing code.

---

## Strict change limits

Do not do any of the following unless explicitly requested:

- Do not redesign the UI.
- Do not rewrite large parts of the code.
- Do not rename files, functions, variables, CSS classes, or IDs.
- Do not remove existing features.
- Do not change unrelated behavior.
- Do not introduce new dependencies.
- Do not perform broad refactoring.
- Do not make speculative improvements.
- Do not claim the issue is fixed without verification.

---

## Mobile / responsive UI checks

For mobile, portrait, viewport, or responsive layout issues, check these before changing spacing values or component CSS:

- Whether `index.html` has a viewport meta tag.
- Which media query should apply to the reported device or screenshot.
- Whether the issue is caused by a missing CSS rule, a rule not matching, a later override, or a deployed bundle/cache mismatch.
- Whether build verification and browser/manual viewport reasoning support the claimed fix.

Do not claim a mobile UI issue is resolved unless build verification and browser/manual viewport reasoning are reported.

---

## Verification rules

Before final response, run available checks whenever possible.

Preferred verification order:

1. Automated test command, if available.
2. Build command, if available.
3. Lint or static check, if available.
4. Manual code-path inspection, if no command exists.

If no automated test exists, clearly say so and explain what was manually verified.

Never write "fixed" unless verification was performed.

---

## Final response format

When code or documentation files were changed, the final response must include only these sections:

### Root cause

Explain the actual cause briefly.

### Files changed

List changed files.

### Change summary

Explain the minimal change that was made.

### Verification result

List the command that was run or explain manual verification.

### Remaining risks

Mention anything that could still fail or needs manual browser testing.

For investigation-only, planning, or question-answering tasks with no file changes, use a natural Markdown format that fits the request. Still cite referenced files and terminal commands when relevant.

---

## Merge rule

A pull request must not be merged unless the final response includes a clear verification result.

If verification was not possible, the final response must explicitly say:

"Verification was not possible because: ..."

---

## PR 및 GitHub Actions 운영 규칙

PR 생성, 병합, Actions 확인과 실패 처리는 `DEVELOPMENT_PLAYBOOK.md`를 따른다.

- 기본 PR은 Draft로 생성하고 병합 기준 충족 후 ready로 전환한다.
- 기존 workflow와 branch event만 사용하며 workflow 변경은 사용자 승인이 필요하다.
- 임시 workflow, inspector/integration PR, 상태 출력용 Issue와 빈 커밋을 만들지 않는다.
- 실행 중인 Run을 불필요한 후속 push로 취소하지 않는다.
- 동일 오류 2회, fix cycle 2회 실패, 범위 확대 또는 별도 검증 인프라 필요 시 교본의 강제 중단선을 적용한다.
- 병합 후 해당 merge commit의 Main Branch QA `completed/success`를 직접 확인한다.
