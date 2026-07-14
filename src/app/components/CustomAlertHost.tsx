import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

type CustomAlertRequest = {
  id: number;
  title: string;
  message: string;
  resolve: () => void;
};

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

export function showCustomAlert(message: string, title = '알림') {
  return new Promise<void>((resolve) => {
    alertQueue.push({ id: nextAlertId, title, message, resolve });
    nextAlertId += 1;
    emitAlertQueueChange();
  });
}

export function CustomAlertHost() {
  useSyncExternalStore(subscribeAlertQueue, getAlertVersion, getAlertVersion);
  const titleId = useId();
  const messageId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const alertRequest = alertQueue[0] ?? null;

  useEffect(() => {
    if (!alertRequest) return;
    confirmButtonRef.current?.focus();
  }, [alertRequest?.id]);

  if (!alertRequest) return null;

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
        <p className="section-kicker">시스템 알림</p>
        <h2 id={titleId}>{alertRequest.title}</h2>
        <p id={messageId}>{alertRequest.message}</p>
        <div className="modal-actions">
          <button ref={confirmButtonRef} onClick={closeAlert}>확인</button>
        </div>
      </section>
    </div>
  );
}
