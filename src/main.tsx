import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { AiDifficultyRuntimeBridge } from './app/components/AiDifficultyRuntimeBridge';
import { CustomAlertHost } from './app/components/CustomAlertHost';
import './styles/mobile-item-log-recovery.css';
import './styles/game-header-log-alignment.css';
import './styles/game-room-info-toggle.css';
import './styles/ai-difficulty.css';
import './styles/stored-room-recovery.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiDifficultyRuntimeBridge />
    <App />
    <CustomAlertHost />
  </React.StrictMode>,
);
