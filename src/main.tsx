import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { CustomAlertHost } from './app/components/CustomAlertHost';
import './styles/mobile-item-log-recovery.css';
import './styles/game-header-log-alignment.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <CustomAlertHost />
  </React.StrictMode>,
);
