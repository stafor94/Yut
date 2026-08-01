# 2026-08-02 - local move ownership 후속 TypeScript build 실패

## Symptom

- PR #1310 병합 SHA `2dfb5b2`의 Main Branch QA에서 `Build and unit tests`와 모든 QA shard가 제품 테스트 진입 전에 build 단계에서 실패했다.
- 오류는 `useAuthoritativeGameSyncController.ts`가 공통 authoritative action union을 `prepareLocalMoveOwnership()`에 전달할 때 발생했다.

## Confirmed root cause

- `prepareLocalMoveOwnership()`는 런타임에서 `action.type !== 'move_piece'`를 검사하지만 입력 타입을 `type: 'move_piece'`로만 선언했다.
- 호출부의 `CommittableGameAction`은 객체 discriminated union이 아니라 `type` 속성이 여러 action literal의 union인 구조여서 호출 전 narrowing이 유지되지 않았다.
- 제품 상태 소유권 로직이나 reducer 결과 문제가 아니라 함수 입력 타입 경계가 실제 호출 계약보다 좁은 compile 오류였다.

## Fix

- 입력 타입의 `type`을 공통 action을 받을 수 있도록 넓힌다.
- 함수 내부의 `move_piece` 런타임 guard와 coordinator/automation 제외 조건은 유지한다.
- non-move action union이 local move ownership을 생성하지 않는 compile/runtime 회귀 테스트를 추가한다.

## Do not try again

- 타입 오류를 해결하기 위해 호출부마다 강제 캐스팅을 추가하지 않는다.
- `move_piece` 런타임 guard를 제거하거나 reducer에 non-move action을 전달하지 않는다.
- build 실패 상태에서 unit/Playwright가 실행된 것으로 간주하지 않는다.
