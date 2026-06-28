# Yut Online

GitHub Pages와 Firebase를 사용하는 온라인 윷놀이 프로젝트입니다.

## Firebase 환경변수

`.env.example`을 `.env`로 복사하고 Firebase 웹 앱 설정값을 입력하세요.

```bash
cp .env.example .env
```

필요한 값:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## 개발

```bash
npm install
npm run dev
```

## E2E 테스트

Playwright 기반 자동 QA 테스트가 포함되어 있습니다. 처음 실행하는 환경에서는 의존성과 브라우저 바이너리를 설치한 뒤 테스트를 실행하세요.

```bash
npm install
npx playwright install --with-deps
npm run test:e2e
```

`npm run test:e2e`는 Vite 프로덕션 빌드를 먼저 생성한 뒤 Playwright 테스트를 실행합니다. 테스트 서버는 Playwright 설정의 `webServer`에서 `npm run preview`로 자동 시작됩니다.

테스트 결과와 디버깅 산출물은 다음 위치에 생성됩니다.

- `playwright-report`: HTML 리포트
- `test-results`: 실패 시 trace, video, screenshot 등 Playwright 산출물
- `screenshots`: 테스트 단계별 전체 페이지 스크린샷
- `console-log.txt`: 테스트 중 브라우저 콘솔 로그

## GitHub Pages 배포

저장소 `Settings` > `Pages`에서 `Build and deployment`의 `Source`를 `GitHub Actions`로 설정하세요.

GitHub Actions 배포에는 Firebase 환경변수가 필요합니다. 저장소 `Settings` > `Secrets and variables` > `Actions`에서 위 `VITE_FIREBASE_*` 값을 `Secrets` 또는 `Variables`에 등록하세요.

## 현재 포함된 기능

- React + TypeScript + Vite 기본 앱
- GitHub Pages용 `base: /Yut/` 설정
- Firebase 익명 로그인 초기화
- Firestore 방 생성 및 대기중 방 실시간 구독
- 아이템 6종 동일 확률 정의
- 아이템 모드 시작 시 말판 아이템 4~8개 생성 로직
- PC, 태블릿, 모바일 반응형 게임 화면 초안
