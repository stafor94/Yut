# Main Branch QA stability record

## 승인 조건

Safari 병렬 lane과 Galaxy timing 분리 구성을 포함한 Main Branch QA는 다음 조건을 모두 만족한 terminal success를 연속 3회 확인해야 안정성 검증이 완료된다.

- 필수 job 전체 성공
- Safari visible mismatch와 Safari timing의 실제 테스트 실행
- Mobile Galaxy와 Mobile Galaxy timing의 실제 테스트 실행
- workflow 시작부터 summary 완료까지 300초 이내
- lane별 성능 예산 통과
- 각 Firebase emulator lane cleanup 후 `remaining=0`, `qaRoomCount=0`
- 브라우저 console의 오류·미처리 예외·transient UI 실패 없음

## 이전 성공 표본과 연속성 초기화

### 1/3 — Run 30178960740

- Head SHA: `5ba578641695739c1c1c077fcbbca1abc2dc88d8`
- Attempt: 1
- Event / branch: `push` / `main`
- Terminal conclusion: `success`
- Workflow 시작 → 성능 검증: 265.7초
- Summary 완료 예상: 275.7초 / 목표 300초
- 기능 테스트: 79건 성공
- Lane 전체 시간:
  - Build and unit: 35.8초
  - Online core: 250.2초
  - Desktop sequence replay: 192.4초
  - Desktop regression: 179.8초
  - Mobile Galaxy: 221.9초
  - Mobile Galaxy timing: 199.3초
  - Safari visible mismatch: 179.5초
  - Safari timing: 191.2초
- 모든 Firebase emulator lane cleanup: `remaining=0`, `qaRoomCount=0`
- 브라우저 console 오류: 0건
- 자동 실패 이슈 #1087: 성공 Run 확인 후 자동 종료

### 2/3 — Run 30179549871

- Head SHA: `f19399aa463cc6d412c6e11a79334e1e592439c6`
- Attempt: 1
- Event / branch: `push` / `main`
- Terminal conclusion: `success`
- Workflow 시작 → 성능 검증: 272.0초
- Summary 완료 예상: 282.0초 / 목표 300초
- 기능 테스트: 79건 성공
- Lane 전체 시간:
  - Build and unit: 38.1초
  - Online core: 256.6초
  - Desktop sequence replay: 183.0초
  - Desktop regression: 170.0초
  - Mobile Galaxy: 139.4초
  - Mobile Galaxy timing: 218.7초
  - Safari visible mismatch: 134.5초
  - Safari timing: 215.4초
- 모든 Firebase emulator lane cleanup: `remaining=0`, `qaRoomCount=0`
- 브라우저 console 오류: 0건
- 자동 실패 이슈 #1087: 안정성 승인 대기 재개방 후 성공 Run 확인으로 자동 종료

Run `30179826939`가 Safari timing setup 클릭 안정성 문제로 실패했으므로 위 두 성공 표본의 연속성은 초기화한다. PR #1099의 수정이 포함된 merge commit부터 새 연속 성공 시퀀스를 시작한다.

## 중단된 연속 성공 시퀀스

### 1/3 — Run 30180370916

- Head SHA: `81d90133fff8c2e3e2a0f5ece56379e752d18d00`
- Attempt: 1
- Event / branch: `push` / `main`
- Terminal conclusion: `success`
- Workflow 시작 → 성능 검증: 269.8초
- Summary 완료 예상: 279.8초 / 목표 300초
- 기능 테스트: 79건 성공
- Lane 전체 시간:
  - Build and unit: 30.5초
  - Online core: 245.4초
  - Desktop sequence replay: 174.9초
  - Desktop regression: 166.6초
  - Mobile Galaxy: 163.5초
  - Mobile Galaxy timing: 213.0초
  - Safari visible mismatch: 185.0초
  - Safari timing: 215.1초
- 모든 Firebase emulator lane cleanup: `remaining=0`, `qaRoomCount=0`
- 브라우저 console 오류·미처리 예외·transient UI 실패: 0건
- 자동 실패 이슈 #1087: 성공 Run 확인 후 자동 종료

Run `30182059925`가 Safari visible mismatch의 방 생성 복구 조회 무기한 대기와 Galaxy 순서 결과 비결정성으로 실패했으므로 이 시퀀스도 초기화한다. 해당 원인 수정이 포함된 merge commit의 첫 terminal success부터 연속 성공 1/3을 다시 기록한다.
