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

## 2026-07-01 - Issue #230 반복 윷 던지기/기기전 실패 진단 경로 고정

### Symptom

- Issue #230을 포함해 모바일 Game QA와 모바일 기기전 QA에서 윷 던지기, 말 이동, 원격 액션 대기, stale local state 계열 실패가 반복됐다.
- 사용자는 같은 계열 이슈가 계속 이어져 앞으로도 해결되지 않을 것 같다고 보고했다.

### Expected behavior

- 사용자가 윷 던지기 또는 말 이동을 요청했는데 guard, pending action, authoritative rejection 때문에 진행할 수 없다면, 그 이유가 사용자 메시지와 QA debug state에 같은 형태로 남아야 한다.
- 다음 실패는 추정성 패치가 아니라 마지막 액션의 type/message/reason을 기준으로 하나의 깨진 불변식만 추적할 수 있어야 한다.

### Actual behavior

- roll/move guard와 authoritative rejection은 일부 메시지를 표시했지만, QA가 일관되게 수집할 수 있는 마지막 액션 진단 값은 없었다.
- 실패 시점의 `message`, dialog text, blocker 배열이 서로 분리되어 같은 증상을 다시 단일 원인으로 오판할 위험이 남아 있었다.

### Suspected root cause

- 온라인 상태 전환 자체가 여러 race를 포함하지만, 반복을 키운 직접 원인은 실패 reason을 하나의 진단 경로로 고정하지 못한 점이다.

### Confirmed root cause

- 앱 debug state에는 guard 배열이 있었지만 마지막으로 거부/실패한 액션의 type, 사용자 표시 메시지, reason 배열이 함께 보존되지 않았다.
- QA failure summary도 액션 오류 dialog와 마지막 액션 진단 값을 요약에 포함하지 않아, 다음 실패 분석이 다시 로그 추정에 의존할 수 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 개별 stale lock, host 판정, autosave pending, QA timeout/race 분류를 각각 수정했다.
  - Why it failed: 각 수정은 해당 blocker만 줄였고, 다음 blocker가 발생했을 때 동일한 진단 경로로 원인을 고정하지 못했다.

### Do not try again

- 버튼 disabled 조건만 완화하지 않는다.
- 원인 확인 없이 원격 action timeout이나 Playwright timeout만 늘리지 않는다.
- 실패 reason을 debug state에 남기지 않은 채 또 다른 상태 전이 패치를 하지 않는다.

### Correct fix plan

- roll/move 요청이 guard 또는 pending 중복으로 막히면 공통 진단 helper를 통해 사용자 메시지, 오류 dialog, 마지막 액션 진단 값을 동시에 기록한다.
- authoritative reject/catch 경로도 같은 마지막 액션 진단 값으로 남긴다.
- QA debug 수집과 failure summary에 액션 오류 dialog 및 마지막 액션 진단 값을 포함한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile device-to-device QA rerun checked
- [x] No unrelated UI redesign
- [x] No new dependency

## 2026-07-01 - Issue #228 모바일 Game QA 이동 버튼 대기 및 기기전 대기실 잔류

### Symptom

- 모바일 Game QA가 `05 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 `move-piece-button` 활성화 대기 timeout으로 실패했다.
- 모바일 기기전 QA가 `기기전 07 양쪽 게임 화면 준비 확인` 단계에서 Galaxy 페이지가 `waitingRoom`에 남아 timeout으로 실패했다.
- 기기전 실패 debug state에는 `pieces`, `turnOrderIds`, `lastAppliedStateVersion`, `lastAppliedSequence`, `canRollNow`가 이미 존재해 게임 상태 구독은 완료된 상태였다.

### Expected behavior

- 윷 결과가 있고 현재 턴 플레이어가 이동 가능한 말이 있으면, 이전 선택 말이 stale이어도 이동 버튼 guard가 현재 턴의 이동 가능한 말로 보정되어야 한다.
- 온라인 기기전에서 초기 게임 상태가 구독되면 room status snapshot 반영이 늦어도 게임 화면으로 진입해야 한다.

### Actual behavior

- `selectedPieceId`가 이전/다른 플레이어 말인 상태에서는 `selectedPiece`가 없거나 현재 턴 플레이어가 제어할 수 없어 `canMoveSelectedPiece`와 `canRequestMove`가 false가 됐다.
- `moveSelectedPiece()`에는 fallback movable piece 이동 경로가 있었지만, 버튼이 disabled 상태라 QA와 사용자가 그 클릭 경로에 진입하지 못했다.
- `subscribeGameState()`는 state 문서를 받아 로컬 게임 상태를 적용했지만, 화면 전환은 room 문서 `status === 'playing'`을 받는 `subscribeRoom()` 경로에 의존했다.

### Suspected root cause

- 선택 말 보정이 클릭 핸들러 내부에만 있어 disabled 계산보다 늦게 실행됐다.
- 초기 state/current 저장과 room status `playing` 업데이트가 별도 비동기 경로라서, 기기전 한쪽 클라이언트가 state는 받았지만 room status snapshot은 늦게 받는 순간이 있었다.

### Confirmed root cause

- `canRequestMove`는 stale `selectedPieceId`를 fallback으로 보정하지 않고 `canMoveSelectedPiece`를 계산했다.
- `subscribeGameState()`는 유효한 게임 state를 받아도 `screen`을 `game`으로 바꾸지 않아, `subscribeRoom()`의 status 업데이트가 지연되면 대기실에 남았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #220에서 이동 버튼 클릭 race와 기기전 조작 페이지 선택을 QA helper에서 일부 보강했다.
  - Why it failed: 클릭 직전/후 race는 분류했지만, 버튼 disabled 원인인 stale selected piece를 앱 상태에서 선제 보정하지 못했다.
- Attempt 2:
  - What was changed: Issue #224에서 게임 화면 준비 실패 시 debug state를 수집하도록 QA assertion을 보강했다.
  - Why it failed: 진단 정보만 늘렸고, state 구독 완료 후 room status 지연으로 화면이 대기실에 남는 앱 경로는 보정하지 않았다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- 이동 버튼 disabled 조건만 임의로 완화하지 않는다.
- 게임 상태가 이미 구독된 기기전 실패를 단순 room list/로비 문제로 보지 않는다.
- UI 레이아웃이나 컴포넌트 구조를 바꾸지 않는다.

### Correct fix plan

- 윷 결과가 있고 현재 턴이면, 선택 말이 이동 불가능할 때 현재 턴 플레이어가 이동 가능한 fallback piece로 `selectedPieceId`를 먼저 보정한다.
- `subscribeGameState()`에서 유효한 게임 state(`pieces`, `turnOrderIds`)를 받았고 현재 화면이 대기실이면 `screen`을 `game`으로 전환해 room status snapshot 지연을 보완한다.
- 기존 `moveSelectedPiece()` fallback 경로와 authoritative action 처리는 그대로 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [ ] Mobile device-to-device QA rerun checked
- [x] No unrelated UI changes
- [x] No new dependency

## 2026-07-01 - Issue #226 모바일 기기전 QA roll no-state-change 오분류

### Symptom

- Issue #226에서 모바일 기기전 QA가 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 실패했다.
- 선택된 Galaxy 페이지는 `canRollNow: true`이고 blocker가 없었지만, 윷 던지기 클릭 후 QA는 `no-state-change`로 실패했다.

### Expected behavior

- 기기전 QA는 실제 클릭한 기기의 debug state를 우선으로 클릭 전후 상태 변화를 비교해야 한다.
- 원격 액션 pending을 한 번이라도 관측했다면, 로컬 watchdog이 pending 표시를 지운 뒤에도 이를 단순 `no-state-change`로 분류하지 않아야 한다.

### Actual behavior

- `waitForRollOutcomeAfterClick()`은 전체 pages 배열을 받지만 state advance/auto advance 판정에서 첫 번째 game page를 canonical state로 사용했다.
- 기기전에서 실제 조작한 페이지가 두 번째 페이지이면 클릭 페이지의 sequence/version 변화가 canonical 비교에서 우선 반영되지 않았다.
- 또한 pending을 관측했더라도 마지막 poll에서 pending이 사라져 있으면 `pending-timeout`이 아니라 `no-state-change`로 떨어질 수 있었다.

### Suspected root cause

- 기기전 QA helper가 실제 클릭 페이지 index를 roll outcome 판정에 전달하지 않았다.
- pending 관측 이력과 마지막 pending 상태를 구분하는 과정에서, 상태 변화가 없는데 pending만 사라진 경우를 `no-state-change`로 오분류했다.

### Confirmed root cause

- `playOneAvailableGameActionAcrossPages()`는 선택한 page index를 알고 있었지만 `waitForRollOutcomeAfterClick()`에는 전달하지 않았다.
- `hasStateAdvancedAcrossPages()`와 `didAutoAdvanceAfterRollAcrossPages()`는 클릭 페이지가 아니라 canonical page를 기준으로 먼저 비교했다.
- `waitForRollOutcomeAfterClick()` 종료부는 `sawPendingTurnAction && lastHasPendingTurnAction`일 때만 pending timeout으로 분류했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #220에서 기기전 액션 선택은 `canRollNow`/`canRequestMove`를 우선하도록 보강했다.
  - Why it failed: 선택한 페이지 index를 클릭 이후 outcome 판정까지 전달하지 않아, 실제 클릭 페이지와 상태 비교 기준 페이지가 분리될 수 있었다.
- Attempt 2:
  - What was changed: Issue #222에서 roll button transient blocker 오분류를 보강했다.
  - Why it failed: 버튼 readiness 판정은 개선했지만, 클릭 이후 pending 해소/상태 변화 판정의 기준 페이지 문제는 남아 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- 앱 UI나 게임 로직을 원인 확인 없이 변경하지 않는다.
- 기기전에서 실제 클릭한 페이지와 무관한 첫 번째 game page만 기준으로 상태 변화를 판단하지 않는다.
- pending을 관측한 액션을 마지막 순간 pending이 지워졌다는 이유만으로 `no-state-change`로 분류하지 않는다.

### Correct fix plan

- 기기전 helper가 선택한 page index를 `playOneAvailableGameAction()`과 `waitForRollOutcomeAfterClick()`에 전달한다.
- roll outcome의 state advance/auto advance 판정은 클릭 페이지를 우선 비교하고, 보조로 전체 page의 sequence/version 변화도 확인한다.
- 실패 로그에 clicked page index와 클릭 페이지의 before/after blocker summary를 포함한다.
- 상태 변화가 없고 pending을 한 번이라도 관측했다면 `pending-timeout`으로 분류한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile device-to-device QA rerun checked
- [x] No app UI changes
- [x] No new dependency


## 2026-07-01 - Issue #224 모바일 기기전 QA 게임 화면 전환 timeout

### Symptom

- Issue #224에서 모바일 기기전 QA가 `기기전 07 양쪽 게임 화면 준비 확인` 단계에서 실패했다.
- iPad 페이지의 `game-screen`이 10초 안에 보이지 않아 `expectTwoPlayerGameReady()`의 `toBeVisible()` assertion이 timeout 됐다.
- 같은 실패 로그에 Firestore `Commit` 요청의 `failed-precondition`/400 오류와 `expectedPreviousSequence` 값이 포함되어 있었다.

### Expected behavior

- 시작 버튼 클릭 이후 초기 게임 상태 저장과 room status 전환이 완료되어 iPad/Galaxy 양쪽이 게임 화면으로 진입해야 한다.
- 게임 화면 진입이 지연되거나 실패하면 QA 실패 메시지에 현재 화면, 대기실 잔류 여부, 앱 메시지, debug state가 포함되어야 한다.

### Actual behavior

- 기존 `expectTwoPlayerGameReady()`는 `game-screen` visibility만 기다렸기 때문에, 실패 시 페이지가 대기실에 남았는지, room status 전환이 늦었는지, 초기 저장/sequence mismatch가 있었는지 확인할 정보가 부족했다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. Galaxy가 준비 완료를 누른 뒤 iPad가 시작 버튼을 클릭한다.
3. `기기전 07 양쪽 게임 화면 준비 확인`에서 iPad와 Galaxy의 `game-screen` 전환을 확인한다.
4. iPad 페이지가 10초 안에 `game-screen`을 표시하지 못하면 timeout으로 실패한다.

### Suspected root cause

- 게임 시작 직후 초기 `saveGameState()` 또는 host autosave가 Firestore sequence/precondition 충돌을 만나면서 room status `playing` 전환 또는 구독 반영이 지연된 것으로 추정된다.
- 다만 실패 시점의 화면/debug state가 부족해 앱 로직을 즉시 수정하기보다 QA 진단을 먼저 보강해야 한다.

### Confirmed root cause

- 미확정. 현재 조치에서는 앱 동작을 바꾸지 않고 실패 시점의 화면/debug state를 수집하도록 QA assertion만 보강했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #216에서 autosave sequence mismatch 결과 처리와 sequence ref 보정을 보강했다.
  - Why it failed: 액션 진행 중 stale local turn state는 줄였지만, 게임 시작 직후 화면 전환 timeout의 실패 시점 정보를 충분히 남기지는 못했다.
- Attempt 2:
  - What was changed: Issue #222에서 roll button transient blocker 오분류를 QA helper에서 보강했다.
  - Why it failed: 이번 실패는 roll/move 액션 이전의 게임 화면 진입 단계라 해당 helper가 관여하지 않는다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI/CSS나 게임 보드 렌더링을 원인 확인 없이 변경하지 않는다.
- roll/move action helper를 이번 증상의 직접 원인으로 단정해 수정하지 않는다.
- Firestore sequence/precondition 실패를 테스트에서 무시하지 않는다.

### Correct fix plan

- `expectTwoPlayerGameReady()`에서 `game-screen` 대기 실패 시 현재 화면, waiting room text, game text, 앱 메시지, 기대 플레이어 표시 여부, `window.__YUT_DEBUG_STATE__`를 assertion 메시지에 포함한다.
- 앱 로직 변경은 보강된 실패 정보로 초기 저장 실패, room status 전환 지연, 구독 반영 문제 중 실제 원인을 확인한 뒤 별도 최소 패치로 진행한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile device-to-device QA rerun checked
- [x] No app UI changes
- [x] No new dependency

## 2026-07-01 - Issue #222 모바일 Game QA roll-yut-button disabled 오분류

### Symptom

- Issue #222에서 모바일 Game QA가 `roll-yut-button`을 찾은 뒤 enabled 대기에서 실패했다.
- 실패 메시지는 버튼이 보이면 활성화되어야 한다는 QA assertion에서 발생했다.

### Expected behavior

- `roll-yut-button`이 보이더라도 저장/원격 액션/roll lock/차례 순서 연출 같은 일시 상태면 QA가 즉시 실패하지 않고 대기 상태로 분류해야 한다.
- transient 상태가 아닌 차단이면 `rollActionBlockReasons` 등 debug guard 값을 포함해 원인을 드러내야 한다.

### Actual behavior

- `playOneAvailableGameAction()`은 `roll-yut-button` visibility만 확인한 뒤 `toBeEnabled()`를 기대했다.
- 앱은 `canSubmitTurnAction`이 true이면 `roll-yut-button`을 렌더링하지만, 실제 disabled 여부는 더 좁은 `canRollNow`와 roll 전용 blocker에 의해 결정된다.
- 따라서 `roll-in-progress`, `pending-local-remote-action`, `processing-remote-action`, `saving-host-state`, `roll-locked` 같은 transient blocker가 있는 정상 대기 상태도 테스트 실패로 오분류될 수 있었다.

### Suspected root cause

- 모바일/Firebase 타이밍에서 버튼 DOM visibility와 실제 roll 가능 guard 사이에 transient gap이 발생했다.
- QA helper가 debug guard를 확인하지 않고 visibility 기반으로 enabled를 강제 기대했다.

### Confirmed root cause

- 코드상 roll 버튼 처리 경로가 `collectGameDebugState()`의 `canRollNow`/`rollActionBlockReasons`를 확인하기 전에 `toBeEnabled()`를 호출했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #220에서 기기전 액션 선택은 `canRollNow`/`canRequestMove`를 우선하도록 보강했다.
  - Why it failed: 단일 페이지 `playOneAvailableGameAction()`의 roll 버튼 enabled 대기 경로에는 같은 transient 분류가 적용되지 않았다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- 앱 UI나 게임 로직을 원인 확인 없이 변경하지 않는다.
- `roll-yut-button` visibility만으로 즉시 enabled를 기대하지 않는다.
- transient roll blocker를 실패로 단정하지 않는다.

### Correct fix plan

- `playOneAvailableGameAction()`의 roll 버튼 경로에서 enabled assertion 전에 debug state를 수집한다.
- `rollActionBlockReasons`가 transient blocker이면 `wait`로 분류하고 다음 QA tick에서 다시 판단한다.
- transient blocker가 아닌데 disabled이면 debug blocker 요약을 포함해 실패시킨다.
- 앱 소스/UI는 변경하지 않고 QA helper와 실패 이력만 최소 수정한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [x] No app UI changes
- [x] No new dependency

## 2026-07-01 - Issue #220 모바일 QA 이동/기기전 액션 race 오분류

### Symptom

- Issue #220에서 모바일 Game QA가 `move-piece-button` 클릭 실패로 중단됐다.
- 같은 이슈의 기기전 QA는 roll 클릭 이후 `no-state-change` 또는 `roll-blocked`로 분류됐다.

### Expected behavior

- 이동 버튼이 ready로 관측된 직후 앱 상태가 이미 다음 턴으로 진행되어 버튼이 사라진 경우에는 QA가 이를 클릭 실패로 오분류하지 않아야 한다.
- 기기전 QA는 단순 버튼 visibility가 아니라 현재 페이지의 `canRequestMove`/`canRollNow` debug 상태를 기준으로 실제 조작 가능한 기기를 우선 선택해야 한다.

### Actual behavior

- `playOneAvailableGameAction()`은 이동 버튼 클릭 catch 이후 pending/holding/stale-local-move만 wait로 분류했고, 이미 `roll: null` 및 다음 roll 가능 상태로 진행된 경우를 정상 진행으로 인정하지 않았다.
- `playOneAvailableGameActionAcrossPages()`는 여러 기기 중 버튼이 보이는 첫 페이지를 선택해, transient 상태에서 실제 local turn/action 가능 페이지보다 visibility만 먼저 잡힌 페이지를 조작할 수 있었다.

### Suspected root cause

- 앱 상태 전환과 Playwright locator click 사이의 짧은 race를 QA helper가 정상 자동 진행으로 분류하지 못했다.
- 기기전 액션 선택 기준이 debug guard 상태보다 DOM visibility에 치우쳐 있었다.

### Confirmed root cause

- 코드상 이동 클릭 catch 경로에는 `hasStateAdvanced()` 기반의 진행 완료 판정이 없었다.
- 코드상 기기전 페이지 선택은 `isPlayableActionVisible()` 순회가 먼저라 `canRollNow`/`canRequestMove`를 우선하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 이전 이슈들에서 pending remote/action processing, stale turn/roll state 분류를 보강했다.
  - Why it failed: 이동 버튼 클릭 직전 상태가 이미 다음 턴으로 전환되는 click race와 기기전 조작 페이지 선택 기준은 별도로 해결하지 못했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- 앱 UI나 게임 로직을 원인 확인 없이 변경하지 않는다.
- 기기전에서 단순 버튼 visibility만으로 조작 페이지를 선택하지 않는다.
- 이미 진행된 move를 클릭 실패로 단정하지 않는다.

### Correct fix plan

- 이동 버튼 click catch에서 클릭 전/후 debug state를 비교해 이미 `roll: null`, `rollResultHolding: false`, 상태 sequence/version 또는 다음 roll 가능 UI로 전환된 경우 자동 진행으로 분류한다.
- 기기전 helper는 `canRequestMove === true` 또는 `canRollNow === true`이고 block reason이 없는 페이지를 우선 선택한다.
- 앱 소스/UI는 변경하지 않고 QA helper와 실패 이력만 최소 수정한다.

### Verification checklist

- [x] Build succeeds
- [ ] GitHub Actions mobile QA rerun checked
- [x] No app UI changes
- [x] No new dependency

## 2026-07-01 - 윷 던지기 무반응 재발 원인 재점검

### Symptom

- 사용자가 "윷 던지기"를 눌러도 아무 액션이 일어나지 않는 상태가 여전히 재현된다고 보고했다.
- 이전 BUG_HISTORY에는 같은 계열의 "윷 던지기 무반응" 항목이 여러 차례 누적되어 있다.

### Expected behavior

- 버튼이 눌릴 수 있는 상태라면 클릭 직후 로컬/원격 처리 경로 중 하나가 반드시 진행되고, 실패하더라도 사용자에게 실패 사유가 표시되어야 한다.
- 방장 승계, 원격 클라이언트, 두 번째 턴, 저장 pending 등 온라인 상태 차이에 따라 처리 경로가 엇갈려도 버튼 클릭이 무음으로 사라지면 안 된다.

### Actual behavior

- 이전 수정들은 `rollInProgress` stale lock, `clearRoll()` 누락, `isRoomHost`와 실제 `room.hostId` 불일치, host autosave pending race처럼 각각 발견된 단일 차단 조건을 부분적으로 해결했다.
- 그러나 클릭 핸들러 초입의 `if (!activeSeat || !canRollNow) return;` 경로는 여전히 아무 메시지 없이 종료된다.
- 따라서 `canRollNow`를 막는 새로운/잔여 조건이 발생하면 사용자는 버튼을 눌렀는데 아무 액션이 없는 것처럼 보게 된다.

### Suspected root cause

- 같은 증상이 여러 원인으로 반복됐는데, 이전 패치는 각 원인을 개별적으로 제거했을 뿐 "클릭이 왜 차단됐는지"를 사용자/로그에 드러내는 공통 진단 경로가 부족했다.
- 현재 코드에도 `rollActionBlockReasons` debug 값은 있지만 실제 `rollYut()`의 조기 반환 시 사용자 메시지나 영구 로그로 연결되지 않는다.

### Confirmed root cause

- 미확정. 이번 요청에서는 같은 버그가 이미 여러 번 실패한 규칙에 해당하므로, 즉시 추가 코드 수정을 하지 않고 재발 원인 분석만 기록한다.

### Previous failed attempts

- Attempt 4:
  - What was changed: 윷 던지기 차단/오류 경로를 팝업으로 표시하면서 버튼 disabled 조건까지 완화했다.
  - Why it failed: BUG_HISTORY의 "버튼 disabled 조건만 완화하지 않는다" 원칙을 벗어나 정상적인 비활성 상태까지 클릭 가능하게 만드는 범위 초과 변경이었다.
- Attempt 1:
  - What was changed: 원격 클라이언트 state sync 경로에서 stale `rollInProgress`를 해제했다.
  - Why it failed: 방장 로컬 `clearRoll()` 경로에서 남는 stale lock은 직접 해제하지 못했다.
- Attempt 2:
  - What was changed: `clearRoll()`에서 roll 진행 잠금을 함께 초기화했다.
  - Why it failed: 방장 승계/복구 타이밍에서 `isRoomHost` state만 보고 원격 action queue로 빠지는 경로는 남아 있었다.
- Attempt 3:
  - What was changed: 실제 `room.hostId === currentUserId`를 포함한 effective host 판정으로 host action 경로를 보강했다.
  - Why it failed: 사용자가 다시 무반응을 보고했으므로, 버튼 disabled/host 판정 외에 다른 `canRollNow` 차단 또는 클릭 처리 조기 반환 경로가 남아 있을 가능성이 크다.

### Do not try again

- 버튼 disabled 조건만 완화하지 않는다.
- `rollInProgress`만 계속 초기화하는 식으로 같은 접근을 반복하지 않는다.
- Playwright timeout만 늘리지 않는다.
- 실제 차단 reason을 수집하지 않은 상태에서 또 다른 추정성 game state 패치를 하지 않는다.

### Correct fix plan

- 다음 수정 전, 재현 시점의 `rollActionBlockReasons`, `canRollNow`, `canSubmitTurnAction`, `isRemoteActionClient`, `canHostRoom`, `rollInProgress`, `pendingLocalRemoteActionCount`, `processingActionCount`, `activeSeat/localSeatId`를 함께 확인한다.
- `rollYut()` 조기 반환 경로가 발생할 때 debug reason을 사용자 메시지 또는 QA 로그로 남기는 최소 진단 패치를 먼저 고려한다.
- 진단 결과가 누적되면 실제 차단 조건 하나만 대상으로 최소 수정한다.

### Verification checklist

- [ ] Reproduction state captured with roll block reasons
- [ ] Related feature still works
- [ ] No unrelated UI changes
- [ ] No console errors

## 2026-06-30 - 세로모드 플레이어 카드 한 줄 스타일 미적용

### Symptom

- 모바일 세로모드 화면에서 플레이어 카드가 여전히 P라벨, 이름, 순서, 상태를 여러 줄로 표시했다.
- 카드 높이가 줄지 않아 말판이 아래로 밀려 스크롤이 필요했다.

### Expected behavior

- 세로모드에서는 플레이어 카드가 `P1-이름 · 순서 · 상태` 형태의 한 줄 요약으로 표시되어야 한다.
- 플레이어 카드 영역이 줄어 말판이 더 빨리 보여야 한다.

### Actual behavior

- 기존 수정은 `max-width: 900px` 조건에 묶여 있어 실제 모바일 브라우저/배포 화면에서 세로모드 규칙이 적용되지 않는 경우가 있었다.
- 그 결과 새로 추가한 `.player-mobile-line`이 보이지 않고 기존 여러 줄 요소가 계속 표시됐다.

### Confirmed root cause

- 기본 JSX가 별도 라벨 `P1`과 이름 문자열 `P1-이름`을 동시에 출력해, 반응형 CSS가 적용되지 않거나 fallback 규칙으로 떨어질 때 P라벨이 중복 표시됐다.
- 좁은 화면 fallback인 `@media (max-width: 767px)`에서는 `.players`가 1열로 돌아가 카드 높이가 커질 수 있었다.
- 사용자 요구는 실제 모바일 좁은 화면과 세로모드 둘 다에서 동작해야 하므로, 플레이어 카드 한 줄 규칙은 `@media (orientation: portrait), (max-width: 767px)` 기준으로 적용되어야 한다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 카드 `gap`, `padding`, `font-size`, `line-height`만 줄였다.
  - Why it failed: 여러 줄 구조를 한 줄 구조로 바꾸지 못했다.
- Attempt 2:
  - What was changed: `.player-mobile-line`과 viewport meta를 추가했다.
  - Why it failed: 플레이어 카드 세로모드 규칙이 여전히 `max-width: 900px` 조건에 묶여 실제 화면에서 적용되지 않는 경우가 남았다.
- Attempt 3:
  - What was changed: 기존 모바일 규칙 뒤에 `aside.players` 대상 `!important` 보강 CSS를 추가했다.
  - Why it failed: 이미 같은 목적의 `.player-mobile-line` 모바일 규칙이 존재했는데 실제 DOM/CSS 적용 경로를 확인하지 않고 중복 규칙만 덧붙였다. 스크린샷처럼 모바일 요약과 기존 P라벨/배지/상태가 같이 보이는 상태는 플레이어 카드 내부 요소를 명확히 분리해 타겟하지 않으면 재발할 수 있다.
- Attempt 4:
  - What was changed: 카드 이름에서 `P1-` 같은 좌석 라벨 prefix만 제거했다.
  - Why it failed: 모바일 요약과 데스크톱용 라벨/이름/배지/상태를 동시에 렌더링한 뒤 CSS로 숨기는 구조 자체는 그대로 남아, fallback 상태에서 카드가 여러 줄로 커지는 문제를 해결하지 못했다.

### Do not try again

- 카드 여백 숫자만 줄이지 않는다.
- `orientation` 조건에만 의존하거나 `max-width` fallback을 방치해서 모바일 게임 화면 플레이어 카드 규칙을 적용하지 않는다.
- JSX에서 `P1` 라벨과 `P1-이름`을 동시에 출력하지 않는다.
- 실제 적용 여부 확인 없이 “수정 완료”라고 보고하지 않는다.
- 이미 존재하는 모바일 규칙 뒤에 같은 내용의 `!important` 보강 블록만 추가하지 않는다.

### Correct fix plan

- 게임 화면의 플레이어 카드 한 줄 요약 규칙을 `@media (orientation: portrait), (max-width: 767px)` 기준으로 적용한다.
- 기본 이름 문자열에서는 P라벨을 제거해 fallback 상태에서도 P라벨이 한 번만 보이게 한다.
- 기존 데스크톱/가로모드 표시는 유지한다.
- 게임 화면 플레이어 패널과 카드 내부 요소에 전용 클래스를 부여해 로비/대기실의 `.players`, `.player` 규칙과 섞이지 않게 한다.
- 중복 `!important` 보강 블록을 제거하고, 한 곳의 모바일 규칙에서 전용 클래스만 타겟한다.
- 수정 후 빌드뿐 아니라 모바일 브라우저/Playwright viewport에서 실제 DOM computed style을 확인한다.

### Verification checklist

- [x] Build succeeds
- [ ] Real mobile portrait browser checked after deploy
- [x] No new dependency


## 2026-06-30 - Issue #154 Playwright game QA turnOrderIntro stale state timeout

### Symptom

- PR #153 merge 후 `Merged PR QA and Deploy`의 Playwright E2E가 `Run Playwright tests` 단계에서 실패했다.
- iPad/Galaxy 단일 QA와 iPad device-to-device QA가 게임 액션 루프 중 timeout 또는 page/context closed 오류로 실패했다.
- artifact 화면에서는 게임 화면에서 roll 버튼이 비활성 대기 상태이거나, 방 종료 후 lobby로 돌아간 상태가 확인됐다.

### Expected behavior

- 차례 순서 안내 `turnOrderIntro`의 `readyAt`이 지난 뒤에는 게임 액션, AI autoplay, remote action 처리가 진행되어야 한다.
- 상태 동기화가 실패하더라도 만료된 intro가 영구적으로 게임 진행을 막으면 안 된다.

### Actual behavior

- host autosave fingerprint에 `turnOrderIntro`가 빠져 intro 해제 상태 변경이 저장 트리거에서 누락될 수 있었다.
- Firestore에 만료된 `turnOrderIntro`가 남으면 `canSubmitTurnAction`, AI autoplay, remote action 처리가 계속 차단됐다.
- Playwright helper는 game 화면 이탈이나 context close를 조기 실패로 드러내지 못하고 roll 결과 대기를 반복하다 전체 test timeout에 도달했다.

### Confirmed root cause

- `turnOrderIntro` 해제 상태가 autosave fingerprint에 포함되지 않았고, 만료된 intro를 active 상태와 동일하게 취급하는 조건들이 남아 있었다.
- authoritative roll reducer도 Firestore의 만료된 `turnOrderIntro`를 그대로 진행 차단 조건으로 사용했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: PR #153에서 roll 이후 실제 상태 변화 관측을 강화했다.
  - Why it failed: 테스트의 false positive는 줄였지만, 앱의 stale `turnOrderIntro` 동기화 버그 자체는 해결하지 못했다.
- Attempt 2:
  - What was changed: 이전 이슈들에서 Playwright coverage와 debug state를 여러 차례 보강했다.
  - Why it failed: timeout 원인인 상태 머신 차단 조건과 Firestore intro 완료 커밋 경로가 남아 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- disabled roll/move 버튼을 테스트에서 강제로 클릭하지 않는다.
- `turnOrderIntro`를 단순히 UI에서만 숨기고 Firestore 상태 정리를 생략하지 않는다.
- 만료 여부 확인 없이 raw `turnOrderIntro` 존재만으로 액션을 차단하지 않는다.

### Correct fix plan

- autosave fingerprint에 `turnOrderIntro`를 포함한다.
- 만료된 intro는 UI, action guard, authoritative reducer에서 active intro로 취급하지 않는다.
- host가 `readyAt` 이후 idempotent transaction으로 `turnOrderIntro: null`을 Firestore에 기록한다.
- Playwright helper는 game 화면 이탈/page close를 즉시 원인 포함 실패로 보고한다.

### Verification checklist

- [x] Build succeeds
- [ ] GitHub Actions Playwright rerun checked
- [x] No unrelated UI redesign


## 2026-06-30 - Issue #148 모바일 기기전 QA host 방 생성 중 대기실 진입 timeout

### Symptom

- PR #147 이후 `mobile device-to-device QA`의 `기기전 04 iPad 방 생성 및 대기실 진입` 단계에서 timeout이 발생했다.
- 실패 로그에서 iPad host는 `screen: "lobby"`, notice `방을 만드는 중입니다. 잠시만 기다려주세요...`, create button `방 만드는 중...` disabled 상태였고 `waiting-room`이 표시되지 않았다.

### Expected behavior

- host가 방 만들기를 누르면 방 생성 전 정리 작업이 지연되더라도 새 방 생성 또는 timeout 복구 경로로 진행해야 한다.
- 선행 cleanup 지연 때문에 대기실 전환 전 상태에 무기한 가깝게 머물면 안 된다.

### Actual behavior

- `handleCreateRoom()`은 `leaveDuplicatePlayerRooms(roomHost.uid)`와 `leavePreviousOnlineRoom()`을 `createRoom()` 호출 전에 순차적으로 await했다.
- `CREATE_ROOM_TIMEOUT`은 sign-in 및 `createRoom()`에만 적용되어 선행 cleanup 지연 시 버튼은 계속 `방 만드는 중...` 상태로 남을 수 있었다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad host가 QA 방 제목을 입력하고 방 만들기를 누른다.
3. Firestore cleanup 또는 이전 방 정리 단계가 지연된다.
4. `createRoom()` 또는 `openWaitingRoom()`까지 도달하지 못하면 `waiting-room` visible assertion이 timeout된다.

### Suspected root cause

- 방 생성 전 선행 cleanup await에 제한 시간이 없어 모바일 WebKit/Firestore CI 타이밍에서 대기실 진입 경로가 막힌 것으로 보인다.

### Confirmed root cause

- 코드 경로상 `handleCreateRoom()`의 선행 cleanup 두 단계는 `CREATE_ROOM_TIMEOUT` race 밖에서 await되고 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #142에서 host 생성 후 `openWaitingRoom()` 내부 중복 방 정리 await를 non-host 참여 경로로 제한했다.
  - Why it failed: Issue #148은 `openWaitingRoom()` 진입 후가 아니라 `방 만드는 중...` 상태로 남아, 생성 전 cleanup/create 단계 지연에 더 가깝다.
- Attempt 2:
  - What was changed: Issue #136에서 대기실 진입 실패 로그를 보강했다.
  - Why it failed: 진단은 가능해졌지만 `handleCreateRoom()` 선행 cleanup 지연은 제한하지 않았다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 시작 버튼/방장 권한 문제로 단정해 `canManageRoom`만 수정하지 않는다.
- 원인 확인 없이 방 생성, 인증, room cleanup 경로를 넓게 리팩터링하지 않는다.

### Correct fix plan

- host 방 생성 전 cleanup은 짧은 제한 시간 안에서만 기다리고, 실패 또는 지연 시 warning을 남긴 뒤 방 생성을 계속 진행한다.
- 기존 참여자 join 경로의 중복 방 보호 정리는 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #142 모바일 기기전 QA host 대기실 전환 지연

### Symptom

- PR #141 이후 `mobile device-to-device QA`의 `기기전 04 iPad 방 생성 및 대기실 진입` 단계에서 timeout이 발생했다.
- iPad host가 방 만들기를 누른 뒤 Firestore 방 카드는 로비에 보였지만, 화면은 `screen: "lobby"`와 `방으로 이동하는 중입니다...` 상태에 머물렀고 `waiting-room`이 표시되지 않았다.

### Expected behavior

- host가 방 생성에 성공하면 새 방 대기실로 즉시 전환되어야 한다.
- 생성된 방이 이미 보호 대상이면 대기실 전환 전 중복 방 정리 작업이 새 방 입장을 불필요하게 지연시키지 않아야 한다.

### Actual behavior

- `openWaitingRoom()`은 host 생성 경로에서도 `leaveDuplicatePlayerRooms(joiningUser.uid, room.id)`를 다시 await했다.
- `handleCreateRoom()`은 새 방 생성 전에 이미 같은 host uid의 중복 방 정리를 수행하므로, 새 방 생성 후 대기실 상태 전환 전에 같은 정리 작업을 다시 기다릴 필요가 없었다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad host가 QA 방 제목을 입력하고 방 만들기를 누른다.
3. Firestore에는 QA 방이 생성되어 로비 카드가 보인다.
4. 대기실 상태 전환 전에 정리 작업이 지연되면 `waiting-room` visible assertion이 timeout된다.

### Suspected root cause

- 새 방 생성 후 host 대기실 전환 전에 중복 방 정리 작업을 다시 await하면서, 모바일 WebKit/Firestore CI 타이밍에서 `setActiveRoomId()`와 `setScreen('waitingRoom')`까지 도달하지 못한 것으로 보인다.

### Confirmed root cause

- 코드 경로상 host 생성 직전 `handleCreateRoom()`에서 `leaveDuplicatePlayerRooms(roomHost.uid)`를 이미 await한 뒤에도, 생성 직후 `openWaitingRoom()`에서 host를 `joiningUser`로 취급해 `leaveDuplicatePlayerRooms(joiningUser.uid, room.id)`를 다시 await했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #136에서 대기실 진입 실패 로그가 보강되었다.
  - Why it failed: 진단은 강화되었지만 host 대기실 전환 전 중복 정리 await 경로는 그대로 남아 있었다.
- Attempt 2:
  - What was changed: Issue #128에서 host uid fallback 및 방장 권한 경로가 보강되었다.
  - Why it failed: Issue #142는 방장 권한 미노출이 아니라 `waiting-room` 자체로 전환되기 전 정리 await가 지연되는 경로였다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 시작 버튼/방장 권한 문제로 단정해 `canManageRoom`만 수정하지 않는다.
- 원인 확인 없이 방 생성, 인증, room cleanup 경로를 넓게 리팩터링하지 않는다.

### Correct fix plan

- host 생성 경로에서는 새 방 생성 전에 이미 중복 방 정리를 수행했으므로, `openWaitingRoom()`의 새 방 입장 전 중복 방 정리 await는 비-host 참여 경로에만 적용한다.
- 기존 참여자 join 경로의 중복 방 보호 정리는 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #140 모바일 기기전 QA 이동 커버리지 재발 진단

### Symptom

- PR #139 이후 `mobile device-to-device QA`의 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 다시 실패했다.
- 기기전 루프는 목표 액션과 윷 던지기 커버리지를 통과했지만 `coverage.manualMoved + coverage.autoWaited`가 0으로 남아 이동/자동 이동 검증 assertion이 실패했다.

### Expected behavior

- 실패 시 어떤 액션들이 10개 이상 진행되었는지, 전체 coverage 카운터와 양쪽 기기의 debug state가 assertion 메시지에 남아야 한다.
- 실제 이동 경로가 누락된 것인지, 아이템/함정/roll 액션만으로 목표 액션이 채워진 것인지 구분할 수 있어야 한다.

### Actual behavior

- Issue #138의 갈림길 이동 카운터 누락 보강 후에도 같은 최종 assertion이 재발했다.
- 기존 실패 메시지는 `manualMoved + autoWaited`가 0이라는 결과만 보여 주고, `coverage` 전체와 액션 이력을 함께 보여 주지 않아 다음 원인을 확정하기 어려웠다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad/Galaxy가 같은 개인전 방에 입장하고 게임을 시작한다.
3. 상태 머신 액션 루프가 10개 이상 액션을 진행한다.
4. 루프 종료 후 `manualMoved + autoWaited`가 0이면 실패한다.

### Suspected root cause

- PR #139의 `branchMoved` -> `manualMoved` 반영은 현재 코드에 존재하므로, 같은 갈림길 누락만으로 단정하기 어렵다.
- 실제 이동 실패보다는 기기전 QA 커버리지 집계가 아이템/함정/roll 등 일부 정상 진행 조합을 이동 검증 실패로 오판했을 가능성이 있다.
- 다만 실패 로그에 전체 coverage와 action history가 없어 확정할 수 없다.

### Confirmed root cause

- 아직 미확정. 이번 변경은 반복 실패 원인을 확정하기 위한 QA 실패 로그 보강이다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #138에서 갈림길 이동 버튼 클릭 성공 시 `coverage.manualMoved`를 증가시켰다.
  - Why it failed: PR #139 이후에도 같은 최종 assertion이 재발했고, 실패 로그만으로는 실제 액션 조합을 확인할 수 없었다.
- Attempt 2:
  - What was changed: Issue #130에서 일반 이동 버튼이 사라지고 roll이 clear된 경우 자동 이동으로 인정하도록 보강했다.
  - Why it failed: 이번 재발은 일반 이동 버튼 자동 진행 경합인지, 아이템/함정/roll 위주 진행인지 구분할 정보가 부족했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.
- `manualMoved` 또는 `autoWaited`를 무조건 증가시키는 식으로 assertion을 우회하지 않는다.

### Correct fix plan

- 먼저 `playUntilActionsAcrossPages()`의 최종 assertion 실패 메시지에 `coverage`, `actionHistory`, 양쪽 `debugStates`를 포함한다.
- 다음 실패 로그에서 어떤 액션 조합으로 목표 액션이 채워졌는지 확인한 뒤, 실제 누락된 경로만 최소 수정한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [ ] No unrelated UI changes


## 2026-06-30 - Issue #138 모바일 기기전 QA 갈림길 이동 커버리지 누락

### Symptom

- PR #137 이후 `mobile device-to-device QA`의 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 실패했다.
- 기기전 루프는 목표 액션과 윷 던지기 커버리지를 통과했지만 `coverage.manualMoved + coverage.autoWaited`가 0으로 남아 이동/자동 이동 검증 assertion이 실패했다.

### Expected behavior

- 일반 이동 버튼, 자동 이동 대기뿐 아니라 갈림길 선택 후 이동 버튼을 누른 경우도 실제 수동 이동 커버리지로 집계되어야 한다.

### Actual behavior

- `handleBranchMove()`는 갈림길 버튼 선택 횟수만 기록하고, 실제 `.branch-move-button` 클릭 성공 후에도 `manualMoved`를 증가시키지 않았다.
- 따라서 갈림길 이동만 발생한 정상 진행도 마지막 이동 커버리지 assertion에서 이동 검증 없음으로 오판될 수 있었다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad/Galaxy가 같은 개인전 방에 입장하고 게임을 시작한다.
3. 상태 머신 액션 루프 중 갈림길 이동 경로가 실제 이동을 처리한다.
4. 루프 종료 후 `manualMoved + autoWaited`가 0이면 실패한다.

### Suspected root cause

- Issue #130 계열의 이동 버튼/자동 진행 커버리지 보강 이후에도, 갈림길 이동은 별도 카운터만 증가하고 최종 이동 검증 assertion에는 포함되지 않았다.

### Confirmed root cause

- `handleBranchMove()`에서 실제 이동 버튼 클릭 성공 후 `coverage.manualMoved`를 증가시키지 않아 QA 커버리지 집계가 실제 이동 경로를 누락했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #130에서 일반 `move-piece-button`이 사라지고 `roll`이 clear된 경우 자동 이동으로 인정하도록 보강했다.
  - Why it failed: 갈림길 이동 버튼 경로는 일반 `move-piece-button` 경로가 아니라 별도 `handleBranchMove()`에서 처리되어 해당 커버리지 보강 대상에 포함되지 않았다.
- Attempt 2:
  - What was changed: 이동 버튼/대기실/Firestore 관련 모바일 QA 진단과 상태 동기화 보강이 여러 차례 이루어졌다.
  - Why it failed: Issue #138의 실패 지점은 앱 진행 고착이 아니라 테스트 커버리지 카운터 누락이었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 앱 자동 이동 또는 갈림길 이동 로직을 원인 확인 없이 변경하지 않는다.
- 실제 이동이 아닌 콘솔 transient 문제로 단정하지 않는다.

### Correct fix plan

- `handleBranchMove()`에서 갈림길 이동 버튼 클릭 성공 시 branch 이동 전용 카운터와 함께 `manualMoved`도 증가시킨다.
- 기존 최종 assertion은 유지해 일반 이동, 자동 이동, 갈림길 수동 이동을 모두 같은 이동 검증 범위로 집계한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [ ] No unrelated UI changes


## 2026-06-30 - Issue #136 모바일 기기전 QA 대기실 진입 timeout 재발

### Symptom

- PR #135 이후 `mobile device-to-device QA`의 `기기전 04 iPad 방 생성 및 대기실 진입` 단계에서 timeout이 발생했다.
- iPad host가 방 제목을 입력하고 `create-room-button`을 클릭했지만, 25초 안에 `waiting-room`이 visible 상태가 되지 않았다.

### Expected behavior

- iPad host가 방을 만들면 방 생성에 사용한 host 사용자로 대기실에 진입해야 한다.
- 실패하더라도 화면 상태, lobby notice, create button, matching room card, `__YUT_DEBUG_STATE__`가 실패 로그에 남아야 한다.

### Actual behavior

- assertion은 `waitingRoom.visible`이 `true`가 되는지만 검사했고, 실패 이슈에서 이미 수집 중인 transition debug state 전체가 충분히 드러나지 않았다.
- 방 생성 실패, `openWaitingRoom()` 실패, subscription/cleanup에 의한 lobby 복귀 중 어느 경로인지 확정하기 어려웠다.

### Reproduction steps

1. 모바일 QA 테스트를 iPad/WebKit 기기전 프로젝트에서 실행한다.
2. iPad host page에서 QA 방 제목을 입력한다.
3. `create-room-button`을 클릭한다.
4. `waiting-room` visible poll이 timeout되면 실패한다.

### Suspected root cause

- Issue #126의 대기실 진입 timeout과 같은 계열의 반복 실패지만, 현재 로그만으로 앱 로직의 정확한 실패 지점은 확정되지 않았다.
- 기존 `collectLobbyTransitionDebugState()`는 필요한 정보를 수집하지만, poll matcher가 `waitingRoom.visible` 비교 중심이라 다음 원인 구분에 필요한 전체 상태가 실패 로그에 충분히 남지 않았다.

### Confirmed root cause

- 아직 미확정. 이번 변경은 반복 실패 원인을 확정하기 위한 QA 실패 로그 보강이다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #126에서 iPad 방 생성 후 대기실 진입 assertion에 lobby notice, create button, waiting-room, matching room card, `__YUT_DEBUG_STATE__` 수집 함수를 추가했다.
  - Why it failed: 수집 함수는 생겼지만 matcher 실패 출력이 전체 수집값을 안정적으로 드러내지 않아 Issue #136에서도 실제 전환 실패 지점을 확정하기 어려웠다.
- Attempt 2:
  - What was changed: Issue #128에서 host uid fallback 및 방장 권한 경로를 보강했다.
  - Why it failed: Issue #136은 시작 버튼 미노출이 아니라 `waiting-room` 자체 미표시라 같은 원인으로 단정할 수 없다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 시작 버튼/방장 권한 문제로 단정해 `canManageRoom`만 수정하지 않는다.
- 원인 확인 없이 방 생성, 인증, room cleanup 경로를 넓게 리팩터링하지 않는다.

### Correct fix plan

- 먼저 기기전 host 방 생성 poll 실패 시 `collectLobbyTransitionDebugState()` 전체 객체가 assertion actual value로 남도록 테스트 진단만 최소 보강한다.
- 다음 실패 로그에서 방 생성 실패, `openWaitingRoom()` 실패, subscription/cleanup에 의한 lobby 복귀를 구분한다.
- 원인이 확인된 뒤 앱 로직의 해당 경로만 최소 수정한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [ ] No unrelated UI changes

## 2026-06-30 - Issue #133 모바일 QA Firestore transient 콘솔 에러 반복

### Symptom

- iPad 모바일 Game QA의 `06 콘솔 에러 허용 범위 확인` 단계에서 transient Firestore 콘솔 에러가 2개 수집되어 허용치 1개를 초과했다.
- 로그에는 Firestore Commit `already-exists` 계열과 `Failed to load resource` 400/409 계열이 함께 나타났다.

### Expected behavior

- 사용자 진행을 막는 blocking console/page error는 없어야 한다.
- Firestore transaction retry 과정에서 함께 발생한 400/409 및 `already-exists` 로그는 같은 transient incident로 판단되어야 한다.

### Actual behavior

- QA assertion이 transient Firestore 로그 개수를 원문 메시지 단위로 세어, 같은 Commit retry incident로 보이는 400/409와 `already-exists` 로그를 별도 반복 에러로 처리했다.

### Reproduction steps

1. 모바일 QA 테스트를 iPad 프로젝트에서 실행한다.
2. 방을 생성하고 게임을 시작한다.
3. 상태 머신 액션 루프를 완료한다.
4. 콘솔 에러 허용 범위 확인 단계에서 transient Firestore 로그가 2개 이상 수집되면 실패한다.

### Suspected root cause

- Firestore transaction 경합 또는 SDK retry 과정에서 같은 Commit retry incident가 `Failed to load resource` 400/409와 Firestore `already-exists` 메시지로 나뉘어 콘솔에 기록될 수 있다.
- 기존 QA assertion은 같은 retry incident인지 구분하지 않고 transient 로그 원문 개수를 직접 제한했다.

### Confirmed root cause

- 테스트 코드상 transient Firestore error를 incident 단위가 아니라 메시지 개수 단위로 집계했다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 모바일 QA의 시작 버튼/이동 버튼/rollResultReadyAt 경로를 여러 차례 보강했다.
  - Why it failed: Issue #133의 실패 지점은 UI 진행 고착이 아니라 최종 콘솔 transient error 집계 기준이었다.
- Attempt 2:
  - What was changed: Firestore transient error를 최대 1개 원문 메시지까지만 허용했다.
  - Why it failed: 같은 Commit retry incident가 복수 콘솔 메시지로 노출될 수 있어 정상 복구 가능한 경합도 실패로 처리했다.

### Do not try again

- UI 구조나 레이아웃을 변경하지 않는다.
- Playwright timeout만 늘리지 않는다.
- blocking console/page error를 transient로 허용하지 않는다.
- transient Firestore 허용치를 근거 없이 크게 늘리지 않는다.

### Correct fix plan

- blocking console/page error는 계속 실패시킨다.
- Firestore 400/409 및 `already-exists` Commit retry 로그는 같은 transient incident key로 묶어 집계한다.
- 서로 다른 transient incident가 반복되면 기존처럼 실패시킨다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile QA full run checked
- [ ] No blocking console/page errors

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

## 2026-06-30 - Issue #144 모바일 기기전 QA roll-only 액션 히스토리 재발

### Symptom

- PR #143 이후 `mobile device-to-device QA`의 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 다시 실패했다.
- 실패 로그의 `actionHistory`가 `roll` 10개로만 채워졌고, `coverage.rolled`는 10이었지만 `coverage.manualMoved + coverage.autoWaited`는 0이었다.

### Expected behavior

- 윷 던지기 뒤 앱이 자동 이동 또는 이동 불가 스킵으로 다음 턴/다음 상태에 진입한 경우, QA 루프가 그 자동 진행을 이동 관련 검증으로 관측해야 한다.
- 단순히 윷을 던졌다는 이유만으로 이동 커버리지를 올리면 안 된다.

### Actual behavior

- QA 루프는 `roll-yut-button` 클릭을 `roll` 액션으로만 기록했다.
- 버튼 클릭 직후 앱이 자동 이동 또는 이동 불가 스킵으로 `roll`을 비우고 다시 윷 던지기 가능한 상태가 되어도, 이 상태 전환은 `autoWaited`에 반영되지 않았다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad/Galaxy가 같은 개인전 방에 입장하고 게임을 시작한다.
3. 상태 머신 액션 루프 중 윷 던지기 후 앱이 자동으로 이동 또는 이동 불가 스킵을 처리한다.
4. 테스트가 이동 버튼을 직접 관측하지 못한 채 다음 윷 던지기만 반복 기록하면 `manualMoved + autoWaited` assertion이 실패한다.

### Suspected root cause

- 기기전 QA 커버리지 집계가 윷 던지기 직후의 자동 상태 전환을 관측하지 않아 `actionHistory`가 `roll`로만 채워질 수 있었다.

### Confirmed root cause

- `playOneAvailableGameAction()`의 `roll-yut-button` 경로는 클릭 후 `coverage.rolled`만 증가시키고 반환했다. 따라서 클릭 직후 앱이 `roll: null`과 다음 윷 던지기 가능 상태로 자동 진행했는지 확인하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #138에서 갈림길 이동 버튼 클릭 성공 시 `coverage.manualMoved`를 증가시켰다.
  - Why it failed: 이번 실패의 `branchMoved`는 0이어서 갈림길 이동 누락과 다른 경로였다.
- Attempt 2:
  - What was changed: Issue #140에서 실패 메시지에 `coverage`, `actionHistory`, `debugStates`를 포함했다.
  - Why it failed: 진단 정보는 확보됐지만, `roll` 직후 자동 진행을 커버리지에 반영하는 로직은 없었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.

### Correct fix plan

- `roll-yut-button` 클릭 전후의 debug state를 비교한다.
- 클릭 후 `roll`이 `null`이고 결과 대기 상태가 아니며 다시 윷 던지기 가능한 상태가 되었고, `turnIndex`, `lastMovedSeatId`, 또는 `lastMovedPieceIds`가 바뀐 경우에만 자동 진행으로 보고 `coverage.autoWaited`를 증가시킨다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #146 모바일 기기전 QA 자동 진행 관측값 누락

### Symptom

- PR #145 이후 `mobile device-to-device QA`의 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 다시 실패했다.
- 실패 로그에서 `coverage.rolled`는 10이었지만 `coverage.manualMoved + coverage.autoWaited`는 0으로 남았다.
- 최종 debug state는 `roll: null`, `rollResultHolding: false`, `rollButton.visible: true`라 앱은 다시 윷 던지기 가능한 상태였지만 테스트가 이동 관련 자동 진행으로 인정하지 못했다.

### Expected behavior

- 윷 던지기 후 자동 이동 또는 이동 불가 스킵으로 다음 상태에 진입하면 QA 루프가 이를 `autoWaited`로 관측해야 한다.
- 자동 진행 판정은 실제 상태 변화가 확인될 때만 해야 하며, `roll` 액션마다 무조건 커버리지를 증가시키면 안 된다.

### Actual behavior

- `didAutoAdvanceAfterRoll()`은 `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 변화를 비교하도록 작성되었다.
- 하지만 앱의 `window.__YUT_DEBUG_STATE__`에는 `lastMovedSeatId`와 `lastMovedPieceIds`가 노출되지 않아, 보너스 턴처럼 `turnIndex`가 유지되는 자동 진행을 테스트가 관측하지 못할 수 있었다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad/Galaxy가 같은 개인전 방에 입장하고 게임을 시작한다.
3. 상태 머신 액션 루프 중 윷 던지기 후 앱이 자동으로 다음 윷 던지기 가능 상태로 돌아온다.
4. 테스트 debug state에 last moved 정보가 없고 `turnIndex` 변화도 없으면 `autoWaited`가 증가하지 않아 최종 assertion이 실패한다.

### Suspected root cause

- Issue #144 수정은 roll 클릭 전후 `lastMovedSeatId`와 `lastMovedPieceIds`를 비교하도록 했지만, 실제 앱 debug state가 그 값을 제공하지 않았다.

### Confirmed root cause

- `src/app/App.tsx`의 `window.__YUT_DEBUG_STATE__`에 `lastMovedSeatId`와 `lastMovedPieceIds`가 포함되지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #144에서 roll 클릭 후 자동 진행을 감지하는 테스트 로직을 추가했다.
  - Why it failed: 테스트가 비교하는 last moved 값이 debug state에 없어 일부 자동 진행을 관측하지 못했다.
- Attempt 2:
  - What was changed: Issue #140에서 실패 메시지에 coverage/actionHistory/debugStates를 포함했다.
  - Why it failed: 진단 정보는 늘었지만 앱 debug state의 last moved 필드 누락은 그대로였다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.

### Correct fix plan

- 앱 debug state에 `lastMovedSeatId`와 `lastMovedPieceIds`를 노출한다.
- 기존 `didAutoAdvanceAfterRoll()` 판정 로직은 유지하고, 테스트가 의도한 관측값을 받을 수 있게 한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #150 모바일 기기전 QA roll-only 이동 커버리지 재발

### Symptom

- PR #149 이후 `mobile device-to-device QA`의 `기기전 08 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계에서 다시 실패했다.
- 실패 로그에서 `coverage.rolled`는 10이었지만 `coverage.manualMoved + coverage.autoWaited`는 0으로 남았다.
- 최종 debug state는 `roll: null`, `rollResultHolding: false`, `rollButton.visible: true`였지만 `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 변화만으로는 자동 진행을 인정하지 못했다.

### Expected behavior

- 윷 던지기 뒤 앱이 자동 이동 또는 이동 불가 스킵으로 다시 윷 던지기 가능한 상태가 되면, QA 루프가 실제 상태 변화가 확인되는 경우에만 자동 진행을 이동 관련 검증으로 집계해야 한다.
- `roll` 액션마다 무조건 이동 커버리지를 올리면 안 된다.

### Actual behavior

- `didAutoAdvanceAfterRoll()`은 `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 변화만 비교했다.
- 보너스 턴 또는 상태 동기화 타이밍 때문에 이 값들이 그대로인 상태에서도 말 위치 변화가 발생할 수 있는데, 앱 debug state에는 전체 말 위치를 비교할 최소 snapshot이 없어 테스트가 자동 진행을 관측할 근거가 부족했다.

### Reproduction steps

1. 모바일 기기전 QA를 실행한다.
2. iPad/Galaxy가 같은 개인전 방에 입장하고 게임을 시작한다.
3. 상태 머신 액션 루프 중 윷 던지기 후 앱이 다시 윷 던지기 가능한 상태로 돌아온다.
4. 테스트가 `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 변화만 보다가 실제 말 위치 변화 또는 자동 진행을 놓치면 `manualMoved + autoWaited` assertion이 실패한다.

### Suspected root cause

- 반복 실패 계열상 앱 진행 고착보다는 기기전 QA 자동 진행 관측값이 부족했던 것으로 보인다.
- `roll` 이후 다시 윷 던지기 가능한 상태가 되었는지뿐 아니라, 실제 말 위치 snapshot이 바뀌었는지를 함께 비교해야 한다.

### Confirmed root cause

- `window.__YUT_DEBUG_STATE__`에 전체 말 위치를 비교할 QA용 `pieces` snapshot이 없었고, `didAutoAdvanceAfterRoll()`도 말 위치 변화를 자동 진행 근거로 사용하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #144에서 roll 클릭 후 자동 진행 감지 로직을 추가했다.
  - Why it failed: `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 비교만으로는 일부 자동 진행/보너스 턴 상태 변화를 충분히 관측하지 못했다.
- Attempt 2:
  - What was changed: Issue #146에서 debug state에 `lastMovedSeatId`와 `lastMovedPieceIds`를 노출했다.
  - Why it failed: last moved 필드만으로는 전체 말 위치 변화 여부를 확인할 수 없어, 값이 유지되는 경로에서 자동 진행으로 인정하지 못했다.

### Do not try again

- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.

### Correct fix plan

- 앱 debug state에 QA용 말 위치 snapshot의 최소 필드(`id`, `ownerId`, `nodeId`, `started`, `finished`)를 노출한다.
- `didAutoAdvanceAfterRoll()`은 기존 `turnIndex`, `lastMovedSeatId`, `lastMovedPieceIds` 비교를 유지하되, 추가로 말 위치 snapshot 변화가 있을 때만 자동 진행으로 인정한다.

### Verification checklist

- [x] Build succeeds
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #156 모바일 Game QA 진행 중 방 삭제로 lobby 복귀

### Symptom

- PR #155 이후 모바일 Game QA의 실제 게임 상태 머신 액션 진행 단계에서 실패했다.
- 윷 던지기 직후 debug state가 `screen: "lobby"`, `activeRoomId: ""`, `message: "방이 종료되어 대기실로 이동했습니다."` 상태로 관측됐다.

### Expected behavior

- 게임 진행 중인 방은 일반 stale room cleanup 때문에 즉시 삭제되지 않아야 한다.
- QA 액션 루프가 윷 던지기 직후 방 삭제로 lobby에 복귀하지 않아야 한다.

### Actual behavior

- `cleanupStaleRooms()`가 `waiting`뿐 아니라 `playing` 방도 cleanup 대상으로 조회했다.
- stale player 정리 후 남은 사람이 AI뿐이라고 판단하면 `playing` 방도 `deleteRoom()` 대상이 될 수 있었다.
- 방 문서가 삭제되면 `subscribeRoom()`의 `!room` 경로가 실행되어 lobby로 돌아가고, QA는 이를 terminal state로 실패 처리했다.

### Reproduction steps

1. 모바일 Game QA를 실행한다.
2. AI를 포함한 방에서 실제 게임 상태 머신 액션 루프를 진행한다.
3. cleanup 타이밍에 playing 방의 human player snapshot이 stale 또는 부재로 판단된다.
4. 방이 삭제되면 클라이언트가 lobby로 복귀하고, 윷 던지기 이후 terminal-state 오류가 발생한다.

### Suspected root cause

- 모바일 WebKit/CI 타이밍에서 heartbeat 반영보다 cleanup 판단이 앞서면, 진행 중인 게임 방도 빈 방으로 오인될 수 있다.

### Confirmed root cause

- `cleanupStaleRooms()`가 `status in ['waiting', 'playing']` 방을 대상으로 하면서, `playing` 방도 남은 human player가 없으면 `deleteRoom()`를 호출할 수 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #144/#146/#150에서 roll 직후 자동 진행 관측값과 QA debug state를 보강했다.
  - Why it failed: 이번 증상은 이동 커버리지 누락이 아니라 방 문서 삭제로 인한 game screen 이탈이었다.
- Attempt 2:
  - What was changed: Issue #154에서 stale `turnOrderIntro` 차단 조건과 저장 경로를 보강했다.
  - Why it failed: 이번 debug state는 turnOrderIntro 고착이 아니라 `activeRoomId`가 비워진 lobby 복귀 상태였다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.
- game screen 이탈을 테스트에서 무시하지 않는다.

### Correct fix plan

- stale room cleanup은 계속 수행하되, `playing` 방은 stale player 정리 후에도 empty-room `deleteRoom()` 대상에서 제외한다.
- `waiting` 방의 빈 방 정리 동작은 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #158 모바일 Game QA roll click no-state-change timeout

### Symptom

- PR #157 이후 모바일 Game QA와 모바일 기기전 QA의 실제 게임 상태 머신 액션 진행 단계가 실패했다.
- 실패 stack은 `waitForRollOutcomeAfterClick()` 내부 `page.waitForTimeout(250)` 대기 중 전체 테스트 timeout에 도달한 형태였다.
- 실패 직전 debug state는 game 화면과 활성화된 윷 던지기 가능 상태를 보여 주었지만, roll 클릭 이후 상태 변화 원인이 실패 메시지에 충분히 남지 않았다.

### Expected behavior

- 윷 던지기 버튼 클릭 후에는 roll 상태, 자동 진행, 이동 UI, 또는 terminal state 중 하나가 관측되어야 한다.
- 상태 변화가 전혀 관측되지 않으면 QA가 같은 wait 루프를 반복해 전체 timeout까지 끌고 가지 않고, 클릭 전후 debug state를 포함해 즉시 원인을 드러내야 한다.

### Actual behavior

- `playOneAvailableGameAction()`은 `waitForRollOutcomeAfterClick()` 결과가 `no-state-change`일 때 `wait`를 반환했다.
- 이 때문에 roll click no-op/reject/sequence 미증가 같은 실제 원인이 있어도 진행 액션으로 집계되지 않은 채 반복 대기할 수 있었다.
- 단일 모바일 QA의 최종 assertion 메시지는 기기전 QA보다 `coverage`와 `actionHistory` 정보가 부족해 반복 실패 분석이 어려웠다.

### Reproduction steps

1. 모바일 Game QA 또는 모바일 기기전 QA를 실행한다.
2. 게임 화면에서 `roll-yut-button`이 보여 활성화된 상태로 클릭된다.
3. 클릭 후 `roll`, 자동 진행, 이동 UI, terminal state가 관측되지 않는다.
4. 테스트가 `wait`로 되돌아가 반복하다가 전체 test timeout에 도달한다.

### Suspected root cause

- 앱의 authoritative roll 처리 또는 remote state sync가 상태 변화를 만들지 않는 경로가 있을 수 있으나, 현재 실패 메시지로는 reject/duplicate/no-op/sequence 미증가 중 무엇인지 확정하기 어렵다.
- QA helper가 `no-state-change`를 실패로 드러내지 않고 `wait`로 삼켜 root cause 확인을 지연시켰다.

### Confirmed root cause

- 테스트 코드상 `rollOutcome.kind === 'no-state-change'`가 `return 'wait'`로 처리되어 click 이후 무변화 상태를 명확한 실패로 보고하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #144/#146/#150에서 roll 이후 자동 진행 관측값과 debug state를 보강했다.
  - Why it failed: 이번 실패는 자동 진행 판정 근거 부족만으로 확정되지 않았고, roll click 이후 상태 변화 자체가 관측되지 않는 경우를 별도 실패로 드러내지 못했다.
- Attempt 2:
  - What was changed: Issue #156에서 playing room 삭제로 인한 lobby 복귀를 막았다.
  - Why it failed: 이번 debug tail은 lobby 복귀가 아니라 game 화면에서 roll 가능 상태가 유지되는 계열이었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.
- `no-state-change`를 단순 wait로 삼켜 전체 timeout까지 반복하지 않는다.

### Correct fix plan

- `rollOutcome.kind === 'no-state-change'`는 클릭 전후 debug state를 포함한 명시적 오류로 처리한다.
- 단일 모바일 QA의 실패 메시지도 기기전 QA처럼 `coverage`, `actionHistory`, debug state를 포함하게 한다.
- 이후에도 실패하면 새 실패 메시지의 before/after debug state를 기준으로 authoritative roll reject, duplicate, sequence 미증가, click target 문제를 구분한 뒤 앱 로직 수정 여부를 판단한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #160 모바일 Game QA move click race 및 roll pending/no-state-change 재발

### Symptom

- PR #159 이후 모바일 Game QA와 모바일 기기전 QA의 실제 게임 상태 머신 액션 진행 단계가 실패했다.
- 한 실패는 `move-piece-button`을 ready로 판단한 뒤 실제 클릭 시점에는 버튼이 disabled 상태로 유지되어 Playwright click timeout이 발생했다.
- 다른 실패들은 윷 던지기 클릭 이후 `roll`, 이동 UI, 자동 진행, terminal state가 관측되지 않아 `no-state-change` 오류로 실패했다.

### Expected behavior

- 이동 버튼이 ready로 관측된 직후 React/원격 액션 상태 전환으로 다시 disabled가 되면 QA helper는 즉시 15초 click timeout으로 고착되지 않고 현재 debug state를 기준으로 재평가해야 한다.
- 윷 던지기 클릭 후 원격 액션 pending/processing 상태가 관측되면 일반 no-state-change와 구분해 제한 시간 안에서 상태 해소를 기다리고, 끝내 해소되지 않을 때는 pending timeout으로 원인을 드러내야 한다.

### Actual behavior

- `playOneAvailableGameAction()`은 poll에서 한 번 `ready`로 판정한 뒤 click 직전 상태가 다시 바뀌는 경합을 충분히 처리하지 못했다.
- `waitForRollOutcomeAfterClick()`은 pending remote/action processing 상태를 별도로 추적하지 않아, 원격 액션 대기 지연과 진짜 no-state-change를 구분하기 어려웠다.

### Reproduction steps

1. 모바일 Game QA 또는 모바일 기기전 QA를 실행한다.
2. 게임 액션 루프 중 이동 버튼 또는 윷 던지기 버튼을 클릭한다.
3. React 상태/Firestore 원격 액션 동기화 타이밍에 버튼 또는 debug state가 transient 상태가 된다.
4. QA helper가 transient disabled click 또는 roll no-state-change/pending 상태를 명확히 구분하지 못해 실패한다.

### Suspected root cause

- 앱 진행 고착으로 확정하기보다는 QA helper가 모바일 WebKit/Firestore 타이밍의 transient button disabled 및 remote action pending 상태를 너무 단일 상태로 판정한 것으로 보인다.

### Confirmed root cause

- `move-piece-button` 클릭 경로에는 ready 판정과 실제 click 사이 버튼 상태 재평가/짧은 실패 복구가 없었다.
- `waitForRollOutcomeAfterClick()`은 debug state의 `rollInProgress`, `pendingLocalRemoteActionCount`, `processingActionCount`를 outcome 판정에 사용하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #158에서 roll no-state-change를 wait로 삼키지 않고 명시적 오류로 드러냈다.
  - Why it failed: 오류는 명확해졌지만 pending/processing 지연과 진짜 no-state-change를 구분하는 판정은 부족했다.
- Attempt 2:
  - What was changed: Issue #130에서 이동 버튼이 사라지는 자동 이동 경합을 `advanced`로 인정했다.
  - Why it failed: 이번 증상은 버튼이 사라지는 경합이 아니라 ready 판정 후 click 시점에 다시 disabled가 되는 경합이었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.
- `no-state-change`와 remote pending timeout을 같은 실패로 뭉개지 않는다.

### Correct fix plan

- 이동 버튼 ready 판정 후 click은 짧은 timeout으로 시도하고, 실패 시 debug state에서 pending/hold 상태가 확인되면 다음 QA tick에서 재평가한다.
- roll outcome 대기는 pending remote/action processing 상태를 관측하면 bounded pending timeout까지 기다리고, 해소되지 않으면 별도 pending timeout 오류를 낸다.
- pending이 전혀 관측되지 않는 click 무변화는 기존처럼 no-state-change 오류로 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [ ] Device-to-device mobile QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #162 모바일 Game QA roll pending-timeout 재발

### Symptom

- PR #161 이후 모바일 Game QA의 `05 실제 게임 상태 머신으로 10개 이상 액션 진행` 단계가 iPad와 Galaxy S24 Ultra에서 실패했다.
- 실패 메시지는 `윷 던지기 클릭 이후 원격 액션 대기 상태가 해소되지 않았습니다`였고, roll 클릭 전 debug state는 game 화면에서 윷 던지기 버튼이 활성화된 상태였다.

### Expected behavior

- 윷 던지기 클릭 후 pending 상태가 잠깐 관측되더라도, 마지막 debug state에서 pending이 이미 해소됐거나 서버 state/sequence 적용이 진행됐다면 QA helper가 이를 무조건 pending timeout으로 분류하면 안 된다.
- pending이 실제로 마지막까지 유지되는 경우에만 pending timeout으로 실패해야 한다.

### Actual behavior

- `waitForRollOutcomeAfterClick()`은 pending을 한 번이라도 관측하면 `sawPendingTurnAction`을 계속 true로 유지했다.
- 이후 마지막 debug state에서 pending이 해소됐는지 확인하지 않고, roll/move UI를 보지 못하면 `pending-timeout`으로 반환할 수 있었다.

### Reproduction steps

1. 모바일 Game QA를 실행한다.
2. 게임 화면에서 활성화된 윷 던지기 버튼을 클릭한다.
3. 클릭 직후 remote/action pending 상태가 일시적으로 관측된다.
4. pending이 해소됐지만 roll/move UI 관측이 sync timing 때문에 늦으면 QA helper가 pending timeout으로 실패할 수 있다.

### Suspected root cause

- 모바일 WebKit/Firestore 타이밍에서 host authoritative roll commit과 subscribe 반영 사이 transient gap이 발생할 수 있다.
- QA helper가 pending을 sticky flag로만 저장하고 마지막 pending 상태 및 state/sequence 증가 여부를 분리하지 않아, 해소된 pending도 pending timeout으로 오분류한 것으로 보인다.

### Confirmed root cause

- `waitForRollOutcomeAfterClick()`의 pending timeout 판정이 `sawPendingTurnAction`만 사용하고 마지막 debug state의 pending 여부를 확인하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #158에서 roll no-state-change를 명시적 오류로 드러냈다.
  - Why it failed: pending 상태와 no-state-change는 구분했지만, pending이 마지막까지 유지됐는지 여부는 분리하지 못했다.
- Attempt 2:
  - What was changed: Issue #160에서 pending remote/action processing 상태를 bounded timeout으로 관측하도록 했다.
  - Why it failed: pending을 한 번 본 뒤 마지막에는 해소된 경우까지 pending timeout으로 분류할 수 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- `roll` 액션마다 무조건 `autoWaited`를 증가시키지 않는다.
- 앱 이동/아이템/함정 로직을 원인 확인 없이 변경하지 않는다.
- 해소된 pending과 마지막까지 유지되는 pending을 같은 실패로 뭉개지 않는다.

### Correct fix plan

- `waitForRollOutcomeAfterClick()`에서 마지막 poll의 pending 여부를 별도로 추적한다.
- pending timeout은 pending을 관측한 적이 있고 마지막 debug state에서도 pending이 유지될 때만 반환한다.
- roll/move UI가 아직 없더라도 state/sequence가 클릭 전보다 증가했다면 별도 `state-advanced` outcome으로 반환해 pending timeout 오분류를 피한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [x] No unrelated UI changes

## 2026-06-30 - Issue #166 모바일 Game QA hasStateAdvancedAcrossPages ReferenceError

### Symptom

- PR #165 병합 후 모바일 Game QA와 모바일 기기전 QA가 실제 게임 상태 머신 액션 진행 단계에서 실패했다.
- 실패 메시지는 `ReferenceError: hasStateAdvancedAcrossPages is not defined`였다.

### Expected behavior

- roll 클릭 이후 roll/move UI가 아직 관측되지 않아도 state/sequence가 진행되면 QA helper가 `state-advanced` outcome으로 처리해야 한다.
- helper 누락 때문에 테스트가 ReferenceError로 중단되면 안 된다.

### Actual behavior

- `waitForRollOutcomeAfterClick()`은 `hasStateAdvancedAcrossPages(beforeDebugStates, lastDebugStates)`를 호출했다.
- 하지만 `tests/game-qa.spec.js`에는 해당 across-pages helper 정의가 없어 ReferenceError가 발생했다.

### Reproduction steps

1. 모바일 Game QA 또는 모바일 기기전 QA를 실행한다.
2. 윷 던지기 클릭 이후 `waitForRollOutcomeAfterClick()`이 timeout 종료부에 도달한다.
3. `hasStateAdvancedAcrossPages()` 호출 시 정의되지 않은 함수 ReferenceError로 테스트가 실패한다.

### Suspected root cause

- Issue #162의 `state-advanced` outcome 계획을 반영하는 과정에서 단일 state helper인 `hasStateAdvanced()`만 존재하고, 여러 페이지 debug state 배열용 wrapper helper가 누락되었다.

### Confirmed root cause

- `hasStateAdvancedAcrossPages()` 호출은 존재하지만 함수 정의가 없었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #162에서 pending timeout 오분류 방지를 위해 `state-advanced` outcome 호출을 추가했다.
  - Why it failed: 호출 대상 across-pages helper 정의가 함께 추가되지 않아 ReferenceError가 발생했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- 앱 게임 로직을 원인 확인 없이 수정하지 않는다.
- undefined helper를 우회하려고 `state-advanced` 판정을 제거하지 않는다.

### Correct fix plan

- 기존 `findCanonicalDebugState()`와 `hasStateAdvanced()`를 재사용하는 최소 `hasStateAdvancedAcrossPages()` wrapper를 추가한다.
- roll outcome 처리, coverage, UI selector, 앱 소스 코드는 변경하지 않는다.

### Verification checklist

- [x] Build succeeds
- [ ] Relevant Playwright QA rerun checked (local Playwright browser executable missing)
- [x] No unrelated UI changes

## 2026-07-01 - Issue #180 모바일 Game QA stale-local-turn-state / pending-remote-action

### Symptom

- PR #179 병합 후 모바일 Game QA의 실제 게임 상태 머신 액션 진행 단계에서 실패했다.
- QA 분류는 `stale-local-turn-state` 또는 `pending-remote-action`으로 나타났다.
- 로컬 화면에는 윷 던지기 버튼이 가능한 상태로 보였지만 authoritative 처리 결과는 `지금은 내 차례가 아닙니다.`였다.

### Expected behavior

- host가 AI 자동 턴을 진행한 뒤 다음 사람 턴의 버튼은 Firestore authoritative 상태 저장이 끝난 뒤 활성화되어야 한다.
- 원격 action은 host의 최신 상태 저장 중에는 처리되지 않고 잠시 retry되어야 한다.

### Actual behavior

- host AI 자동 턴은 로컬 state를 먼저 변경하고 autosave로 Firestore에 반영했다.
- `canSubmitTurnAction` / `canRollNow`는 host autosave pending 상태를 보지 않아, Firestore가 이전 턴인 동안에도 다음 사람 턴 버튼이 활성화될 수 있었다.
- 이 상태에서 `commitAuthoritativeGameAction()`이 Firestore 기준 turnIndex를 검증하면 actor mismatch로 reject되었다.

### Reproduction steps

1. 모바일 Game QA를 실행한다.
2. AI가 포함된 온라인 방에서 AI 자동 턴이 빠르게 진행된다.
3. host local state는 다음 human turn으로 먼저 바뀌지만 Firestore autosave가 아직 완료되지 않은 순간에 윷 던지기를 누른다.
4. authoritative reducer가 Firestore의 이전 turnIndex를 기준으로 `지금은 내 차례가 아닙니다.`를 반환하거나 pending remote action이 해소되지 않는다.

### Suspected root cause

- 모바일 WebKit/CI 타이밍에서 host local AI autoplay와 Firestore autosave, 다음 human authoritative action 사이에 race가 있다.

### Confirmed root cause

- `canSubmitTurnAction`은 `activeSeat`, `isMyTurn`, `winner`, turn-order/intro/moving/trap 상태만 보고 host autosave pending 상태를 차단하지 않았다.
- host의 pending remote action 처리도 저장 중인 local state가 Firestore에 반영되기 전 처리될 수 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #154에서 stale `turnOrderIntro` 차단 조건과 저장 경로를 보강했다.
  - Why it failed: 이번 실패의 debug state는 `activeTurnOrderIntro: false`이며, 실제 원인은 intro 고착이 아니라 AI/local autosave와 authoritative transaction 사이의 race였다.
- Attempt 2:
  - What was changed: Issue #162/#166에서 QA helper의 stale/pending 분류와 state-advanced 판정을 보강했다.
  - Why it failed: 테스트 분류는 정확해졌지만 앱의 host autosave pending guard가 없어 실제 race는 남아 있었다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- UI 구조나 레이아웃을 변경하지 않는다.
- AI/이동 전체를 한 번에 대규모 리팩터링하지 않는다.
- `지금은 내 차례가 아닙니다.` reject를 테스트에서 무시하지 않는다.

### Correct fix plan

- host autosave pending 상태를 렌더 state로 노출한다.
- host autosave pending 중에는 `canSubmitTurnAction`을 차단하고 debug block reason에 `saving-host-state`를 남긴다.
- host가 원격 action을 처리할 때 저장 중인 local state가 있으면 즉시 처리하지 않고 retry한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [x] No unrelated UI changes

## 2026-07-01 - 인게임 효과음 토글 클릭 차단 및 원격 윷 던지기 진행 상태 고착

### Symptom

- 인게임 세로모드에서 효과음 버튼을 눌러도 토글되지 않는 것처럼 보였다.
- 온라인/인게임 윷 던지기가 첫 동작 후 두 번째부터 눌러도 반응하지 않는 상태가 재현될 수 있었다.

### Expected behavior

- 세로모드 헤더의 장식/주변 요소가 효과음 버튼의 탭 이벤트를 막지 않아야 한다.
- 원격 클라이언트가 윷 던지기 요청을 보낸 뒤 서버 상태 동기화가 도착하면 로컬 `rollInProgress` 잠금이 즉시 해제되어 다음 턴에서 다시 던질 수 있어야 한다.

### Actual behavior

- `.hero::after` 장식 pseudo-element에 `pointer-events: none`이 없어 헤더 우측/하단 영역의 클릭을 가로챌 수 있었다.
- 비방장 원격 클라이언트의 윷 던지기 성공 경로는 서버 state sync 후 `pendingLocalRemoteActionsRef`만 비우고 `rollInProgressRef`/`rollInProgress`를 해제하지 않았다.
- 이동 후 `roll`이 사라진 다음에도 stale `rollInProgress`가 남으면 `canRollNow`가 막혀 다음 윷 던지기가 12초 watchdog 전까지 비활성/무반응처럼 보일 수 있었다.

### Suspected root cause

- 세로모드 자체가 원인이 아니라 헤더 pseudo-element의 pointer event와 원격 roll 진행 상태 해제 누락이 원인이다.

### Confirmed root cause

- `src/styles/globals.css`의 `.hero::after`가 절대 위치 장식 요소인데 pointer event를 명시적으로 끄지 않았다.
- `src/app/App.tsx`의 `subscribeGameState()` 동기화 경로에서 서버 state를 적용하면서 `pendingLocalRemoteActionsRef.current.clear()`만 호출하고 roll 진행 ref/state는 초기화하지 않았다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 효과음 버튼 자체에 `position: relative`, `z-index`, `pointer-events: auto`만 추가했다.
  - Why it failed: 실제로 클릭을 가로챌 수 있는 헤더 pseudo-element의 pointer event를 제거하지 못했다.
- Attempt 2:
  - What was changed: 원격 action key에 `lastAppliedSequenceRef.current`를 포함했다.
  - Why it failed: 중복 clientActionId 가능성은 줄였지만, 서버 state sync 후 stale `rollInProgress`가 남는 직접 원인은 해결하지 못했다.

### Do not try again

- 효과음 버튼 z-index만 계속 올리지 않는다.
- 윷 던지기 action key만 바꾸면서 `rollInProgress` 해제 경로를 방치하지 않는다.
- Playwright timeout만 늘리지 않는다.

### Correct fix plan

- `.hero::after`에는 `pointer-events: none`을 부여하고, 실제 헤더 액션 그룹은 장식보다 위 레이어로 둔다.
- 서버 game state sync가 적용되면 원격 action pending뿐 아니라 stale roll 진행 ref/state도 함께 해제한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile browser portrait tap target checked
- [ ] Relevant Playwright QA rerun checked (local Playwright browser executable missing)
- [x] No unrelated UI redesign

## 2026-07-01 - 방장 첫 번째 플레이어 두 번째 윷 던지기 무반응

### Symptom

- 방장이자 첫 번째 플레이어인 사용자가 첫 윷 던지기와 이동 이후 다시 자기 차례가 되었을 때 윷 던지기 버튼을 눌러도 반응하지 않을 수 있었다.

### Expected behavior

- 기존 윷 결과가 이동 처리로 정리되면 진행 중인 윷 던지기 잠금도 함께 정리되어 다음 윷 던지기를 즉시 요청할 수 있어야 한다.

### Actual behavior

- `clearRoll()`은 `roll`과 `rollResultReadyAt`만 비우고 `rollInProgressRef`/`rollInProgressStartedAtRef`/`rollInProgress`는 정리하지 않았다.
- 방장 클라이언트의 `canRollNow`는 `!rollInProgress`를 요구하므로, stale 진행 잠금이 남으면 `roll`이 이미 없어도 다음 클릭이 막혔다.

### Confirmed root cause

- 윷 결과 정리 함수인 `clearRoll()`에서 윷 던지기 진행 잠금을 함께 해제하지 않아, 방장 로컬 상태에 stale `rollInProgress`가 남을 수 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 원격 클라이언트 state sync 경로에서 `rollInProgress`를 해제했다.
  - Why it failed: 방장 로컬 `clearRoll()` 경로에서 남는 stale lock은 직접 해제하지 못했다.

### Do not try again

- 윷 던지기 action key만 바꾸지 않는다.
- Playwright timeout만 늘리지 않는다.
- 버튼 UI만 활성화된 것처럼 보이게 하지 않는다.

### Correct fix plan

- `clearRoll()`이 `roll`을 비울 때 `rollInProgressRef`, `rollInProgressStartedAtRef`, React `rollInProgress` state를 같이 초기화한다.

### Verification checklist

- [x] Build succeeds
- [ ] Local Playwright QA checked (browser executable missing)
- [x] No unrelated UI redesign

## 2026-07-01 - 방장 두 번째 플레이어 윷 던지기 무반응

### Symptom

- 다른 사람 턴에는 윷 던지기 버튼이 비활성화되고 내 턴에는 활성화되지만, 방장인 사용자가 두 번째 플레이어/승계된 방장 상태일 때 버튼을 눌러도 윷 결과가 진행되지 않을 수 있었다.

### Expected behavior

- 현재 사용자의 uid가 `room.hostId`와 같으면 `isRoomHost` 상태가 늦거나 틀려도 host authoritative action 처리 경로를 사용해야 한다.
- 방장 클라이언트는 자기 턴 윷 던지기를 원격 action queue에만 넣고 기다리면 안 된다.

### Actual behavior

- 버튼 활성화는 `activeSeat.id === localSeatId`와 `canSubmitTurnAction`을 기준으로 정상 동작했다.
- 하지만 온라인 action 처리 경로는 `isRoomHost` state만 기준으로 host/remote client를 나눴다.
- 방장 승계/복구 타이밍에서 실제 `room.hostId === currentUserId`인데 `isRoomHost` state가 아직 false이면, 방장 클라이언트가 자기 윷 던지기를 `submitRemoteAction()`으로만 등록하고 직접 처리하지 않았다.

### Confirmed root cause

- 실제 방장 여부를 나타내는 `room.hostId/currentUserId` 판정과 action 처리에 쓰이는 `isRoomHost` state 판정이 분리되어 있었다.
- `canRollNow`는 이미 true가 될 수 있으므로 버튼 상태가 아니라 클릭 후 host authoritative 처리 경로 선택이 문제였다.

### Previous failed attempts

- Attempt 1:
  - What was changed: 좌석의 `isHost` 표시를 `room.hostId` 기준으로 바꿨다.
  - Why it failed: 버튼 활성/비활성 문제로 가정했지만, 실제 문제는 클릭 후 `isRoomHost`만 보고 remote action client 경로로 빠지는 것이었다.

### Do not try again

- 윷 던지기 버튼 disabled 조건만 바꾸지 않는다.
- 좌석 `isHost` 표시만 바꾸고 action 처리 경로의 host 판정을 방치하지 않는다.
- Playwright timeout만 늘리지 않는다.

### Correct fix plan

- `room.hostId === currentUserId`를 포함한 effective host 판정 값을 만든다.
- 윷 던지기/말 이동/원격 action 처리/host autosave/AI 진행/순서 정리 등 host 권한이 필요한 실행 경로는 effective host 판정을 사용한다.
- 기존 UI의 내 턴 판정은 유지한다.

### Verification checklist

- [x] Build succeeds
- [ ] Multi-client Firebase manual check
- [x] No unrelated UI redesign

## 2026-07-01 - Issue #216 모바일 Game QA stale-local-turn-state 재발

### Symptom

- Issue #216에서 모바일 Game QA의 실제 게임 상태 머신 액션 진행 단계가 `stale-local-turn-state`로 실패했다.
- 디버그 상태에서는 `canRollNow: true`, `rollActionBlockReasons: []`였지만 메시지는 `지금은 내 차례가 아닙니다.`로 남았다.

### Expected behavior

- host 로컬 상태 저장이 Firestore authoritative state에 반영되기 전에는 다음 윷 던지기/원격 action이 진행 가능한 것처럼 표시되면 안 된다.
- autosave sequence mismatch가 발생하면 stale local turn state로 계속 진행하지 말고 최신 sequence 기준으로 저장을 재시도해야 한다.

### Actual behavior

- `saveGameState()`는 `expectedPreviousSequence` mismatch 시 `null`만 반환했다.
- App의 host autosave effect는 저장 결과가 `null`이어도 `finally`에서 저장 pending key를 해제했다.
- 그 결과 실제 저장이 반영되지 않은 로컬 상태에서도 `hasPendingHostStateSave`가 false가 되어 윷 던지기 guard가 통과할 수 있었다.

### Reproduction steps

1. 모바일 Game QA를 실행한다.
2. host 로컬 AI/autosave 진행 중 Firestore sequence가 먼저 증가하거나 subscribe 반영이 늦어진다.
3. host autosave가 오래된 `expectedPreviousSequence`로 저장을 시도해 mismatch가 발생한다.
4. pending save 표시가 해제된 로컬 화면에서 다음 사람 턴 윷 던지기를 클릭한다.
5. authoritative reducer가 Firestore 기준 turnIndex로 검증하며 `지금은 내 차례가 아닙니다.`를 반환한다.

### Suspected root cause

- Issue #180의 host autosave pending guard 보강 이후에도 autosave 실패/sequence mismatch 결과 자체를 성공과 구분하지 못해 pending guard가 너무 빨리 해제될 수 있었다.

### Confirmed root cause

- `saveGameState()`가 sequence mismatch와 duplicate/commit success를 구분해 반환하지 않았다.
- autosave 호출부가 성공한 저장의 `lastSequence`를 `lastAppliedSequenceRef`에 반영하지 않아 다음 저장이 오래된 expected sequence로 반복될 수 있었다.
- subscribe는 이미 적용한 version 이하의 snapshot을 즉시 무시해, 더 최신 `lastSequence`만 보정할 기회도 놓칠 수 있었다.

### Previous failed attempts

- Attempt 1:
  - What was changed: Issue #180에서 host autosave pending 상태를 guard에 연결해 저장 중에는 `saving-host-state`로 차단했다.
  - Why it failed: 저장 pending 중인 경우는 차단했지만, 저장이 sequence mismatch로 실패한 뒤 pending key가 해제되는 경로는 막지 못했다.
- Attempt 2:
  - What was changed: QA helper가 authoritative turn mismatch를 `stale-local-turn-state`로 분류하도록 보강했다.
  - Why it failed: 테스트 분류는 정확해졌지만 앱의 autosave 결과 처리와 sequence ref 보정은 부족했다.

### Do not try again

- Playwright timeout만 늘리지 않는다.
- `지금은 내 차례가 아닙니다.` reject를 테스트에서 무시하지 않는다.
- UI 구조나 버튼 disabled 조건만 임의로 바꾸지 않는다.
- 저장 결과를 성공/실패 구분 없이 단순 truthy version으로 처리하지 않는다.

### Correct fix plan

- `saveGameState()`가 `committed`, `duplicate`, `sequence_mismatch`, `unavailable` 상태와 `turnVersion`, `lastSequence`를 반환하게 한다.
- autosave 성공/duplicate일 때만 saved fingerprint를 갱신하고, 반환된 `lastSequence`를 `lastAppliedSequenceRef`에 반영한다.
- sequence mismatch가 발생하면 최신 sequence를 반영한 뒤 autosave를 재시도한다.
- 이미 적용한 version 이하의 snapshot이라도 더 최신 `lastSequence`는 반영한다.

### Verification checklist

- [x] Build succeeds
- [ ] Mobile Game QA rerun checked
- [x] No unrelated UI changes
