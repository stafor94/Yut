import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PAGES_DEPLOYMENT_TIMEOUT_MS = 240_000;
export const DEFAULT_PAGES_STATUS_INTERVAL_MS = 5_000;

const API_VERSION = '2026-03-10';
const SUCCESS_STATUSES = new Set(['succeed']);
const PENDING_STATUSES = new Set([
  'deployment_queued',
  'queued',
  'pending',
  'in_progress',
  'building',
]);
const FAILURE_STATUSES = new Set([
  'cancelled',
  'canceled',
  'errored',
  'error',
  'failed',
  'failure',
]);

const requiredText = (value, name) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
};

const requiredPositiveInteger = (value, name) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
};

export const makePagesBuildVersion = ({ sourceSha, runId, runAttempt }) => {
  const sha = requiredText(sourceSha, 'sourceSha');
  const id = requiredPositiveInteger(runId, 'runId');
  const attempt = requiredPositiveInteger(runAttempt, 'runAttempt');
  return `${sha}-${id}-${attempt}`;
};

const readResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GitHub API returned invalid JSON (status ${response.status}).`);
  }
};

const requestJson = async ({ fetchImpl, url, token, method = 'GET', body }) => {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    const message = responseBody?.message ? `: ${responseBody.message}` : '';
    throw new Error(`GitHub API ${method} ${url} failed (${response.status})${message}`);
  }
  return responseBody;
};

export const requestOidcToken = async ({
  fetchImpl = globalThis.fetch,
  requestUrl,
  requestToken,
  owner,
}) => {
  const oidcUrl = new URL(requiredText(requestUrl, 'ACTIONS_ID_TOKEN_REQUEST_URL'));
  oidcUrl.searchParams.set('audience', `https://github.com/${requiredText(owner, 'owner')}`);
  const response = await fetchImpl(oidcUrl, {
    headers: {
      Authorization: `Bearer ${requiredText(requestToken, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`,
    },
  });
  const body = await readResponseBody(response);
  if (!response.ok || typeof body?.value !== 'string' || !body.value) {
    throw new Error(`GitHub OIDC token request failed (${response.status}).`);
  }
  return body.value;
};

export const deployPagesWithinDeadline = async ({
  repository,
  apiUrl = 'https://api.github.com',
  token,
  oidcToken,
  artifactId,
  buildVersion,
  timeoutMs = DEFAULT_PAGES_DEPLOYMENT_TIMEOUT_MS,
  intervalMs = DEFAULT_PAGES_STATUS_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) => {
  const repo = requiredText(repository, 'repository');
  const githubToken = requiredText(token, 'GITHUB_TOKEN');
  const deploymentArtifactId = requiredPositiveInteger(artifactId, 'PAGES_ARTIFACT_ID');
  const version = requiredText(buildVersion, 'buildVersion');
  const deadlineWindowMs = requiredPositiveInteger(timeoutMs, 'timeoutMs');
  const statusIntervalMs = requiredPositiveInteger(intervalMs, 'intervalMs');
  const baseUrl = requiredText(apiUrl, 'apiUrl').replace(/\/$/u, '');
  const startedAt = now();
  const deadlineAt = startedAt + deadlineWindowMs;

  const createUrl = `${baseUrl}/repos/${repo}/pages/deployments`;
  const deployment = await requestJson({
    fetchImpl,
    url: createUrl,
    token: githubToken,
    method: 'POST',
    body: {
      artifact_id: deploymentArtifactId,
      environment: 'github-pages',
      pages_build_version: version,
      oidc_token: requiredText(oidcToken, 'oidcToken'),
    },
  });

  const deploymentId = requiredText(deployment?.id, 'pages deployment id');
  const statusUrl = requiredText(
    deployment?.status_url ?? `${createUrl}/${encodeURIComponent(deploymentId)}`,
    'pages deployment status URL',
  );
  const pageUrl = requiredText(deployment?.page_url, 'pages deployment page URL');
  const cancelUrl = `${createUrl}/${encodeURIComponent(deploymentId)}/cancel`;

  for (;;) {
    const statusResponse = await requestJson({
      fetchImpl,
      url: statusUrl,
      token: githubToken,
    });
    const status = requiredText(statusResponse?.status, 'pages deployment status');
    log(`GitHub Pages deployment ${deploymentId}: ${status}`);

    if (SUCCESS_STATUSES.has(status)) {
      return { deploymentId, pageUrl, status };
    }
    if (FAILURE_STATUSES.has(status)) {
      throw new Error(`GitHub Pages deployment ${deploymentId} ended with status ${status}.`);
    }
    if (!PENDING_STATUSES.has(status)) {
      throw new Error(`GitHub Pages deployment ${deploymentId} returned unknown status ${status}.`);
    }

    const remainingMs = deadlineAt - now();
    if (remainingMs <= 0) {
      let cancelError = null;
      try {
        await requestJson({
          fetchImpl,
          url: cancelUrl,
          token: githubToken,
          method: 'POST',
        });
      } catch (error) {
        cancelError = error;
      }
      const suffix = cancelError ? ` Cancel also failed: ${cancelError.message}` : '';
      throw new Error(
        `GitHub Pages deployment ${deploymentId} did not finish within ${deadlineWindowMs}ms and was cancelled.${suffix}`,
      );
    }
    await sleep(Math.min(statusIntervalMs, remainingMs));
  }
};

const appendOutput = (name, value) => {
  const outputPath = requiredText(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT');
  fs.appendFileSync(outputPath, `${name}=${value}\n`, 'utf8');
};

export const runPagesDeploymentSelfTest = async () => {
  const version1 = makePagesBuildVersion({ sourceSha: 'a'.repeat(40), runId: 10, runAttempt: 1 });
  const version2 = makePagesBuildVersion({ sourceSha: 'a'.repeat(40), runId: 10, runAttempt: 2 });
  assert.notEqual(version1, version2);

  const makeResponse = (status, body = null) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body)),
  });

  let clock = 0;
  const requests = [];
  const successResponses = [
    makeResponse(200, { id: version1, status_url: 'https://api.test/status', page_url: 'https://example.test/' }),
    makeResponse(200, { status: 'deployment_queued' }),
    makeResponse(200, { status: 'in_progress' }),
    makeResponse(200, { status: 'succeed' }),
  ];
  const successResult = await deployPagesWithinDeadline({
    repository: 'owner/repo',
    apiUrl: 'https://api.test',
    token: 'token',
    oidcToken: 'oidc',
    artifactId: 123,
    buildVersion: version1,
    timeoutMs: 20,
    intervalMs: 5,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return successResponses.shift();
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: () => {},
  });
  assert.equal(successResult.status, 'succeed');
  assert.equal(JSON.parse(requests[0].options.body).pages_build_version, version1);
  assert.equal(requests.some(({ url }) => url.endsWith('/cancel')), false);

  clock = 0;
  let cancelCalls = 0;
  await assert.rejects(
    deployPagesWithinDeadline({
      repository: 'owner/repo',
      apiUrl: 'https://api.test',
      token: 'token',
      oidcToken: 'oidc',
      artifactId: 456,
      buildVersion: version2,
      timeoutMs: 10,
      intervalMs: 5,
      fetchImpl: async (url, options = {}) => {
        if (String(url).endsWith('/cancel')) {
          cancelCalls += 1;
          return makeResponse(204);
        }
        if (options.method === 'POST') {
          return makeResponse(200, { id: version2, status_url: 'https://api.test/status', page_url: 'https://example.test/' });
        }
        return makeResponse(200, { status: 'deployment_queued' });
      },
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      log: () => {},
    }),
    /did not finish within 10ms/u,
  );
  assert.equal(cancelCalls, 1);
};

const main = async () => {
  const repository = requiredText(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
  const [owner] = repository.split('/', 1);
  const buildVersion = makePagesBuildVersion({
    sourceSha: process.env.PAGES_SOURCE_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  const oidcToken = await requestOidcToken({
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    owner,
  });
  const result = await deployPagesWithinDeadline({
    repository,
    apiUrl: process.env.GITHUB_API_URL,
    token: process.env.GITHUB_TOKEN,
    oidcToken,
    artifactId: process.env.PAGES_ARTIFACT_ID,
    buildVersion,
    timeoutMs: process.env.PAGES_DEPLOYMENT_TIMEOUT_MS ?? DEFAULT_PAGES_DEPLOYMENT_TIMEOUT_MS,
  });
  appendOutput('page_url', result.pageUrl);
  appendOutput('deployment_id', result.deploymentId);
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const selfTest = process.argv.includes('--self-test');
  (selfTest ? runPagesDeploymentSelfTest() : main())
    .then(() => {
      if (selfTest) console.log('Pages deployment deadline self-test passed');
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
