import { useEffect, useSyncExternalStore } from 'react';
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

export function AppShellHeader({ activeRoomId, manualSequenceSyncing, nickname, playTimeText, screen, serverStatus, serverStatusTone, soundEnabled, winner, onOpenNicknameDialog, onSyncLatestSequences, onToggleSoundEnabled }: AppShellHeaderProps) {
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

  return <section className="hero panel">
    <div className="hero-copy" aria-hidden="true"></div>
    <div className={`hero-actions ${screen === 'game' ? 'game-actions' : ''}`}>
      {screen === 'game' && <button
        data-testid="game-room-info-toggle"
        className="game-room-header-toggle"
        type="button"
        aria-expanded={!roomInfoCollapsed}
        aria-controls="game-room-info-panel"
        aria-label={`방 정보 ${roomInfoCollapsed ? '펼치기' : '접기'}`}
        title={`방 정보 ${roomInfoCollapsed ? '펼치기' : '접기'}`}
        onClick={toggleRoomInfoCollapsed}
      ><span aria-hidden="true">{roomInfoCollapsed ? '▾' : '▴'}</span></button>}
      <button className="nickname-chip" type="button" onClick={onOpenNicknameDialog} disabled={screen !== 'lobby'} aria-label={`닉네임 수정: ${nickname}`}><span aria-hidden="true">👤</span><span>{nickname}</span></button>
      <button className={`sound-controls sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" onClick={onToggleSoundEnabled} aria-label={`효과음 ${soundEnabled ? '켜짐' : '꺼짐'}`}><span className="sound-icon" aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span><span>{soundEnabled ? '켜짐' : '꺼짐'}</span></button>
      <button className={`status-card ${serverStatusTone}`} type="button" onClick={onSyncLatestSequences} disabled={manualSequenceSyncing || !activeRoomId || screen !== 'game'} aria-label={`서버 상태: ${serverStatus}. 최신 게임 상태 동기화`} title="최신 게임 상태 동기화"><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><span className="status-text">{serverStatus}</span></button>
    </div>
  </section>;
}
