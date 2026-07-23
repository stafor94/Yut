const parseLoopbackEndpoint = (value, label) => {
  const normalized = String(value ?? '').trim();
  const [host, rawPort] = normalized.split(':');
  const port = Number(rawPort);
  if (!['127.0.0.1', 'localhost'].includes(host) || !Number.isInteger(port) || port <= 0) {
    throw new Error(`${label}는 유효한 loopback endpoint여야 합니다: ${normalized || '없음'}`);
  }
  return { host, port, origin: `http://${host}:${port}` };
};

const projectId = String(process.env.QA_PROJECT_ID ?? '').trim();
if (!/^demo-[a-z0-9-]+$/u.test(projectId)) {
  throw new Error(`QA emulator fetch shim은 demo-* project만 허용합니다: ${projectId || '없음'}`);
}

const authEndpoint = parseLoopbackEndpoint(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Auth emulator');
const firestoreEndpoint = parseLoopbackEndpoint(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator');
const nativeFetch = globalThis.fetch.bind(globalThis);

const rewriteUrl = (value) => {
  const url = new URL(value);
  if (url.hostname === 'identitytoolkit.googleapis.com') {
    return `${authEndpoint.origin}/identitytoolkit.googleapis.com${url.pathname}${url.search}`;
  }
  if (url.hostname === 'securetoken.googleapis.com') {
    return `${authEndpoint.origin}/securetoken.googleapis.com${url.pathname}${url.search}`;
  }
  if (url.hostname === 'firestore.googleapis.com') {
    return `${firestoreEndpoint.origin}${url.pathname}${url.search}`;
  }
  return url.toString();
};

const rewriteFetchInput = (input) => {
  if (typeof input === 'string' || input instanceof URL) return rewriteUrl(String(input));
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const rewrittenUrl = rewriteUrl(input.url);
    return rewrittenUrl === input.url ? input : new Request(rewrittenUrl, input);
  }
  return input;
};

globalThis.fetch = (input, init) => nativeFetch(rewriteFetchInput(input), init);

console.log(`[QA Firebase] Node helper requests are isolated to Auth ${authEndpoint.origin} and Firestore ${firestoreEndpoint.origin}.`);
