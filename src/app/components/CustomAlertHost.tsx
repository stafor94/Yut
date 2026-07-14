import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

type CustomAlertRequest = {
  id: number;
  title: string;
  message: string;
  resolve: () => void;
};

type StoredCustomAlert = Pick<CustomAlertRequest, 'title' | 'message'>;

const DEFERRED_ALERT_STORAGE_KEY = 'yut-ui:deferred-custom-alert';
const FATAL_GAME_ALERT_TITLE = '게임 진행 확인 실패';
const FATAL_GAME_ALERT_DISPLAY_TITLE = '게임에서 나왔어요';
const FATAL_GAME_ALERT_DISPLAY_MESSAGE = '연결이 원활하지 않아 로비로 이동했어요.';
const alertQueue: CustomAlertRequest[] = [];
const listeners = new Set<() => void>();
let alertVersion = 0;
let nextAlertId = 1;

const emitAlertQueueChange = () => {
  alertVersion += 1;
  listeners.forEach((listener) => listener());
};

const subscribeAlertQueue = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getAlertVersion = () => alertVersion;

const enqueueCustomAlert = (message: string, title: string) => new Promise<void>((resolve) => {
  alertQueue.push({ id: nextAlertId, title, message, resolve });
  nextAlertId += 1;
  emitAlertQueueChange();
});

const storeDeferredAlert = (alert: StoredCustomAlert) => {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(DEFERRED_ALERT_STORAGE_KEY, JSON.stringify(alert));
    return true;
  } catch {
    return false;
  }
};

const takeDeferredAlert = (): StoredCustomAlert | null => {
  if (typeof window === 'undefined') return null;
  try {
    const storedAlert = window.sessionStorage.getItem(DEFERRED_ALERT_STORAGE_KEY);
    if (!storedAlert) return null;
    window.sessionStorage.removeItem(DEFERRED_ALERT_STORAGE_KEY);
    const parsed = JSON.parse(storedAlert) as Partial<StoredCustomAlert>;
    return typeof parsed.title === 'string' && typeof parsed.message === 'string'
      ? { title: parsed.title, message: parsed.message }
      : null;
  } catch {
    window.sessionStorage.removeItem(DEFERRED_ALERT_STORAGE_KEY);
    return null;
  }
};

export function showCustomAlert(message: string, title = '알림') {
  if (title === FATAL_GAME_ALERT_TITLE && storeDeferredAlert({ title, message })) {
    return Promise.resolve();
  }
  return enqueueCustomAlert(message, title);
}

export function CustomAlertHost() {
  useSyncExternalStore(subscribeAlertQueue, getAlertVersion, getAlertVersion);
  const titleId = useId();
  const messageId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const alertRequest = alertQueue[0] ?? null;

  useEffect(() => {
    const deferredAlert = takeDeferredAlert();
    if (deferredAlert) void enqueueCustomAlert(deferredAlert.message, deferredAlert.title);
  }, []);

  useEffect(() => {
    if (!alertRequest) return;
    confirmButtonRef.current?.focus();
  }, [alertRequest?.id]);

  if (!alertRequest) return null;

  const isFatalGameAlert = alertRequest.title === FATAL_GAME_ALERT_TITLE;
  const displayTitle = isFatalGameAlert ? FATAL_GAME_ALERT_DISPLAY_TITLE : alertRequest.title;
  const displayMessage = isFatalGameAlert ? FATAL_GAME_ALERT_DISPLAY_MESSAGE : alertRequest.message;

  const closeAlert = () => {
    const currentRequest = alertQueue[0];
    if (!currentRequest || currentRequest.id !== alertRequest.id) return;
    alertQueue.shift();
    currentRequest.resolve();
    emitAlertQueueChange();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="nickname-modal panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <p className="section-kicker">{isFatalGameAlert ? '게임 안내' : '시스템 알림'}</p>
        <h2 id={titleId}>{displayTitle}</h2>
        <p id={messageId}>{displayMessage}</p>
        <div className="modal-actions">
          <button ref={confirmButtonRef} onClick={closeAlert}>확인</button>
        </div>
      </section>
    </div>
  );
}
