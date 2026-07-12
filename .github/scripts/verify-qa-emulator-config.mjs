import fs from 'node:fs';
import net from 'node:net';

function parseEnvFile(filePath) {
  const values = {};
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/gu, '');
  }
  return values;
}

function parseInjectedFirebaseProjectId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.projectId ?? parsed.project_id ?? '').trim();
  } catch {
    return '';
  }
}

function assertLoopbackHost(value, label) {
  if (!['127.0.0.1', 'localhost'].includes(value)) throw new Error(`${label}는 loopback host여야 합니다: ${value}`);
}

async function assertTcpEndpoint(host, port, label) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${label} 연결 timeout: ${host}:${port}`));
    }, 5000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} 연결 실패 ${host}:${port}: ${error.message}`));
    });
  });
}

const values = parseEnvFile('.env.qa');
const projectId = values.VITE_FIREBASE_PROJECT_ID ?? '';
const qaRunId = values.VITE_QA_RUN_ID ?? '';
const firestoreHost = values.VITE_FIRESTORE_EMULATOR_HOST ?? '';
const firestorePort = Number(values.VITE_FIRESTORE_EMULATOR_PORT ?? 0);
const authUrl = new URL(values.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://invalid');

if (values.VITE_FIREBASE_EMULATOR_MODE !== '1') throw new Error('VITE_FIREBASE_EMULATOR_MODE=1이 필요합니다.');
if (!/^demo-[a-z0-9-]+$/u.test(projectId)) throw new Error(`운영 projectId가 QA에 유입될 수 있습니다: ${projectId || '없음'}`);
if (!qaRunId) throw new Error('VITE_QA_RUN_ID가 필요합니다.');
assertLoopbackHost(firestoreHost, 'Firestore emulator');
assertLoopbackHost(authUrl.hostname, 'Auth emulator');
if (!Number.isInteger(firestorePort) || firestorePort <= 0) throw new Error(`잘못된 Firestore emulator port: ${firestorePort}`);

for (const key of ['FIREBASE_CONFIG', 'FIREBASE']) {
  const rawValue = String(process.env[key] ?? '').trim();
  if (!rawValue) continue;
  const injectedProjectId = parseInjectedFirebaseProjectId(rawValue);
  if (injectedProjectId !== projectId || !injectedProjectId.startsWith('demo-')) {
    throw new Error(`${key}에서 운영 Firebase 설정 유입을 감지했습니다: ${injectedProjectId || 'projectId 해석 실패'}`);
  }
  console.log(`${key} contains emulator-generated demo config for ${injectedProjectId}.`);
}
const injectedProjectId = String(process.env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
if (injectedProjectId && injectedProjectId !== projectId) throw new Error(`환경 projectId와 .env.qa projectId가 다릅니다: ${injectedProjectId}`);

console.log(`QA Firebase config guard passed: project=${projectId}, run=${qaRunId}`);
console.log(`Expected Firestore emulator endpoint: ${firestoreHost}:${firestorePort}`);
console.log(`Expected Auth emulator endpoint: ${authUrl.origin}`);

if (process.argv.includes('--runtime')) {
  const firestoreRuntime = String(process.env.FIRESTORE_EMULATOR_HOST ?? '');
  const authRuntime = String(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '');
  if (firestoreRuntime !== `${firestoreHost}:${firestorePort}`) throw new Error(`FIRESTORE_EMULATOR_HOST 불일치: ${firestoreRuntime}`);
  if (authRuntime !== `${authUrl.hostname}:${authUrl.port}`) throw new Error(`FIREBASE_AUTH_EMULATOR_HOST 불일치: ${authRuntime}`);
  await assertTcpEndpoint(firestoreHost, firestorePort, 'Firestore emulator');
  await assertTcpEndpoint(authUrl.hostname, Number(authUrl.port), 'Auth emulator');
  console.log('QA Firebase emulator runtime endpoints are reachable.');
}
