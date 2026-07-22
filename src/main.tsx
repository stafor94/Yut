import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AiDifficultyRuntimeBridge } from './app/components/AiDifficultyRuntimeBridge';
import { AppErrorBoundary } from './app/components/AppErrorBoundary';
import { CustomAlertHost } from './app/components/CustomAlertHost';
import './styles/mobile-item-log-recovery.css';
import './styles/game-header-log-alignment.css';
import './styles/game-room-info-toggle.css';
import './styles/ai-difficulty.css';
import './styles/stored-room-recovery.css';
import './styles/roll-stage-lifecycle-fix.css';
import './styles/bonus-roll-result-glow.css';
import './styles/render-error.css';
import './styles/lobby-start.css';
import './styles/lobby-compact-polish.css';
import './styles/lobby-portrait-fit.css';
import './styles/lobby-requested-polish.css';
import './styles/lobby-guide-polish.css';
import './styles/lobby-dialog-position.css';
import './styles/lobby-room-query-loading.css';
import './styles/lobby-background-reference.css';
import './styles/control-geometry.css';
import './styles/lobby-scroll-overflow-fix.css';
import './styles/lobby-footer.css';
import './styles/lobby-header-badges.css';
import './styles/shared-sound-badge.css';
import './styles/waiting-room-qa-regression-fix.css';
import './styles/waiting-room-empty-seat-fix.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AiDifficultyRuntimeBridge />
      <App />
      <CustomAlertHost />
    </AppErrorBoundary>
  </React.StrictMode>,
);
