import { createHash } from 'node:crypto';

let qaNameSequence = 0;

export const QA_NICKNAME_MAX_LENGTH = 7;
export const QA_ROOM_TITLE_MAX_LENGTH = 20;

function normalizeQaRunId(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function hashQaName(value) {
  return createHash('sha256')
    .update(String(value ?? ''))
    .digest('base64url')
    .toLowerCase()
    .replace(/_/gu, 'x')
    .slice(0, 8);
}

export function makeQaName(testInfo, suffix) {
  const project = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'project';
  const runId = normalizeQaRunId(process.env.QA_RUN_ID);
  const safeSuffix = String(suffix ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 8) || 'room';
  const identity = [
    runId,
    project,
    String(testInfo.testId ?? ''),
    String(testInfo.workerIndex ?? ''),
    String(testInfo.parallelIndex ?? ''),
    String(testInfo.retry ?? ''),
    String(qaNameSequence += 1),
    String(suffix ?? ''),
  ].join('|');
  return `QA-${safeSuffix}-${hashQaName(identity)}`.slice(0, QA_ROOM_TITLE_MAX_LENGTH);
}
