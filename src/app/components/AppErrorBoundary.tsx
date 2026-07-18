import { Component, type ErrorInfo, type ReactNode } from 'react';
import { normalizeRenderFailure, type RenderFailure } from '../flows/renderFailure';

const LAST_RENDER_FAILURE_STORAGE_KEY = 'yut:last-render-failure';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  failure: RenderFailure | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failure: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { failure: normalizeRenderFailure(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const failure = this.state.failure ?? normalizeRenderFailure(error);
    console.error('React 화면 렌더링이 중단되었습니다.', error, errorInfo);

    try {
      window.sessionStorage.setItem(LAST_RENDER_FAILURE_STORAGE_KEY, JSON.stringify({
        ...failure,
        componentStack: errorInfo.componentStack ?? '',
      }));
    } catch {
      // Recovery UI must remain available even when storage is blocked or full.
    }
  }

  render() {
    const { failure } = this.state;
    if (!failure) return this.props.children;

    return <main className="app-render-error" role="alert">
      <section className="app-render-error-card">
        <p className="section-kicker">화면 오류</p>
        <h1>게임 화면을 표시하지 못했습니다</h1>
        <p>게임 데이터는 서버에 유지됩니다. 화면을 다시 불러와 최신 상태로 복구하세요.</p>
        <button type="button" onClick={() => window.location.reload()}>게임 화면 다시 불러오기</button>
        <details>
          <summary>오류 정보</summary>
          <pre>{failure.name}: {failure.message}</pre>
        </details>
      </section>
    </main>;
  }
}
