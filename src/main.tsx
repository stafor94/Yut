import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AppErrorBoundary } from './app/components/AppErrorBoundary';
import { CustomAlertHost } from './app/components/CustomAlertHost';
import { GameGuideDialogHost } from './app/components/GameGuideDialog';
import { GameStatisticsHost } from './app/components/GameStatisticsDialog';
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
import './styles/lobby-guide-dialog-fix.css';
import './styles/game-guide-result-strip.css';
import './styles/lobby-room-query-loading.css';
import './styles/lobby-background-reference.css';
import './styles/lobby-background-video.css';
import './styles/control-geometry.css';
import './styles/lobby-scroll-overflow-fix.css';
import './styles/lobby-footer.css';
import './styles/lobby-header-badges.css';
import './styles/shared-sound-badge.css';
import './styles/waiting-room-qa-regression-fix.css';
import './styles/waiting-room-empty-seat-fix.css';
import './styles/roll-timing-grades.css';
import './styles/roll-timing-grade-tokens.css';
import './styles/roll-timing-ios-smoothness.css';
import './styles/roll-stage-board-alignment.css';
import './styles/turn-order-roll-placement.css';
import './styles/lobby-guide-timing-grades.css';
import './styles/auto-play-controls.css';
import './styles/turn-order-final-alignment.css';
import './styles/game-statistics-dialog.css';
import './styles/game-statistics-footer-spacing-fix.css';
import './styles/game-guide-dialog.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
      <GameGuideDialogHost />
      <GameStatisticsHost />
      <CustomAlertHost />
    </AppErrorBoundary>
  </React.StrictMode>,
);
