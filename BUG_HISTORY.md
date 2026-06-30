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
