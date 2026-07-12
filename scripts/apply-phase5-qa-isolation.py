from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    path.write_text(source.replace(old, new, 1))


room_service = Path('src/features/room/services/roomService.ts')
replace_once(
    room_service,
    "presenceCleanupLeaseVersion?: number; presenceCleanupLeaseUpdatedAt?: unknown;",
    "presenceCleanupLeaseVersion?: number; presenceCleanupLeaseUpdatedAt?: unknown; qaRunId?: string;",
    'room qaRunId type',
)
replace_once(
    room_service,
    "const QA_ROOM_TITLE_PREFIX = 'QA-';\nconst EMPTY_ROOM_DELETE_DELAY_MS",
    "const QA_ROOM_TITLE_PREFIX = 'QA-';\nconst QA_RUN_ID = String(import.meta.env.VITE_QA_RUN_ID ?? '').trim();\nconst EMPTY_ROOM_DELETE_DELAY_MS",
    'QA run constant',
)
replace_once(
    room_service,
    """    currentPlayers: 1,
    createdAt: serverTimestamp(),
  });""",
    """    currentPlayers: 1,
    createdAt: serverTimestamp(),
    ...(QA_RUN_ID ? { qaRunId: QA_RUN_ID } : {}),
  });""",
    'room QA namespace write',
)

rooms = Path('tests/helpers/rooms.js')
source = rooms.read_text()
source = source.replace(
    "import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, getFirestore, query, updateDoc, where, writeBatch } from 'firebase/firestore';",
    "import { collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, query, updateDoc, where, writeBatch } from 'firebase/firestore';",
)
old_db = """export async function getTestDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const app = getApps().find((candidate) => candidate.name === 'qa-cleanup') ?? initializeApp(config, 'qa-cleanup');
      return getFirestore(app);
    })();
  }
  return dbPromise;
}"""
new_db = """export async function getTestDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const config = await loadFirebaseConfig();
      if (!config) return null;
      const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
      const emulatorEndpoint = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
      if (qaRunId && !emulatorEndpoint) throw new Error('QA helper는 FIRESTORE_EMULATOR_HOST 없이 실행할 수 없습니다.');
      if (qaRunId && !String(config.projectId ?? '').startsWith('demo-')) throw new Error(`QA helper가 운영 projectId를 거부했습니다: ${String(config.projectId ?? '')}`);
      const appName = qaRunId ? `qa-${qaRunId}`.slice(0, 40) : 'qa-helper';
      const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(config, appName);
      const firestore = getFirestore(app);
      if (emulatorEndpoint) {
        const [host, rawPort] = emulatorEndpoint.split(':');
        const port = Number(rawPort);
        if (!['127.0.0.1', 'localhost'].includes(host) || !Number.isInteger(port) || port <= 0) throw new Error(`잘못된 Firestore emulator endpoint: ${emulatorEndpoint}`);
        connectFirestoreEmulator(firestore, host, port);
      }
      return firestore;
    })();
  }
  return dbPromise;
}"""
if source.count(old_db) != 1:
    raise SystemExit('getTestDb block mismatch')
source = source.replace(old_db, new_db, 1)
source, orphan_count = re.subn(
    r"\nexport async function deleteMissingParentRoomSubcollectionsForQa\(\) \{[\s\S]*?\n\}\n\nexport async function deleteInactiveRoomsForQa\(onFailure\) \{[\s\S]*?\n\}\n",
    "\n",
    source,
    count=1,
)
if orphan_count != 1:
    raise SystemExit(f'global cleanup functions: expected 1 block, found {orphan_count}')
rooms.write_text(source)

Path('tests/helpers/cleanup-qa-rooms.js').write_text("""import { collection, getDocs, query, where } from 'firebase/firestore';
import { deleteRoomForQa, getTestDb } from './rooms.js';

const qaRunId = String(process.env.QA_RUN_ID ?? '').trim();
const shouldReportRemainingRooms = process.env.QA_CLEANUP_REPORT_REMAINING === '1';

function formatDeletedCounts(deletedCounts) {
  return Object.entries(deletedCounts)
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
}

async function getCurrentRunRooms(db) {
  const snapshot = await getDocs(query(collection(db, 'rooms'), where('qaRunId', '==', qaRunId)));
  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    title: String(documentSnapshot.data().title ?? ''),
  }));
}

async function cleanupQaRooms() {
  if (!qaRunId) throw new Error('QA_RUN_ID 없이 QA cleanup을 실행할 수 없습니다.');
  const db = await getTestDb();
  if (!db) throw new Error('격리된 QA Firebase 설정이 없습니다.');

  const qaRooms = await getCurrentRunRooms(db);
  console.log(`QA cleanup namespace=${qaRunId}, rooms=${qaRooms.length}`);
  const failures = [];
  for (const room of qaRooms) {
    try {
      const deletedCounts = await deleteRoomForQa(room.id);
      const summary = formatDeletedCounts(deletedCounts);
      console.log(`정리 완료: ${room.id} (${room.title || '제목 없음'})${summary ? ` - ${summary}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${room.id}: ${message}`);
      console.error(`정리 실패: ${room.id} - ${message}`);
    }
  }

  const remainingRooms = await getCurrentRunRooms(db);
  if (shouldReportRemainingRooms || remainingRooms.length > 0) {
    console.log(`cleanup-after namespace=${qaRunId}, remaining=${remainingRooms.length}`);
    remainingRooms.forEach((room) => console.log(`남은 QA 방: ${room.id} (${room.title || '제목 없음'})`));
  }
  if (failures.length || remainingRooms.length) throw new Error(`QA cleanup incomplete: failures=${failures.length}, remaining=${remainingRooms.length}`);
}

cleanupQaRooms().catch((error) => {
  console.error('현재 QA run 방 정리에 실패했습니다.', error);
  process.exitCode = 1;
});
""")

summary = Path('.github/scripts/summarize-qa.mjs')
replace_once(
    summary,
    """  ['QA cleanup before', process.env.QA_CLEANUP_BEFORE_JOB_RESULT],
  ['QA basic flow', process.env.QA_BASIC_FLOW_JOB_RESULT],
  ['QA online turn recovery', process.env.QA_ONLINE_TURN_RECOVERY_JOB_RESULT],
  ['QA stacked roll backdo AI', process.env.QA_STACKED_ROLL_BACKDO_AI_JOB_RESULT],
  ['QA cleanup layout regression', process.env.QA_CLEANUP_LAYOUT_REGRESSION_JOB_RESULT],
  ['QA cleanup after', process.env.QA_CLEANUP_AFTER_JOB_RESULT],""",
    """  ['QA Firebase emulator suite', process.env.QA_EMULATOR_JOB_RESULT],
  ['QA stacked roll backdo AI', process.env.QA_STACKED_ROLL_BACKDO_AI_JOB_RESULT],""",
    'QA summary job list',
)

Path('.github/workflows/qa.yml').write_text("""name: Main Branch QA

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  pages: write
  id-token: write

concurrency:
  group: main-branch-qa-${{ github.ref_name || github.ref }}
  cancel-in-progress: true

jobs:
  build-and-unit:
    name: Build and unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Prepare Firebase environment
        run: node .github/scripts/write-firebase-env.mjs
        env:
          FIREBASE_CONFIG: ${{ secrets.FIREBASE || vars.FIREBASE }}
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY || vars.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN || vars.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID || vars.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET || vars.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_MESSAGING_SENDER_ID: ${{ secrets.VITE_FIREBASE_MESSAGING_SENDER_ID || vars.VITE_FIREBASE_MESSAGING_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID || vars.VITE_FIREBASE_APP_ID }}
      - name: Build app
        run: |
          set -o pipefail
          npm run build 2>&1 | tee build.log
      - name: Unit tests
        run: |
          set -o pipefail
          npm run test:unit 2>&1 | tee unit.log
      - name: Upload app and logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: build-and-unit
          path: |
            dist
            build.log
            unit.log
          if-no-files-found: ignore
          retention-days: 7

  qa-firebase-emulator:
    name: QA Firebase emulator suite
    needs: build-and-unit
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      QA_RUN_ID: gh-${{ github.run_id }}-${{ github.run_attempt }}
      QA_PROJECT_ID: demo-yut-${{ github.run_id }}-${{ github.run_attempt }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - run: npm ci
      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium
      - name: Prepare isolated QA Firebase environment
        run: node .github/scripts/write-qa-firebase-env.mjs
      - name: Reject production Firebase configuration
        run: node .github/scripts/verify-qa-emulator-config.mjs
      - name: Build isolated QA app
        run: |
          set -o pipefail
          npm run build:qa 2>&1 | tee qa-build.log
      - name: Run Playwright against Auth and Firestore emulators
        run: |
          set -o pipefail
          npx --yes firebase-tools@latest emulators:exec \
            --config firebase.qa.json \
            --project "$QA_PROJECT_ID" \
            --only auth,firestore \
            "npm run qa:emulator-suite" 2>&1 | tee qa-emulator-suite.log
      - name: Upload emulator QA artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-firebase-emulator-results
          path: |
            test-results
            playwright-*.log
            qa-*.log
            firestore-debug.log
            firebase-debug.log
            console-log.txt
          if-no-files-found: ignore
          retention-days: 7

  qa-stacked-roll-backdo-ai:
    name: QA stacked roll backdo AI
    needs: build-and-unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Run stacked backdo authoritative QA
        run: |
          set -o pipefail
          npm run test:qa-stacked-roll-backdo-ai 2>&1 | tee qa-stacked-roll-backdo-ai.log
      - name: Upload QA artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-stacked-roll-backdo-ai-results
          path: qa-stacked-roll-backdo-ai.log
          if-no-files-found: ignore
          retention-days: 7

  deploy-pages:
    name: Deploy GitHub Pages
    needs: build-and-unit
    if: github.ref == 'refs/heads/main' && success()
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: build-and-unit
      - name: Verify dist exists
        run: |
          test -d dist
          ls -la dist
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4

  summarize-qa-result:
    name: Summarize QA result
    if: always()
    needs: [build-and-unit, qa-firebase-emulator, qa-stacked-roll-backdo-ai, deploy-pages]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Download QA artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: '*'
          merge-multiple: true
        continue-on-error: true
      - name: Combine QA logs
        if: always()
        run: |
          cat playwright-*.log qa-*.log unit.log build.log > playwright.log 2>/dev/null || touch playwright.log
      - name: Summarize QA result
        if: always()
        env:
          QA_JOB_STATUS: ${{ (needs.build-and-unit.result == 'success' && needs.qa-firebase-emulator.result == 'success' && needs.qa-stacked-roll-backdo-ai.result == 'success' && needs.deploy-pages.result == 'success') && 'success' || 'failure' }}
          BUILD_AND_UNIT_JOB_RESULT: ${{ needs.build-and-unit.result }}
          QA_EMULATOR_JOB_RESULT: ${{ needs.qa-firebase-emulator.result }}
          QA_STACKED_ROLL_BACKDO_AI_JOB_RESULT: ${{ needs.qa-stacked-roll-backdo-ai.result }}
          DEPLOY_PAGES_JOB_RESULT: ${{ needs.deploy-pages.result }}
        run: |
          node .github/scripts/summarize-qa.mjs
          cat qa-failure-summary.md >> "$GITHUB_STEP_SUMMARY"
      - name: Upload QA summary
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qa-failure-summary
          path: |
            test-results
            build.log
            unit.log
            playwright.log
            qa-failure-summary.md
            qa-issue-summary.md
            qa-environment.md
            qa-failed-tests.md
            qa-failure-details.md
            qa-artifacts.md
            qa-console-summary.md
            qa-artifact-manifest.md
            console-log.txt
          if-no-files-found: ignore
          retention-days: 7
""")

print('phase 5 QA isolation patch applied')
