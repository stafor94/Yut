import { useEffect } from 'react';
import { publishPlayTimePresentation } from '../flows/playTimePresentation';

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
  useEffect(() => {
    publishPlayTimePresentation({
      playTimeText,
      stopped: Boolean(winner),
      visible: screen === 'game',
    });
  }, [playTimeText, screen, winner]);

  return <section className="hero panel">
    <div className="hero-copy" aria-hidden="true"></div>
    <div className="hero-actions">
      <button className="nickname-chip" type="button" onClick={onOpenNicknameDialog} disabled={screen !== 'lobby'} aria-label={`닉네임 수정: ${nickname}`}><span aria-hidden="true">👤</span><span>{nickname}</span></button>
      <button className={`sound-controls sound-toggle ${soundEnabled ? 'active' : ''}`} type="button" onClick={onToggleSoundEnabled} aria-label={`효과음 ${soundEnabled ? '켜짐' : '꺼짐'}`}><span className="sound-icon" aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span><span>{soundEnabled ? '켜짐' : '꺼짐'}</span></button>
      <button className={`status-card ${serverStatusTone}`} type="button" onClick={onSyncLatestSequences} disabled={manualSequenceSyncing || !activeRoomId || screen !== 'game'} aria-label={`서버 상태: ${serverStatus}. 최신 게임 상태 동기화`} title="최신 게임 상태 동기화"><span className={`status-dot ${serverStatusTone}`} aria-hidden="true"></span><span className="status-text">{serverStatus}</span></button>
    </div>
  </section>;
}
