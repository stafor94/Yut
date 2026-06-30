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

## 2026-06-30 - Issue #130 모바일 QA 이동 버튼 자동 진행 경합

### Symptom

- PR #129 병합 후 Galaxy S24 Ultra QA에서 `move-piece-button` enabled 대기 assertion이 실패했다.
- 최종 debug state의 `moveButton`은 `{ visible: false, disabled: false }`로, 버튼이 disabled로 고착된 이전 증상과 달리 버튼 자체가 사라진 상태였다.

### Expected behavior

- 이동 버튼이 보이면 활성화된 버튼을 클릭하거나, 자동 단일 말 이동으로 이미 다음 상태에 진입한 경우 QA 루프가 진행을 계속해야 한다.

### Actual behavior

- 테스트가 `move-piece-button`을 한 번 관측한 뒤 15초 동안 계속 visible/enabled 상태만 허용해, 자동 이동으로 `roll`이 clear되고 버튼 test id가 바뀐 상태를 실패로 처리했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. Galaxy S24 Ultra 프로젝트에서 AI를 채우고 게임을 시작한다.
3. 실제 게임 상태 머신으로 액션 루프를 진행한다.
4. `move-piece-button` visible 확인 직후 자동 이동 또는 턴 전환으로 버튼이 사라지면 enabled 대기 assertion이 실패한다.

### Suspected root cause

- 앱에는 이동 가능한 말 그룹이 하나뿐이고 갈림길 선택이 필요 없을 때 자동 이동하는 경로가 있다.
- QA 테스트는 이 정상 진행 경합을 고려하지 않고 `move-piece-button`이 계속 visible이어야 한다고 고정 기대했다.

### Confirmed root cause

- 코드 경로상 `playOneAvailableGameAction()`은 `move-piece-button`이 최초 visible이면 이후에도 visible/enabled만 성공으로 인정했다.
- 그러나 앱의 자동 단일 말 이동 effect는 `rollResultHolding`이 끝난 뒤 `movePiece()`를 호출하고 `clearRoll()`로 버튼을 제거할 수 있다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `rollResultReadyAt` stale/future/timeout clear 경로를 보강했다.
  - Why it failed: Issue #130의 최종 상태는 hold 고착이 아니라 버튼 부재 상태였으므로 같은 수정으로는 테스트 경합을 해결하지 못한다.
- Attempt 2:
  - What was changed: 이동 버튼 visible/enabled assertion을 강화했다.
  - Why it failed: 자동 이동으로 버튼이 사라지는 정상 진행 상태까지 실패로 처리했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 성공으로 허용하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `rollResultReadyAt`만 반복 수정하지 않는다.
- 자동 단일 말 이동 앱 로직을 원인 확인 없이 제거하지 않는다.

### Correct fix plan

- `move-piece-button`이 보인 뒤 활성화되면 기존처럼 클릭한다.
- 폴링 중 버튼이 사라졌고 debug state상 `roll`이 `null`, `rollResultHolding`이 `false`이면 자동 진행으로 간주해 QA 루프를 계속한다.
- 버튼이 여전히 보이지만 disabled로 남는 경우는 기존처럼 실패시킨다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

## 2026-06-30 - Issue #128 모바일 QA 방장 권한 불일치 재발

### Symptom

- Galaxy S24 Ultra 단일 모바일 QA에서 AI 추가 후 `start-game-button`이 보이지 않았다.
- 실패 시 debug state는 `screen: "waitingRoom"`이지만 `isRoomHost: false`, `canManageRoom: false`였고, `currentUserId`와 `hostSeatId`가 서로 달랐다.
- iPad QA에서는 `move-piece-button` enabled 대기 중 최종 debug state에서 이동 버튼이 보이지 않는 상태가 관측되었다.
- iPad 기기전 QA에서는 Firestore transient console error가 허용치보다 많이 발생했다.

### Expected behavior

- 방 생성 직후 host 클라이언트는 동일한 host uid로 대기실에 진입하고 `start-game-button`을 볼 수 있어야 한다.
- 윷 결과 이후 이동 가능한 상태에서는 `move-piece-button`이 안정적으로 보이고 활성화되어야 한다.
- QA 중 반복 Firestore transaction 경합이 사용자 진행을 막지 않아야 한다.

### Actual behavior

- 방 생성 직후 로컬 현재 사용자 uid와 방/seat의 host uid가 불일치해 host-only UI가 일반 플레이어 UI로 바뀌었다.
- 일부 모바일 QA에서 이동 버튼 또는 Firestore transaction 경합 증상이 이어졌다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. Galaxy S24 Ultra 단일 모바일 경로에서 방을 생성하고 AI를 채운다.
3. 시작 버튼 visible/enabled assertion을 기다린다.
4. iPad 단일/기기전 경로에서 한 턴 진행 및 콘솔 에러 검사를 수행한다.

### Suspected root cause

- `handleCreateRoom()`이 확보한 `roomHost` uid로 Firestore 방을 만들지만, `openWaitingRoom()`은 다시 `userRef.current ?? currentUser`를 읽어 대기실 host seat를 구성한다.
- 모바일 QA 타이밍에서 auth/current user 참조가 바뀌거나 아직 안정화되지 않으면 Firestore `room.hostId`/seat host uid와 로컬 `currentUserId`가 달라져 `canManageRoom`이 false가 된다.
- 이동 버튼과 Firestore 경합은 같은 모바일 QA 계열의 상태 동기화 재발 가능성이 있으나, Issue #128 로그상 시작 버튼 미노출은 host uid 불일치가 직접 원인으로 보인다.

### Confirmed root cause

- 시작 버튼 미노출 경로는 host uid 불일치로 확인했다. 이동 버튼 visible false 및 Firestore transient error 증상은 추가 QA 재실행으로 재확인이 필요하다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 방 생성/대기실/이동 버튼 실패 시 debug state를 보강했다.
  - Why it failed: 진단 정보는 늘었지만 host uid 불일치 자체는 막지 못했다.
- Attempt 2:
  - What was changed: `rollResultReadyAt` stale/future/timeout clear 경로를 여러 차례 보강했다.
  - Why it failed: Issue #128의 Galaxy 시작 버튼 미노출은 roll hold가 아니라 대기실 host 권한 불일치 문제였다.

### Do not try again

- 시작 버튼 selector 대기 시간만 늘리지 않는다.
- 테스트에서 일반 플레이어 화면을 host 성공으로 허용하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `rollResultReadyAt`만 반복 수정하지 않는다.

### Correct fix plan

- 방 생성에 사용한 `roomHost`를 host 대기실 진입에도 명시적으로 전달한다.
- host 대기실 진입 시 같은 uid를 `rememberUser()`와 host seat 구성에 사용한다.
- room subscribe에서 current user가 일시적으로 비어 있어도 방 생성에 사용한 host uid fallback으로 host 판정을 유지한다.
- 방을 떠나거나 종료/복구 실패 시 host uid fallback을 정리한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

## 2026-06-30 - Issue #126 모바일 QA 대기실 진입 및 이동 버튼 재발 조사

### Symptom

- PR #125 병합 후 Issue #126에서 모바일 QA가 다시 실패했다.
- iPad 기기전 QA는 방 생성 버튼 클릭 후 `waiting-room` visible 대기에서 timeout이 발생했다.
- Galaxy S24 Ultra QA는 `move-piece-button`이 `결과 확인 중...` disabled 상태로 남아 enabled 대기에서 timeout이 발생했다.

### Expected behavior

- 방 생성 후 host는 대기실로 이동해야 한다.
- 윷 결과 연출 대기 시간이 지나면 이동 가능한 말이 있을 때 `move-piece-button`이 활성화되어야 한다.

### Actual behavior

- iPad host 화면은 대기실 진입 여부를 확인하지 못한 채 timeout이 발생했다.
- Galaxy S24 Ultra 화면은 이동 버튼이 결과 hold 상태로 남아 QA 액션 루프가 다음 이동으로 진행하지 못했다.

### Reproduction steps

1. 모바일 QA 테스트를 실행한다.
2. iPad 기기전 경로에서 방을 생성한다.
3. Galaxy S24 Ultra 단일 모바일 QA 경로에서 AI를 채우고 게임을 시작한다.
4. 대기실 visible 또는 이동 버튼 enabled assertion이 실패한다.

### Suspected root cause

- 대기실 실패는 방 생성/인증/중복 방 정리/openWaitingRoom 상태 전환 중 어떤 단계에서 lobby에 머물렀는지 실패 로그가 부족해 구분이 어려웠다.
- 이동 버튼 실패는 이전 `rollResultReadyAt` 보강 이후에도 특정 모바일 QA 타이밍에서 hold 상태가 재발했지만, enabled timeout 시점의 `rollResultReadyAt`, `rollResultHolding`, `canRequestMove`, 선택 말 상태가 assertion 결과에 충분히 남지 않았다.

### Confirmed root cause

- 아직 미확정. 이번 변경은 반복 실패 원인을 확정하기 위한 QA 진단 정보 보강이다.

### Previous failed attempts

- Attempt 1:
  - What was changed: `clearRoll()`에서 `rollResultReadyAt`을 0으로 초기화했다.
  - Why it failed: 이동 버튼 활성화 이전에 stale/future 값으로 hold되는 경로를 막지 못했다.
- Attempt 2:
  - What was changed: subscribe/save/authoritative roll commit 및 timeout clear 경로를 보강했다.
  - Why it failed: Issue #126에서 모바일 QA 이동 버튼 hold 증상이 다시 관측되었고, 실패 시점의 실제 상태를 더 구체적으로 확인해야 한다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled 이동 버튼을 테스트에서 허용하거나 강제 클릭하지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `clearRoll()` 초기화만 반복하지 않는다.
- 원인 확인 없이 방 생성 또는 게임 상태 흐름을 넓게 리팩터링하지 않는다.

### Correct fix plan

- iPad 방 생성 후 대기실 진입 assertion에 lobby notice, create button 상태, waiting-room 표시 여부, matching room card, `__YUT_DEBUG_STATE__`를 포함한다.
- `move-piece-button` enabled 대기는 최종 timeout 출력에 `collectGameDebugState()` 전체가 남도록 poll assertion으로 바꾼다.
- 다음 재현 로그에서 실제 원인이 확인된 뒤 앱 로직만 최소 수정한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No console errors in mobile browser QA

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
