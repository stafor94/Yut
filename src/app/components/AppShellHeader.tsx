import { useEffect, useSyncExternalStore } from 'react';
import { requestGameEndDialogOpen } from '../flows/gameEndDialogPresentation';
import { publishPlayTimePresentation } from '../flows/playTimePresentation';
import { getRoomInfoCollapsed, resetRoomInfoCollapsed, subscribeRoomInfoPresentation, toggleRoomInfoCollapsed } from '../flows/roomInfoPresentation';

type AppShellHeaderProps = {
  activeRoomId: string;
  manualSequenceSyncing: boolean;
  nickname: string;
  playTimeText: string;
  screen: 'lobby' | 'waitingRoom' | 'game';
  serverStatus: string;
  serverStatusTone: string;
  soundEnabled: boolean;
  winner: string;
  onOpenNicknameDialog: () => void;
  onSyncLatestSequences: () => void;
  onToggleSoundEnabled: () => void;
};

export function AppShellHeader({ activeRoomId, manualSequenceSyncing, nickname, playTimeText, screen, serverStatus, serverStatusTone, soundEnabled, winner, onSyncLatestSequences, onToggleSoundEnabled }: AppShellHeaderProps) {
  const roomInfoCollapsed = useSyncExternalStore(subscribeRoomInfoPresentation, getRoomInfoCollapsed, getRoomInfoCollapsed);

  useEffect(() => {
    publishPlayTimePresentation({
      playTimeText,
      stopped: Boolean(winner),
      visible: screen === 'game',
    });
  }, [playTimeText, screen, winner]);

  useEffect(() => {
    if (screen !== 'game') resetRoomInfoCollapsed();
  }, [screen]);

  const openLobbySettings = () => {
    if (screen !== 'lobby') return;
    window.dispatchEvent(new Event('yut:lobby-settings'));
  };

  return <section className={`hero panel ${screen === 'game' ? 'game-header-with-end' : ''}`}>
    <div className="hero-copy" aria-hidden="true"></div>
    {screen === 'game' && roomInfoCollapsed && <button
      data-testid="game-room-info-toggle"
      className="game-room-info-toggle game-room-info-toggle-collapsed"
      type="button"
      aria-expanded="false"
      aria-controls="game-room-info-panel"
      aria-label="플레이어 목록 펼치기"
      onClick={toggleRoomInfoCollapsed}
    ><span className="game-room-info-toggle-direction" aria-hidden="true">▼</span><span className="game-room-info-toggle-label">펼치기</span></button>}
    <div className={`hero-actions ${screen === 'game' ? 'game-actions' : ''}`}>
      <button data-testid="lobby-nickname-display" className="nickname-chip" type="button" onClick={openLobbySettings} disabled={screen !== 'lobby'} aria-label={`설정 열기: ${nickname}`}><span aria-hidden="true">👤</span><span>{nickname}</span></button>
      <button className={`sound-controls sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" onClick={onToggleSoundEnabled} aria-label={`효과음 ${soundEnabled ? '켜짐' : '꺼짐'}`}><span className="sound-icon" aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span><span>{soundEnabled ? '켜짐' : '꺼짐'}</span></button>
      <button className={`status-card ${serverStatusTone}`} type="button" onClick={onSyncLatestSequences} disabled={manualSequenceSyncing || !activeRoomId || screen !== 'game'} aria-label={`서버 상태: ${serverStatus}. 최신 게임 상태 동기화`} title="최신 게임 상태 동기화"><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><span className="status-text">{serverStatus}</span></button>
    </div>
    {screen === 'game' && <button data-testid="game-end-button" className="game-end-button" type="button" onClick={requestGameEndDialogOpen} aria-label="게임 종료">종료</button>}
  </section>;
}
