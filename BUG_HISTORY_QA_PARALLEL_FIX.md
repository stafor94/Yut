# Main Branch QA parallel execution correction

- Run 29883467598의 실패는 병렬 Firebase 경합으로 확정할 수 없었다.
- 실제 아티팩트에서 온라인 QA는 AI 카드 정렬 회귀, 모바일 QA는 방 설정 초기 상태와 라디오 클릭 영역 회귀로 실패했다.
- QA job은 각자 고유한 QA_RUN_ID로 생성·정리 대상을 격리한 상태에서 build 이후 병렬 실행한다.
- 배포는 모든 QA와 orphan cleanup 성공을 명시적으로 요구한다.
