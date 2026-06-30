# AGENTS.md

## Project operating rules

This repository is managed with Codex-assisted development.

Codex must act as a careful patch generator, not as an autonomous product owner.

The highest priority is to avoid repeated failed fixes, unrelated changes, and speculative refactoring.

---

## Mandatory workflow for every task

For every task, follow this workflow:

1. Read the user's request carefully.
2. Identify whether the task is:
   - bug fix
   - feature implementation
   - UI adjustment
   - refactor
   - documentation
   - investigation only
3. Read all directly relevant files before editing.
4. Do not modify files until the root cause or implementation target is clear.
5. Make the smallest safe change possible.
6. Avoid unrelated changes.
7. Verify the result using available commands or manual reasoning.
8. Report exactly what was changed and how it was verified.

---

## Bug fix rules

For bug fixes, always follow this sequence:

1. Reproduce or clearly describe the reported issue.
2. Identify the exact root cause.
3. Check BUG_HISTORY.md for previous failed attempts related to the same issue.
4. Explain why the issue happens.
5. Make the minimum necessary code change.
6. Do not change unrelated UI, layout, styling, naming, file structure, or behavior.
7. Verify the fix.
8. Report:
   - root cause
   - files changed
   - change summary
   - verification result
   - remaining risks

If the same bug has already failed to be fixed two times, do not attempt another code change immediately.
Instead, perform investigation only and update the root-cause analysis.

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

Every final response must include only the following sections:

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

---

## Merge rule

A pull request must not be merged unless the final response includes a clear verification result.

If verification was not possible, the final response must explicitly say:

"Verification was not possible because: ..."

---

## Repeated failure rule

If the same issue fails twice:

1. Stop making code changes.
2. Re-read the relevant files.
3. Re-check BUG_HISTORY.md.
4. Identify why previous fixes failed.
5. Propose a new fix plan.
6. Wait for approval before editing code.
