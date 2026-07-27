# BUG_HISTORY.md

This file records repeated bugs, failed fixes, root causes, and approaches that must not be repeated.

The complete history recorded through 2026-07-26 is preserved without modification in [`BUG_HISTORY_ARCHIVE_2026-07-26.md`](./BUG_HISTORY_ARCHIVE_2026-07-26.md). New repeated-bug entries are recorded here so the currently active constraints remain reviewable.

---

## 2026-07-27 - 윷 던지기 pointerdown 위치와 결과 판정 불일치 세 번째 재발

### Symptom

- 첨부 영상 `1000075200.mp4`는 1080×2340, 약 120fps, 3.92초다.
- 약 0.47초에 터치 표시가 처음 나타날 때 오브 중심은 약 40%로 Good/Nice 경계이며 Perfect 구간 45~55% 밖이다.
- 터치 이후 라이브 오브는 계속 움직여 약 55%까지 이동했다.
- 약 0.71초에 roll-stage가 나타날 때 result hold 오브는 약 46%로 되돌아갔다.
- 최종 결과는 `PERFECT`로 표시됐다.
- 같은 입력에서 실제 pointerdown 위치, 마지막 라이브 위치, result hold/판정 위치가 서로 달랐다.

### Expected behavior

- 유효한 primary `pointerdown` 직전 마지막으로 실제 렌더링된 오브 위치가 authoritative 입력 snapshot이어야 한다.
- pointerdown 직후 live 오브가 즉시 고정되고, 오래 누르더라도 위치와 판정이 변하지 않아야 한다.
- live freeze, result hold, action payload, authoritative sequence/patch, RollStage 최종 등급은 하나의 immutable snapshot을 사용해야 한다.
- 버튼 밖 pointerup과 pointercancel은 제출하지 않고 멈춘 phase와 진행 방향에서 자연스럽게 재개해야 한다.

### Actual behavior

- `RollTimingControl`은 pointerdown에서 pointerId와 resetKey만 저장하고 pointerup에서 위치를 새로 측정해 제출했다.
- CSS compositor animation이 오브 transform을 소유하면서 JavaScript도 computed transform 읽기, inline transform 쓰기, animation cancel을 수행했다.
- Android/Samsung Internet에서 화면에 scanout된 합성 프레임과 메인 스레드가 읽은 computed transform 및 cancel 반영 시점이 달라 live 오브와 result hold가 다른 위치를 표시할 수 있었다.
- snapshot 안의 `positionPercent`, `trackOffsetPx`, `frozenTransform`이 서로 다른 표시·판정 경로에 사용돼 단일 기준이 아니었다.
- 기존 QA는 Good에서 누른 뒤 Perfect에서 손을 떼면 Perfect가 되는 pointerup 계약을 정상 동작으로 고정했다.

### Confirmed root cause

- 제품의 authoritative 입력 시점이 사용자가 인식하는 pointerdown이 아니라 pointerup이었다.
- CSS compositor와 JavaScript가 동시에 transform 위치 소유자로 동작했다.
- `getComputedStyle()`은 사용자가 마지막으로 본 scanout 프레임을 보장하지 않으며, compositor animation 진행과 메인 스레드 animation cancel 사이에는 모바일 브라우저별 반영 지연이 존재한다.
- 제출 percent와 표시 transform이 하나의 canonical 값에서 파생되지 않았다.

### Previous failed attempts

- PR #1130:
  - What was changed: CSS animation은 유지하고 requestAnimationFrame에서 화면 위치를 관찰했다.
  - Why it failed: 메인 스레드가 지연되면 rAF 관찰 snapshot과 compositor가 실제 표시한 프레임이 다시 갈라졌다. 위치 소유자는 여전히 CSS compositor였다.
- PR #1134:
  - What was changed: pointerup에서 computed transform을 읽고 inline transform으로 고정한 뒤 animation을 취소했다.
  - Why it failed: pointerup을 authoritative 입력으로 계속 사용했고 computed transform이 실제 scanout과 같다고 가정했다. 합성 프레임이 더 진행한 뒤 다른 위치로 되돌아가는 문제를 막지 못했다.
- 커밋 `998b6e2`, `91e0068`, `741bde6` 계열:
  - What was changed: local rAF transform writer를 도입했다가 기존 CSS animation 계약 테스트를 맞추기 위해 compositor animation을 다시 활성화했다.
  - Why it failed: CSS animation과 JavaScript rAF가 다시 동시에 transform을 써 단일 위치 소유 계약이 깨졌다.

### Do not try again

- pointerup 시점에 DOM 좌표, computed transform, Web Animations timeline을 다시 측정해 authoritative 위치를 만들지 않는다.
- CSS compositor animation과 JavaScript rAF가 동시에 `.roll-timing-orb-track` transform을 쓰게 하지 않는다.
- rAF writer를 도입한 뒤 과거 CSS animation 계약 테스트를 통과시키기 위해 `animation: roll-timing-orb-track ...`을 다시 활성화하지 않는다.
- 화면 위치, result hold, 제출 위치를 각각 px offset 또는 transform 문자열로 별도 저장하지 않는다.
- 실제 모바일 합성 지연을 재현하지 못하는 동일-task `animation.currentTime` 조작만으로 회귀가 해결됐다고 판단하지 않는다.
- assertion 삭제, skip 확대, 무근거 timeout 증가, 성능 예산 완화로 통과시키지 않는다.

### Correct fix plan

- `RollTimingControl`의 leaf-level requestAnimationFrame 루프 하나만 오브 transform을 기록한다.
- 기존 2초 왕복 `getRollTimingPositionPercent()` 계산을 재사용하고 React state는 프레임마다 갱신하지 않는다.
- 각 rAF가 `{ phaseMs, positionPercent, capturedAt, resetKey }` immutable snapshot을 저장한다.
- 표시 transform은 canonical `positionPercent`에서만 파생하고 frozen transform 문자열을 authoritative 값으로 저장하지 않는다.
- primary left-button pointerdown에서 다음 rAF를 취소하고 마지막으로 DOM에 기록한 snapshot을 고정한다.
- pointerup은 같은 pointerId/resetKey와 버튼 내부 release만 확인한 뒤 pointerdown snapshot을 그대로 제출한다.
- 버튼 밖 pointerup과 pointercancel은 action을 만들지 않고 pointerdown phase와 방향에서 rAF를 재개한다.
- keyboard click과 timeout도 마지막 실제 rAF 또는 활성 pointerdown snapshot만 사용하고 중복 제출을 resetKey 단위로 차단한다.
- result hold는 live freeze와 같은 canonical percent로 생성해 roll-stage가 표시돼도 최소 1000ms 유지한다.
- QA는 실제 제품 rAF data를 관찰해 pointerdown을 발생시키고 180ms 뒤 live freeze, result hold 0/500/900ms, action, sequence, patch, 최종 등급을 함께 검증한다.

### Verification checklist

- [x] 단일 rAF writer와 pointerdown immutable snapshot 구조를 정적 검토했다.
- [x] CSS track animation을 제거하고 `animation: none`, `will-change`, backface visibility 계약을 확인했다.
- [x] `getComputedStyle`, `getAnimations`, `frozenTransform`, `trackOffsetPx`가 입력 컴포넌트의 authoritative 경로에서 제거됐음을 확인했다.
- [x] targeted TypeScript compile (`npx --yes tsc -p tsconfig.check.json`)이 성공했다.
- [x] `node --check tests/mobile/roll-timing-pointer-capture.spec.js`가 성공했다.
- [x] `node --check tests/qa/suite-manifest.mjs`가 성공했다.
- [x] 테스트 파일 → suite manifest → `qa:emulator-suite` runner → `.github/workflows/qa.yml` matrix → Playwright project/testMatch/브라우저/viewport 연결을 검토했다.
- [x] Main Branch QA Run `30226873062`에서 `npm ci`, architecture validation, build, unit, Galaxy timing, Galaxy grade/layout 등은 성공했다.
- [x] Main Branch QA Run `30227987345`의 Safari/Galaxy timing 실패 job과 artifact를 직접 분석했다.
- [x] Main Branch QA Run `30230218854`에서 Safari visible mismatch와 Safari timing이 성공하고 실제 Good/Nice/outside/cancel 테스트가 실행됐음을 확인했다.
- [x] Run `30230218854`의 unit contract 실패와 Galaxy pointercancel phase-wrap 오인 실패를 직접 분석했다.
- [x] Main Branch QA Run `30231031693`에서 build/unit과 모든 기능 QA가 성공하고 Galaxy pointercancel 수정이 실제 실행됐음을 확인했다.
- [x] Run `30231031693`의 유일한 실패가 Safari timing 성능 `252.2s / 250.0s`임을 확인했다.
- [x] 취소 시나리오 방 재사용 수정 Run `30231697755`에서 Safari timing 기능과 250초 성능 예산이 성공했다.
- [x] 최종 제품·QA merge SHA `9e10435337ecc419e7a1059db422cd8053a9533a` 기준 Main Branch QA 전체 success를 확인했다.

### Main Branch QA follow-up - Run 30226873062

- PR #1138 merge SHA `a324b3ded0bd6618182368c22d2c4806ae214cac`의 Main Branch QA에서 제품 build/unit과 Galaxy Chromium timing은 성공했지만 Safari visible mismatch와 Safari timing이 실패했다.
- Safari visible mismatch의 `31.2%` canonical snapshot을 기존 QA가 meter border-box 기준으로 `31.454055...%`로 계산했다. meter의 2px border와 transform 기준인 content-box 차이가 약 `0.254055%`의 결정적 오차를 만들었다.
- 제품 transform 또는 허용 오차를 바꾸지 않고 QA가 `clientLeft`와 `clientWidth`를 사용해 content-box 기준 오브 중심을 측정하도록 수정했다.
- 기존 QA는 result hold를 생성한 뒤 roll-stage를 최대 5초 기다린 다음 0/500/900ms 샘플을 수집해, 1000ms hold가 이미 제거된 상태를 뒤늦게 관찰할 수 있었다. result hold 0/500/900ms를 먼저 샘플링하고 제거 시각을 확인한 뒤 roll-stage 표시를 별도로 확인하도록 변경했다.
- Safari timing 3-worker 실행에서는 30~34%, 41~44%의 좁은 구간을 rAF가 건너뛰었다. timeout을 늘리거나 animation timeline을 조작하지 않고, Nice와 취소 시나리오는 실제 등급 전체의 좌·우 구간을 허용하되 pointerdown 당시 phase 방향을 함께 기록·검증하도록 변경했다.
- exact `safari-visible-mismatch` title과 manifest grep/grepInvert는 유지했고 테스트 삭제·skip 확대·timeout 증가·0.25% 허용 오차 확대·성능 예산 변경을 하지 않았다.

### Main Branch QA follow-up - Run 30227987345

- PR #1140 merge SHA `539f7ab7bdba002c02852f1d67f08850d209f502`의 Main Branch QA에서 build, unit, architecture validation, Online core, Desktop, 일반 Mobile Galaxy는 성공했다. 실패는 `QA Mobile Galaxy timing`, `QA Safari visible mismatch`, `QA Safari timing` 세 timing lane에 한정됐다.
- Safari timing의 Nice·버튼 밖 pointerup·pointercancel은 같은 spec을 3개 WebKit page에서 병렬 실행하면서 모두 목표 rAF snapshot을 찾지 못했다. 비활성 page에서 제품 rAF가 throttling되어 `positionPercent`가 진행하지 않은 것이었다.
- Safari visible mismatch는 테스트의 `waitUntilElapsed()` 자체가 requestAnimationFrame을 기다려 `500ms 관측 시점에 도달하지 못했습니다`로 실패했다. 제품 rAF와 테스트 관측 시계를 wall-clock timer로 분리했다.
- Galaxy timing은 result hold 500ms sample callback이 늦게 실행돼 clone이 이미 제거된 뒤 `clientWidth === 0` 상태를 측정했다. 0ms·500ms·900ms timer를 1000ms 제거 timer보다 먼저 동시에 예약하도록 변경했다.
- `safari-timing` lane의 manifest worker 수 3과 `mobile-webkit-timing` project의 `fullyParallel: true`는 유지했다. `QA_ROLE=safari-timing`일 때 pointer spec 내부 mode만 `default`로 실행해 한 활성 WebKit page에서 Nice·release·cancel을 순차 검증했다.

### Main Branch QA follow-up - Run 30230218854

- PR #1141 merge SHA `d912eadde590db1d45550f978283667845af81db`의 Main Branch QA에서 Safari visible mismatch와 Safari timing은 모두 성공했다.
- Galaxy timing에서는 Good·Nice·버튼 밖 release·Galaxy 추가 반복과 browser isolation 5건이 성공했고 pointercancel 1건만 실패했다.
- pointercancel 실패값은 expected `< 500ms`, received `1999.626ms`였다. 취소 직후 snapshot phase가 pointerdown phase보다 약 `0.374ms` 작게 관측되자 modulo 계산이 이를 거의 한 주기 진행한 것으로 해석했다.
- polling 단계에 assertion과 같은 bounded next-frame 계약 `phaseDeltaMs >= 48 && phaseDeltaMs < 500`을 적용했다.
- Build job은 architecture validation과 build를 통과했지만 unit이 과거 순차 `sampleHold(500)`·`sampleHold(900)` 문자열을 강제했다. unit 계약을 `Promise.all([0, 500, 900].map(sampleAt))`, `rollStageVisibleWhileHeld`, 순차 hold waiter 부재 검증으로 갱신했다.
- 모든 lane 성능은 예산 내였고 workflow 시작부터 summary 예상 완료는 260.2초로 300초 예산을 통과했다.

### Main Branch QA follow-up - Run 30231031693

- PR #1142 merge SHA `7d1801872052feef41dc0aab93f9442defefc9c2`의 Main Branch QA에서 build, unit, architecture validation과 모든 기능 QA가 성공했다.
- Galaxy timing은 browser isolation, Good, Nice, 버튼 밖 release, pointercancel, Galaxy 추가 반복 6건이 모두 성공했다. Safari visible mismatch와 Safari timing도 실제 대상 테스트가 모두 성공했다.
- 기능 matrix는 모두 success였고 workflow 시작부터 summary 예상 완료도 `284.3s / 300.0s`로 성공했다.
- 유일한 차단은 Safari timing 전체 job 시간이 `252.2s / 250.0s`로 2.2초 초과한 성능 실패였다.
- 허용 오차, timeout, worker, browser, manifest, workflow, 성능 예산을 완화하지 않고, 제출하지 않는 outside release와 pointercancel을 같은 방과 활성 버튼 상태에서 연속 실행하도록 변경했다.

### Final verification - Run 30231697755

- PR #1143 merge SHA `9e10435337ecc419e7a1059db422cd8053a9533a`의 Main Branch QA는 attempt 1에서 terminal `success`로 완료됐다.
- Build/unit, architecture validation, Online core, Desktop sequence/regression, Mobile Galaxy, Mobile Galaxy timing, Safari visible mismatch, Safari timing, Firebase emulator QA matrix가 모두 성공했다.
- Safari timing에서 browser isolation, Nice, 통합 outside release + pointercancel 테스트 3건이 실제 실행돼 모두 성공했다. 통합 취소 테스트는 같은 방에서 두 입력의 action/sequence/log 미생성, synthetic click 무시, 버튼 재활성, bounded phase·방향 재개를 모두 검증했다.
- Galaxy timing에서 browser isolation, Good pointerdown, Nice pointerdown, 통합 outside release + pointercancel, Galaxy 추가 반복 5건이 실제 실행돼 모두 성공했다.
- 테스트 실행 시간은 Galaxy timing 80.6초, Safari visible mismatch 57.6초, Safari timing 93.6초였다.
- 전체 job 시간은 Galaxy timing `149.0s / 240.0s`, Safari visible mismatch `145.3s / 195.0s`, Safari timing `176.6s / 250.0s`였고 모두 예산 내였다.
- workflow 시작부터 summary 예상 완료는 `279.3s / 300.0s`로 성공했다.
- 병합 후 3분 30초 시점에는 새 merge SHA 관련 실패가 감지되지 않았고, 7분 시점에는 자동 실패 이슈 #1139가 Run `30231697755` 성공으로 종료된 것을 확인했다.
