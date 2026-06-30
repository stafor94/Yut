# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and things Codex should not try again.

Use this file to prevent repeated incorrect fixes.

---

## How to update this file

When a bug fix fails or the same issue appears again, add an entry using this format:

```md
## YYYY-MM-DD - Bug title

### Symptom

- What the user observed.

### Expected behavior

- What should have happened.

### Actual behavior

- What actually happened.

### Reproduction steps

1. Step one
2. Step two
3. Step three

### Suspected root cause

- Current understanding of the cause.

### Confirmed root cause

- Fill this only when confirmed.

### Previous failed attempts

- Attempt 1:
  - What was changed:
  - Why it failed:
- Attempt 2:
  - What was changed:
  - Why it failed:

### Do not try again

- List approaches that already failed.

### Correct fix plan

- The next safer approach to try.

### Verification checklist

- [ ] Issue no longer reproduces
- [ ] Related feature still works
- [ ] No unrelated UI changes
- [ ] No console errors
- [ ] Mobile layout checked, if applicable
```

## Current entries

## 2026-06-30 - 모바일 QA 이동 버튼 hold 타이머 해제 보강

### Symptom

- Issue #124에서 PR #123 병합 후에도 iPad와 Galaxy S24 Ultra 모바일 QA가 `move-piece-button` enabled 대기 중 실패했다.
- 버튼 텍스트는 `결과 확인 중...`으로 남고 15초 timeout 동안 disabled 상태가 유지되었다.

### Expected behavior

- 윷 결과 연출 대기 시간이 지나면 이동 가능한 말이 있을 때 `move-piece-button`이 활성화되어야 한다.

### Actual behavior

- 클라이언트가 `rollResultHolding` 상태를 계속 유지해 QA 액션 루프가 다음 이동으로 진행하지 못했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. 방을 생성하고 AI를 채운 뒤 게임을 시작한다.
3. 실제 게임 상태 머신으로 액션을 진행한다.
4. iPad 또는 Galaxy S24 Ultra 프로젝트에서 `move-piece-button` enabled assertion이 실패한다.

### Suspected root cause

- 이전 수정으로 subscribe/save/authoritative roll commit 경로의 `rollResultReadyAt` 정규화는 보강되었지만, hold 해제는 여전히 `rollLockClock` interval 갱신에 의존했다.
- 모바일 QA 환경에서 interval/render 갱신이 기대대로 진행되지 않거나 raw `rollResultReadyAt`이 상태에 남으면 `rollResultHolding`이 만료 시점 이후에도 유지될 수 있었다.

### Confirmed root cause

- 코드 경로상 `rollResultReadyAt` 만료 시점에 상태를 직접 0으로 clear하는 fail-safe가 없었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `clearRoll()`에서 `rollResultReadyAt`을 0으로 초기화했다.
  - Why it failed: 이동 버튼 활성화 이전에 stale/future 값으로 hold되는 경로를 막지 못했다.
- Attempt 2:
  - What was changed: subscribe/save 및 authoritative roll commit 적용 경로에서 `rollResultReadyAt`을 정규화했다.
  - Why it failed: hold 만료 자체가 clock interval 갱신에만 의존해 모바일 QA에서 만료 상태를 안정적으로 state에 반영하지 못할 수 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 테스트에서 허용하거나 강제 클릭하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `clearRoll()` 초기화만 반복하지 않는다.

### Correct fix plan

- `rollResultReadyAt` effect에서 정규화된 ready time을 기준으로 동작한다.
- 정규화 결과가 무효이면 상태를 0으로 정리한다.
- 유효한 ready time은 기존 interval clock 갱신을 유지하면서 만료 시점 timeout으로 `rollResultReadyAt`을 0으로 clear한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

## 2026-06-30 - 모바일 QA authoritative rollResultReadyAt 정규화 누락

### Symptom

- Issue #122에서 iPad 모바일 QA가 `move-piece-button` enabled 대기 중 실패했다.
- 버튼 텍스트는 `결과 확인 중...`으로 남고 15초 timeout 동안 disabled 상태가 유지되었다.

### Expected behavior

- 윷 결과 연출 대기 시간이 지나면 이동 가능한 말이 있을 때 `move-piece-button`이 활성화되어야 한다.

### Actual behavior

- 클라이언트가 `rollResultHolding` 상태를 계속 유지해 QA 액션 루프가 다음 이동으로 진행하지 못했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. 방을 생성하고 AI를 채운 뒤 게임을 시작한다.
3. 실제 게임 상태 머신으로 액션을 진행한다.
4. iPad 프로젝트에서 `move-piece-button` enabled assertion이 실패한다.

### Suspected root cause

- `subscribeGameState()`와 host snapshot 저장 경로는 `rollResultReadyAt`을 정규화하지만, host가 authoritative roll commit 결과를 즉시 적용하는 경로에서는 `result.patch.rollResultReadyAt`을 그대로 `setRollResultReadyAt()`에 전달했다.
- 이 경로로 stale/future 값이 들어오면 `rollResultHolding`이 계속 true로 계산될 수 있었다.

### Confirmed root cause

- 코드 경로상 authoritative roll commit 결과 적용부가 `normalizeRollResultReadyAt()`을 거치지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `clearRoll()`에서 `rollResultReadyAt`을 0으로 초기화했다.
  - Why it failed: 이동 버튼 활성화 이전에 stale/future 값으로 hold되는 경로를 막지 못했다.
- Attempt 2:
  - What was changed: subscribe 적용 및 저장 단계에서 `rollResultReadyAt`을 정규화했다.
  - Why it failed: host의 authoritative roll commit 즉시 적용 경로가 정규화 대상에서 빠져 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 테스트에서 허용하거나 강제 클릭하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.

### Correct fix plan

- authoritative roll commit 결과를 로컬 상태에 적용할 때도 `rollResultReadyAt`을 `normalizeRollResultReadyAt()`으로 정규화한다.
- 별도 UI 변경 없이 기존 subscribe/save 정규화 정책과 동일하게 맞춘다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

## 2026-06-30 - 모바일 QA 게임 진행/대기실 버튼 재발

### Symptom

- iPad QA에서 `move-piece-button`이 `결과 확인 중...` disabled 상태로 15초 이상 유지된다.
- Galaxy S24 Ultra QA에서 AI 추가 후 `start-game-button`이 보이지 않는다.

### Expected behavior

- 윷 결과 연출 대기 시간이 지나면 이동 가능한 말이 있을 때 `move-piece-button`이 활성화되어야 한다.
- 방장이 AI를 모두 채운 뒤에는 `start-game-button`이 보이고 활성화되어야 한다.

### Actual behavior

- 이동 버튼이 `rollResultHolding` 상태에 묶여 QA 루프가 다음 액션으로 진행하지 못했다.
- 일부 모바일 프로젝트에서 방장 시작 버튼이 렌더링되지 않아 대기실 단계가 실패했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. 방을 생성하고 AI를 추가한다.
3. 게임을 시작한 뒤 QA 자동 액션 루프를 진행한다.
4. 특정 모바일 프로젝트에서 시작 버튼 또는 이동 버튼 assertion이 실패한다.

### Suspected root cause

- `rollResultReadyAt`이 과거값이 되었거나 stale sync 값이 되었는데도 클라이언트가 결과 대기 상태로 해석하는 경로가 있었다.
- 방장 대기실에서는 `canManageRoom`, `currentUserId`, `hostSeatId`, seats snapshot의 순간 불일치가 시작 버튼 미노출로 이어질 수 있었다.

### Confirmed root cause

- 이전 수정은 `clearRoll()`에서만 `rollResultReadyAt`을 0으로 초기화했다. 그러나 재발 실패는 말 이동 후 `clearRoll()`에 도달하기 전에 이동 버튼이 비활성화된 상태라 해당 수정만으로는 충분하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `clearRoll()`에서 `setRollResultReadyAt(0)`을 호출했다.
  - Why it failed: 이동 이후 초기화 경로만 보강했기 때문에, 이동 버튼 활성화 이전에 stale/future `rollResultReadyAt`으로 막히는 상황을 해결하지 못했다.
- Attempt 2:
  - What was changed: AI 추가 후 버튼 hidden 확인과 시작 버튼 visible/enabled 대기를 강화했다.
  - Why it failed: 시작 버튼이 단순히 늦게 활성화되는 문제가 아니라 방장 UI 렌더링 조건이 일시적으로 깨질 수 있는 문제를 직접 관측하지 못했다.

### Do not try again

- `clearRoll()` 초기화만 추가 반복하지 않는다.
- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 테스트에서 허용하거나 강제 클릭하지 않는다.
- 시작 버튼 selector 대기만 늘리지 않는다.
- 원인 확인 없이 UI 구조나 레이아웃을 변경하지 않는다.

### Correct fix plan

- stale `rollResultReadyAt`을 subscribe 적용 및 저장 단계에서 과거값이면 0으로 정규화한다.
- QA 실패 메시지에 `rollResultReadyAt`, `rollResultHolding`, `canRequestMove`, `canManageRoom`, seats 등 실제 상태를 포함한다.
- host snapshot 저장은 마지막으로 적용된 sequence를 기준으로 stale write를 줄인다.

### Verification checklist

- [ ] Issue no longer reproduces
- [ ] Related feature still works
- [ ] No unrelated UI changes
- [ ] No console errors
- [ ] Mobile layout checked, if applicable


## 2026-06-30 - 모바일 QA 이동 버튼 rollResultReadyAt stale future 재발

### Symptom

- Issue #120에서 iPad와 Galaxy S24 Ultra 모바일 QA가 `move-piece-button` enabled 대기 중 실패했다.
- 버튼 텍스트는 `결과 확인 중...`으로 남고 15초 timeout 동안 disabled 상태가 유지되었다.

### Expected behavior

- 윷 결과 연출 대기 시간 이후 이동 가능한 말이 있으면 `move-piece-button`이 활성화되어야 한다.

### Actual behavior

- 클라이언트가 `rollResultHolding` 상태를 계속 유지해 QA 액션 루프가 다음 이동으로 진행하지 못했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. 방을 생성하고 AI를 채운 뒤 게임을 시작한다.
3. 실제 게임 상태 머신으로 액션을 진행한다.
4. 특정 모바일 프로젝트에서 `move-piece-button` enabled assertion이 실패한다.

### Suspected root cause

- `rollResultReadyAt`이 과거값이면 0으로 정규화되지만, 비정상적으로 먼 미래값은 그대로 적용/저장될 수 있었다.
- stale future `rollResultReadyAt`이 subscribe 또는 host snapshot 저장 경로에서 재적용되면 `rollResultHolding`이 계속 true로 계산된다.

### Confirmed root cause

- 코드 경로상 `rollResultReadyAt > Date.now()` 조건만 사용해 future 값의 상한을 검증하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `clearRoll()`에서 `rollResultReadyAt`을 0으로 초기화했다.
  - Why it failed: 이동 버튼 활성화 이전에 stale/future 값으로 hold되는 경로를 막지 못했다.
- Attempt 2:
  - What was changed: 테스트 대기와 시작 버튼 확인을 강화했다.
  - Why it failed: 이동 버튼의 hold 상태 계산 원인을 직접 차단하지 못했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 테스트에서 허용하거나 강제 클릭하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.

### Correct fix plan

- `rollResultReadyAt`을 클라이언트 적용 및 저장 단계에서 허용 가능한 윷 결과 연출 시간 범위로 정규화한다.
- 과거값 또는 비정상적으로 먼 미래값은 0으로 저장/적용해 stale hold를 제거한다.

### Verification checklist

- [x] Build succeeds
- [x] No unrelated UI changes
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

---

## Completion requirements

After creating the two files, provide a final response with this exact structure:

### Root cause

No application bug was modified. This task adds repository-level Codex operating rules.

### Files changed

- AGENTS.md
- BUG_HISTORY.md

### Change summary

Added Codex workflow rules and repeated bug tracking documentation.

### Verification result

Confirmed only documentation files were added and no application code was changed.

### Remaining risks

Future Codex tasks must actually follow these files; the rules reduce repeated mistakes but do not guarantee perfect fixes.
