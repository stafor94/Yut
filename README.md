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

## GitHub Pages 배포

저장소 `Settings` > `Pages`에서 `Build and deployment`의 `Source`를 `GitHub Actions`로 설정하세요.

### Firebase 값을 GitHub에 등록하는 위치

GitHub 공식 문서 기준으로 저장소 환경값은 저장소 메인 화면에서 `Settings`로 들어간 뒤, 왼쪽 사이드바의 `Security` 섹션에서 `Secrets and variables` > `Actions`를 선택해 등록합니다.

등록 방법은 2가지 중 하나를 쓰면 됩니다.

#### 방법 A: Repository secrets 등록

1. GitHub 저장소 메인 화면으로 이동합니다.
2. 상단 탭에서 `Settings`를 클릭합니다.
   - `Settings` 탭이 안 보이면 상단 오른쪽의 `...` 또는 더보기 메뉴 안에 있을 수 있습니다.
3. 왼쪽 사이드바에서 `Security` 섹션을 찾습니다.
4. `Secrets and variables`를 펼칩니다.
5. `Actions`를 클릭합니다.
6. `Secrets` 탭에서 `New repository secret`을 클릭합니다.
7. 위의 `VITE_FIREBASE_*` 값을 하나씩 같은 이름으로 등록합니다.

저장 후 `Repository secrets` 목록에는 secret 이름만 보이고 값은 다시 표시되지 않습니다. 예를 들어 `VITE_FIREBASE_API_KEY`라는 제목만 보이면 정상입니다. 값을 수정해야 할 때는 기존 secret을 열어 확인하는 방식이 아니라 `Update` 또는 새 값으로 덮어쓰기 해야 합니다.

#### 방법 B: Repository variables 등록

Firebase 웹 앱 config 값은 브라우저 앱에 포함되는 공개 설정값에 가깝기 때문에, `Secrets` 메뉴가 찾기 어렵다면 `Variables`에 등록해도 됩니다.

1. `Settings` > `Secrets and variables` > `Actions`로 이동합니다.
2. `Variables` 탭을 클릭합니다.
3. `New repository variable`을 클릭합니다.
4. 위의 `VITE_FIREBASE_*` 값을 하나씩 같은 이름으로 등록합니다.

현재 배포 워크플로는 `Secrets`를 우선 사용하고, 없으면 `Variables` 값을 사용하도록 되어 있습니다.

### `Secrets and variables`가 안 보일 때 확인할 것

- 저장소의 `Settings` 탭이 보이지 않으면 해당 저장소의 관리자 권한이 없을 가능성이 큽니다.
- 조직 저장소라면 조직 정책 때문에 Actions secrets 설정이 숨겨져 있을 수 있습니다.
- 모바일 화면에서는 메뉴가 접혀 보일 수 있으니 PC 브라우저에서 확인하는 것을 추천합니다.
- 저장소가 포크라면 원본 저장소가 아니라 실제 배포할 저장소의 `Settings`에서 설정해야 합니다.
- `Actions`가 비활성화된 저장소라면 `Settings` > `Actions` > `General`에서 Actions 사용이 허용되어 있는지 확인하세요.

## 현재 포함된 기능

- React + TypeScript + Vite 기본 앱
- GitHub Pages용 `base: /Yut/` 설정
- Firebase 익명 로그인 초기화
- Firestore 방 생성 및 대기중 방 실시간 구독
- 아이템 6종 동일 확률 정의
- 아이템 모드 시작 시 말판 아이템 4~8개 생성 로직
- PC, 태블릿, 모바일 반응형 게임 화면 초안

## Firebase 콘솔에서 환경변수 값 찾기

Firebase 값은 Firebase 콘솔의 웹 앱 설정 화면에서 한 번에 확인하는 것이 가장 쉽습니다.

1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트를 엽니다.
2. 왼쪽 위 톱니바퀴 아이콘을 클릭합니다.
3. `프로젝트 설정`을 클릭합니다.
4. `일반` 탭을 엽니다.
5. 아래쪽 `내 앱` 또는 `Your apps` 영역에서 웹 앱 `</>`을 선택합니다.
6. `SDK 설정 및 구성`에서 `구성` 또는 `Config`를 선택합니다.
7. `firebaseConfig` 객체에 있는 값을 GitHub `Secrets` 또는 `Variables`에 같은 이름으로 옮겨 적습니다.

Firebase 공식 문서 기준으로 웹 앱의 API key는 Firebase config 객체의 `apiKey` 필드에서 확인할 수 있으며, Firebase 웹 앱 config는 앱을 Firebase와 연결할 때 사용하는 설정값입니다.

| GitHub에 등록할 이름 | Firebase config에서 복사할 값 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |

예시:

```ts
const firebaseConfig = {
  apiKey: "VITE_FIREBASE_API_KEY에 넣을 값",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN에 넣을 값",
  projectId: "VITE_FIREBASE_PROJECT_ID에 넣을 값",
  storageBucket: "VITE_FIREBASE_STORAGE_BUCKET에 넣을 값",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID에 넣을 값",
  appId: "VITE_FIREBASE_APP_ID에 넣을 값"
};
```

### 웹 앱이 안 보일 때

`내 앱` 영역에 웹 앱이 없다면 아직 Firebase 웹 앱을 등록하지 않은 상태입니다.

1. `프로젝트 설정` > `일반` 탭으로 이동합니다.
2. `내 앱` 영역에서 `</>` 웹 아이콘을 클릭합니다.
3. 앱 닉네임을 입력하고 등록합니다.
4. 등록 직후 표시되는 `firebaseConfig` 값을 복사합니다.

### 이 값들이 진짜 비밀값인가요?

Firebase 웹 config 값은 브라우저 앱에 포함되는 공개 설정값에 가깝습니다. Firebase 공식 문서도 Firebase API key는 프로젝트와 앱을 식별하기 위한 값이며, 데이터 접근 보안은 API key를 숨기는 방식이 아니라 Firebase Security Rules와 App Check로 처리해야 한다고 설명합니다.
