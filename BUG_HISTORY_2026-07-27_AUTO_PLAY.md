# 2026-07-27 - 모바일 스크롤 시 AI 자동 플레이 안내 소실

## 증상

- 모바일에서 연속 timeout으로 사람 좌석이 AI 자동 플레이 상태가 되면 안내가 윷판 패널 위에 표시됐다.
- 페이지를 스크롤하거나 visual viewport가 변하면 현재 상태와 직접 플레이 복귀 버튼을 찾기 어려웠다.
- 자동 플레이 안내와 실제 조작 영역이 분리돼 상태 전환 시 레이아웃과 사용 흐름이 일치하지 않았다.

## 원인

- `GameScreenView`가 안내를 `BoardPanel` 내부의 `.auto-play-overlay` element로 만들었다.
- 기존 CSS는 데스크톱 `position: absolute`, 모바일 `position: fixed`에 의존했다.
- 기존 단위 테스트는 CSS 문자열만 확인하고 Galaxy viewport의 실제 스크롤 및 조작 영역 포함 관계를 검증하지 않았다.

## 수정 원칙

- `BoardPanel`의 조작 슬롯은 자동 플레이 안내 element가 존재하면 기존 `GameBoardControls` element를 렌더링하지 않는다.
- 같은 위치의 `.play-controls.auto-play-mode` 안에 상태 문구와 로컬 좌석용 통제권 회수 버튼을 렌더링한다.
- 기존 authoritative `autoPlayBySeatId`, 어려움 AI action 제출, `resume_human_control`, timeout 및 coordinator 로직은 변경하지 않는다.
- 데스크톱과 모바일의 기존 `play-controls` 최소 높이를 유지한다.
- Galaxy 412×915 Chromium QA에서 authoritative 상태 주입, 상·하 스크롤, DOM/좌표 포함 관계, pending 표시, 통제권 회수 후 일반 UI 복구를 polling으로 검증한다.

## 다시 시도하지 않을 방식

- viewport 하단 fixed 또는 윷판 내부 absolute 안내로 복원하지 않는다.
- 자동 플레이 안내와 복귀 버튼을 조작 영역 밖에 중복 렌더링하지 않는다.
- CSS 문자열 확인만으로 모바일 스크롤 회귀가 해결됐다고 판단하지 않는다.
- 자동 플레이 중 직접 조작 subtree를 숨김만 하고 계속 실행시키지 않는다.
