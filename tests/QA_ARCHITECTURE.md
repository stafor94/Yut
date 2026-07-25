# QA architecture

## 목적

Main Branch QA의 실행 목록과 병렬 설정을 한 곳에서 관리하고, 제품 변경 때 테스트 파일·npm script·runner·workflow에 같은 정보를 반복 추가하지 않도록 한다.

## 단일 실행 기준

`tests/qa/suite-manifest.mjs`가 Main Branch QA의 단일 실행 기준이다.

- 테스트 파일 또는 디렉터리
- Playwright project
- worker 수
- timeout 및 grep 조건
- Firebase browser isolation guard 실행 여부

`package.json`, `tests/helpers/run-qa-emulator-suite.mjs`, `.github/workflows/qa.yml`에 spec 경로를 중복해서 작성하지 않는다.

## 테스트 추가 절차

1. 기존 기능 영역의 spec에 추가할지 새 spec으로 분리할지 결정한다.
2. 실제 제품 동작과 같은 Firebase Auth·Firestore 흐름이 필요하면 emulator lane에 둔다.
3. 대상 파일 또는 디렉터리를 `suite-manifest.mjs`의 정확한 lane에 한 번만 등록한다.
4. 해당 Playwright project의 `testMatch`, 브라우저, viewport를 확인한다.
5. `npm run qa:validate-architecture`를 실행한다.
6. 변경된 lane을 실행하고 테스트가 실제 목록에 포함됐는지 로그에서 확인한다.

## Lane 계약

- `online-core`: 방 생성·참가·게임 시작·presence·room lifecycle 등 온라인 핵심 흐름
- `desktop-regression`: 윷 던지기·이동·연출·로비 desktop 회귀
- `mobile-galaxy`: Galaxy viewport 전체 모바일 QA와 WebKit 타이밍 입력 QA

모바일 lane은 하나의 Playwright invocation에서 `mobile-galaxy`와 `mobile-webkit-timing` project를 함께 실행한다. project별 `testMatch`가 실제 브라우저 실행 범위를 결정한다.

## Helper 규칙

- 방 생성·게임 시작·턴 준비 같은 반복 흐름은 `tests/helpers`의 공통 helper를 우선 사용한다.
- 테스트 파일에서 QA room metadata와 cleanup 범위를 새로 구현하지 않는다.
- 새로운 전역 `window.__YUT_QA_*`를 임의로 추가하지 않는다. 기존 QA runtime 진입점을 재사용하거나 공통 helper에 계약을 추가한다.
- 고정 sleep보다 실제 완료 조건을 `expect.poll`, locator assertion으로 기다린다.
- timeout 증가는 실제 제품 계약상 필요한 대기인지 확인하고 테스트에 사유를 남긴다.

## 병렬 안전성

- QA 방 이름에는 run, project, test id, worker, retry가 반영돼야 한다.
- lane 실행 중 다른 하위 suite cleanup을 실행하지 않는다.
- cleanup은 lane 시작 전과 종료 후에만 전체 namespace를 대상으로 수행한다.
- 각 spec의 `afterEach` cleanup은 자신이 만든 room만 삭제한다.
- worker 수는 manifest에서만 조정하며 최대 4로 제한한다.

## 변경 검토 체크리스트

- 테스트 파일 → manifest → runner → workflow matrix → Playwright project 연결 확인
- 신규·수정 테스트가 의도한 Chromium/WebKit과 viewport에서 실행되는지 확인
- 기존 테스트 수가 줄지 않았는지 확인
- production Firebase 설정이 QA에 유입되지 않는지 확인
- QA room 잔존과 다른 worker room 삭제가 없는지 확인
- lane별 실행 시간과 전체 임계 경로를 이전 Run과 비교
