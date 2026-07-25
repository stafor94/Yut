# QA architecture

## 목적

Main Branch QA의 실행 목록과 병렬 설정을 한 곳에서 관리하고, 제품 변경 때 테스트 파일·npm script·runner·workflow에 같은 정보를 반복 추가하지 않도록 한다.

## 단일 실행 기준

`tests/qa/suite-manifest.mjs`가 Main Branch QA lane의 단일 실행 기준이다.

- 테스트 파일 또는 디렉터리
- Playwright project
- worker 수
- timeout 및 grep 조건
- Firebase browser isolation spec
- 의도적으로 여러 browser lane에서 공유하는 target

Playwright project의 `testMatch`와 project 내부 병렬 실행 계약은 `tests/qa/project-contracts.mjs`에서 관리한다. 실제 CLI 인자는 `tests/qa/playwright-command.mjs`에서 생성한다. `playwright.config.js`와 architecture validator가 같은 계약을 사용하므로 manifest에 등록했지만 실제 project에서 누락되는 상태를 방지한다.

`package.json`, `tests/helpers/run-qa-emulator-suite.mjs`, `.github/workflows/qa.yml`에 spec 경로를 중복해서 작성하지 않는다.

## 테스트 추가 절차

1. 기존 기능 영역의 spec에 추가할지 새 spec으로 분리할지 결정한다.
2. 실제 제품 동작과 같은 Firebase Auth·Firestore 흐름이 필요하면 emulator lane에 둔다.
3. 대상 파일 또는 디렉터리를 `suite-manifest.mjs`의 정확한 lane에 한 번만 등록한다.
4. 동일 spec을 여러 browser lane에서 의도적으로 실행해야 하면 관련 모든 suite의 `sharedTargets`에 명시한다.
5. suite별 `grep` 또는 `grepInvert`가 브라우저 isolation과 대상 test title을 실제로 포함하는지 확인한다.
6. 해당 Playwright project의 `testMatch`, 브라우저, viewport와 `fullyParallel` 값을 `project-contracts.mjs`와 `playwright.config.js`에서 확인한다.
7. `npm run qa:validate-architecture`를 실행한다.
8. 생성된 `test-results/qa-architecture-report.json`에서 spec → lane → project 연결을 확인한다.
9. 변경된 lane을 실행하고 테스트가 실제 목록에 포함됐는지 로그에서 확인한다.

## Lane 계약

- `online-core`: 방 생성·참가·게임 시작·presence·room lifecycle 등 온라인 핵심 흐름
- `desktop-sequence`: sequence replay, pending/result-hold, 이동 연출처럼 짧은 중간 상태를 관찰하는 timing-sensitive desktop 회귀
- `desktop-regression`: 윷 던지기·이동·연출·로비의 나머지 desktop 회귀
- `mobile-galaxy`: Galaxy Chromium viewport의 레이아웃·로비·대기실·순서·결과 표시 QA
- `mobile-galaxy-timing`: 화면 좌표·pointer capture·취소·서버 제출을 검증하는 Galaxy Chromium timing QA
- `safari-visible-mismatch`: 화면 좌표와 animation timeline을 의도적으로 불일치시키는 단일 WebKit 회귀
- `safari-timing`: 나머지 실제 pointer release·취소 WebKit 회귀

Galaxy와 Safari 계열은 별도 GitHub Actions matrix entry로 실행한다. Chromium과 WebKit을 한 runner에서 순차 실행하지 않는다. 각 lane은 고유 `QA_RUN_ID`, `QA_PROJECT_ID`, room namespace와 cleanup 범위를 사용한다.

`desktop-sequence`는 `bug-history-smoke.spec.js`를 1 worker에서 독립 실행한다. 해당 spec은 3D 렌더링과 짧은 pending·result-hold·move 시작 상태를 연속 관찰하므로 다른 장시간 browser context와 worker를 공유하지 않는다. 테스트 assertion이나 timeout을 완화하지 않고 runner 격리로 관찰 경쟁을 제거한다.

`mobile-galaxy`와 `mobile-galaxy-timing`은 각각 `desktop-chromium` project에서 Firebase browser isolation spec을 실행하고 `mobile-galaxy` project에서 담당 모바일 spec을 실행한다. Run `30178219787`에서 전체 26건은 성공했지만 pointer 4건이 각각 31~37초로 lane의 마지막 실행 꼬리를 형성해 전체 job이 284.2초가 됐다. 테스트 삭제·timeout 완화 대신 pointer spec을 독립 runner로 분리해 두 범위를 동시에 실행한다.

`mobile-webkit-timing` project는 `fullyParallel: true`를 유지한다. 화면 NICE 위치와 보고된 timeline PERFECT를 강제로 불일치시키는 시나리오는 Run `30162254392`에서 다른 WebKit test와 동일 runner CPU를 공유할 때 측정 뒤 실제 `pointerup` 전 프레임이 GOOD으로 이동했으므로 `safari-visible-mismatch` 1-worker runner에서 isolation spec과 함께 실행한다. `safari-timing`은 해당 title을 `grepInvert`로 제외하고 나머지 세 pointer 시나리오를 3 workers에 분산한다. 테스트의 화면 release 등급 의미와 서버 제출 assertion은 유지한다.

Safari·Galaxy pointer 회귀는 CSS 애니메이션의 특정 프레임을 맞히는 테스트가 아니라 화면에 배치된 구슬 위치에서 release했을 때 같은 등급이 서버 제출 경로에 전달되는지를 검증한다. Run `30163126624`의 WebKit과 Run `30177639266`의 Galaxy Chromium은 `requestAnimationFrame`을 240회 관찰해도 목표 구간을 건너뛰었다. 따라서 WAAPI animation을 pause한 뒤 첫 iteration의 `currentTime`을 이진 탐색하고, 매 단계의 실제 `getBoundingClientRect()`를 읽어 GOOD·NICE·PERFECT 내부 구간에 구슬을 확정한다. timeout 증가, playback rate 조정, 프레임 수 증가는 사용하지 않는다.

현재 앱 shell은 시작 시 Firebase Auth·Firestore 초기화를 수행한다. 따라서 DOM·레이아웃 중심 spec도 별도의 검증된 Firebase-free bootstrap이 생기기 전까지 emulator lane에서 유지한다. 단순 속도 개선을 위해 제품 초기화 계약을 mock으로 대체하지 않는다.

## Helper 규칙

- 방 생성·게임 시작·턴 준비 같은 반복 흐름은 `tests/helpers`의 공통 helper를 우선 사용한다.
- 테스트 파일에서 QA room metadata와 cleanup 범위를 새로 구현하지 않는다.
- 새로운 전역 `window.__YUT_QA_*`를 임의로 추가하지 않는다. 기존 QA runtime 진입점을 재사용하거나 공통 helper에 계약을 추가한다.
- 고정 sleep보다 실제 완료 조건을 `expect.poll`, locator assertion으로 기다린다.
- timeout 증가는 실제 제품 계약상 필요한 대기인지 확인하고 테스트에 사유를 남긴다.
- 하나의 helper가 화면 이동·Firebase 조작·assertion을 모두 새로 담당하지 않도록 기존 책임별 helper에 기능을 추가한다.

## 병렬 안전성

- QA 방 이름 계약은 `tests/qa/namespace.mjs`에서 관리하며 run, project, test id, worker, retry, 호출 sequence가 반영돼야 한다.
- lane 실행 중 하위 suite별 전체 cleanup을 실행하지 않는다.
- cleanup은 lane 시작 전과 종료 후에만 전체 namespace를 대상으로 수행한다.
- 각 spec의 `afterEach` cleanup은 자신이 만든 room만 삭제한다.
- worker 수는 manifest에서만 조정하며 최대 4로 제한한다.
- cleanup 병렬 삭제는 환경 변수로 제한하며 최대 8을 넘기지 않는다.
- 서로 다른 matrix lane의 room과 Firebase project를 공유하지 않는다.

### 검증된 worker 예산

- `online-core`: 2 workers
- `desktop-sequence`: 1 worker
- `desktop-regression`: 2 workers
- `mobile-galaxy`: 3 workers
- `mobile-galaxy-timing`: 3 workers
- `safari-visible-mismatch`: 1 worker
- `safari-timing`: 3 workers

온라인·일반 desktop lane은 여러 브라우저 context, Firebase polling, 3D 애니메이션을 동시에 사용한다. 4 workers에서는 브라우저가 진행되는 동안 테스트 프로세스가 지연되어 순서 정하기 준비 상태와 pending roll stage 같은 실제 중간 화면을 놓치는 회귀가 확인됐다. assertion 삭제나 timeout 증가로 숨기지 않고 검증된 자원 범위로 제한한다.

`desktop-sequence`는 1 worker를 고정한다. Run `30160293177`에서 `bug-history-smoke`가 다른 desktop 테스트와 2-worker runner를 공유하는 동안 2초 move 시작 상태를 놓쳤으므로, 동일 파일을 별도 runner에 격리해 전체 workflow 병렬성은 유지하고 파일 내부 관찰 순서는 보장한다.

Galaxy timing과 Safari 계열은 같은 pointer spec을 서로 다른 browser lane에서 실행하므로 `sharedTargets`를 세 lane 모두에 선언한다. `safari-visible-mismatch`의 `grep`은 browser isolation과 강제 불일치 test만 포함해야 하고, `safari-timing`의 `grepInvert`는 같은 강제 불일치 title을 제외해야 한다. 각 test는 고유 browser context·room을 사용하고 화면 위치를 결정적으로 확정한다. 변경된 병렬 구성은 최소 3회 연속 실행해 화면 release 등급, room 잔존, Firebase 요청 오류와 p95 시간을 확인한다.

## 성능 예산

`.github/scripts/validate-qa-performance.mjs`가 각 runner의 첫 단계부터 artifact 수집 직전까지의 전체 job 시간과 workflow 시작부터 summary 예상 완료까지의 시간을 검증한다. Playwright 테스트 내부 시간만 합산한 `qa-duration.json`은 진단용으로 유지하지만 설치·빌드·emulator 시작 비용을 제외하므로 성능 합격 판정에는 사용하지 않는다.

- 전체 Main Branch QA 목표: 300초
- summary 완료 여유: 10초
- Build and unit: 90초
- Online core: 270초
- Desktop sequence replay: 225초
- Desktop regression: 295초
- Mobile Galaxy: 240초
- Mobile Galaxy timing: 240초
- Safari visible mismatch: 195초
- Safari timing: 250초

Run `30178219787`은 모든 기능 QA가 성공했고 workflow 시작부터 성능 검증까지 304.5초였다. Safari timing 전체 job은 232.9초로 기능 실패 없이 기존 225초 예산만 초과했다. Safari 예산은 실측 설치·WebKit 실행 비용을 반영해 250초로 보정하되 전체 300초 제한은 유지한다. Galaxy는 pointer 분리 후 각 lane이 240초를 넘으면 성능 회귀로 차단한다.

각 lane은 `qa-job-timing.json`을 artifact에 남기고 summary job은 `qa-performance.json`, `qa-performance.md`를 생성한다. 보고서 누락, GitHub Run 시작 시각 조회 실패, lane 예산 초과, 전체 5분 목표 초과는 모두 필수 QA 실패로 처리한다. 성능 예산을 늘릴 때는 느려진 원인과 최근 성공 Run의 실제 시간을 먼저 검토한다.

## Pages 배포 분리

`Main Branch QA`는 build, unit, Firebase emulator QA와 결과 요약까지만 담당한다. GitHub Pages 환경 승인·직렬화·deployment queue가 길어져도 QA workflow의 terminal conclusion과 자동 실패 이슈 처리가 막히지 않아야 한다.

`.github/workflows/deploy-pages.yml`은 성공한 `Main Branch QA`의 `workflow_run` 이벤트만 받는다. 다음 조건을 모두 만족할 때 triggering Run의 `build-and-unit` artifact를 Run ID로 고정해 다운로드하고 배포한다.

- conclusion이 `success`
- event가 `push`
- head branch가 `main`
- artifact source가 `github.event.workflow_run.id`

Pages workflow는 별도 concurrency group을 사용하고 새 배포가 시작되면 오래된 대기 배포를 취소한다. QA workflow에 `github-pages` environment, `actions/deploy-pages`, Pages 결과 의존성을 다시 넣지 않는다.

## 자동 구조 검증

`npm run qa:validate-architecture`는 다음을 차단한다.

- manifest target 또는 browser isolation spec 누락
- 존재하지 않는 spec·directory
- 선택된 Playwright project의 `testMatch`에 포함되지 않는 spec
- 동일 lane/project에서 같은 spec 중복 실행
- 명시적 `sharedTargets` 계약이 없는 lane 간 target 중복
- `package.json`의 legacy `test:qa-*` 목록 재도입
- runner의 spec 경로 또는 legacy suite map 하드코딩
- manifest와 runner CLI의 worker·project·target·grep 연결 불일치
- 한 suite의 `grep`과 `grepInvert` 동시 사용
- project별 `fullyParallel` 계약 누락 또는 Playwright config 직접 하드코딩
- 전역 `fullyParallel: true` 재도입
- QA matrix의 build 선행 의존성 재도입
- `firebase-tools@latest` 재도입
- workflow matrix lane·label·artifact code·browser·duration artifact 연결 누락
- desktop sequence, Galaxy timing 또는 Safari lane summary 결과 누락
- Galaxy와 Safari 계열의 순차 job 재결합
- lane 전체 시간 artifact, 5분 성능 예산 검증 또는 필수 실패 연결 누락
- Main Branch QA에 Pages 배포 또는 Pages 결과 의존성 재결합
- 별도 Pages workflow의 성공 QA·main·push·triggering Run artifact 계약 누락

## 변경 검토 체크리스트

- 테스트 파일 → manifest → runner → workflow matrix → Playwright project 연결 확인
- 신규·수정 테스트가 의도한 Chromium/WebKit과 viewport에서 실행되는지 확인
- suite별 grep 결과가 누락·중복 없이 실제 test title을 분리하는지 확인
- 기존 browser isolation 검증이 각 lane에서 유지되는지 확인
- 기존 테스트 범위와 browser execution이 줄지 않았는지 확인
- 의도적인 lane 간 중복 target이 `sharedTargets`로 선언됐는지 확인
- timing-sensitive desktop spec이 독립 1-worker lane에 유지되는지 확인
- project 내부 병렬화 대상이 고유 context·room·cleanup을 사용하는지 확인
- production Firebase 설정이 QA에 유입되지 않는지 확인
- QA room 잔존과 다른 worker·lane room 삭제가 없는지 확인
- lane별 `qa-duration.json`, `qa-job-timing.json`과 workflow 시작→summary 완료 시간을 이전 Run과 비교
- 성능 예산 검증이 필수 실패 조건에 연결됐고 전체 시간이 5분 이내인지 확인
- Galaxy, Galaxy timing과 두 Safari lane이 서로 다른 runner에서 실제 동시 실행됐는지 확인
- Main Branch QA terminal 결과와 별도 Pages deployment 결과를 구분해 확인
