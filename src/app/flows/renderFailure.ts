export type RenderFailure = {
  name: string;
  message: string;
  stack: string;
  capturedAt: number;
};

const UNKNOWN_RENDER_FAILURE_MESSAGE = '알 수 없는 화면 오류가 발생했습니다.';

function getUnknownErrorMessage(error: unknown) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error === null || error === undefined) return UNKNOWN_RENDER_FAILURE_MESSAGE;

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // Fall back to String below for cyclic or unsupported values.
  }

  try {
    const stringified = String(error);
    return stringified && stringified !== '[object Object]' ? stringified : UNKNOWN_RENDER_FAILURE_MESSAGE;
  } catch {
    return UNKNOWN_RENDER_FAILURE_MESSAGE;
  }
}

export function normalizeRenderFailure(error: unknown, capturedAt = Date.now()): RenderFailure {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || UNKNOWN_RENDER_FAILURE_MESSAGE,
      stack: error.stack ?? '',
      capturedAt,
    };
  }

  return {
    name: 'RenderError',
    message: getUnknownErrorMessage(error),
    stack: '',
    capturedAt,
  };
}
