import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { isRoomInGame, type RoomSummary } from '../../features/room/services/roomService';
import { getRoomRuleBadges, normalizeMaxPlayers } from '../appUtils';
import { NICKNAME_MAX_LENGTH, validateNickname } from '../appState';

type LobbyScreenProps = {
  title: string;
  rooms: RoomSummary[];
  isCreatingRoom: boolean;
  isFirebaseConfigured: boolean;
  currentUser: User | null;
  resumableRoomId: string;
  nickname: string;
  soundEnabled: boolean;
  onTitleChange: (title: string) => void;
  onCreateRoom: () => void;
  onOpenWaitingRoom: (room: RoomSummary) => Promise<void>;
  onJoinRoomByCode: (code: string) => Promise<void>;
  onNicknameChange: (nickname: string) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
};

type LobbyDialog = 'create' | 'join' | 'howto' | 'settings' | null;

const getErrorMessage = (error: unknown) => error instanceof Error && error.message
  ? error.message
  : '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

export function LobbyScreen({ title, rooms, isCreatingRoom, isFirebaseConfigured, currentUser, resumableRoomId, nickname, soundEnabled, onTitleChange, onCreateRoom, onOpenWaitingRoom, onJoinRoomByCode, onNicknameChange, onSoundEnabledChange }: LobbyScreenProps) {
  const [dialog, setDialog] = useState<LobbyDialog>(null);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [includeSpectatable, setIncludeSpectatable] = useState(true);
  const [code, setCode] = useState('');
  const [joinPending, setJoinPending] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState('');
  const [joinMessage, setJoinMessage] = useState('');
  const [settingsDraft, setSettingsDraft] = useState(nickname);
  const [settingsMessage, setSettingsMessage] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const nicknameValidation = validateNickname(settingsDraft);

  const closeDialog = useCallback(() => setDialog(null), []);
  const openDialog = (nextDialog: Exclude<LobbyDialog, null>) => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setJoinMessage('');
    setDialog(nextDialog);
  };

  useEffect(() => {
    if (!dialog) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus], input, button, [href], select, textarea');
      initialFocus?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [closeDialog, dialog]);

  const visibleRooms = useMemo(() => rooms.filter((room) => (!waitingOnly || !isRoomInGame(room)) && (includeSpectatable || !isRoomInGame(room))), [includeSpectatable, rooms, waitingOnly]);
  const getLobbyRoomBadges = (room: RoomSummary) => getRoomRuleBadges(room.playMode, normalizeMaxPlayers(room.maxPlayers, room.playMode), room.pieceCount ?? 4, room.itemMode, Boolean(room.stackedRollMode));
  const getLobbyRoomOccupancy = (room: RoomSummary) => {
    const maxPlayers = normalizeMaxPlayers(room.maxPlayers, room.playMode);
    const rawCurrentPlayers = Number(room.currentPlayers ?? room.playerIds?.length ?? 0);
    const currentPlayers = Number.isFinite(rawCurrentPlayers) ? Math.min(maxPlayers, Math.max(0, Math.trunc(rawCurrentPlayers))) : 0;
    return { currentPlayers, maxPlayers, label: `${currentPlayers}/${maxPlayers}명` };
  };
  const getRoomActionText = (room: RoomSummary) => {
    if (isFirebaseConfigured && !currentUser) return '준비 중';
    if (!isRoomInGame(room)) return '참가';
    return currentUser && resumableRoomId === room.id && room.playerIds?.includes(currentUser.uid) ? '참가' : '관전';
  };
  const openSettings = () => {
    setSettingsDraft(nickname);
    setSettingsMessage('');
    openDialog('settings');
  };
  const saveSettingsNickname = () => {
    if (!nicknameValidation.valid) return;
    onNicknameChange(nicknameValidation.value);
    setSettingsMessage('닉네임이 저장되었습니다.');
  };
  const submitCode = async () => {
    if (joinPending) return;
    setJoinPending(true);
    setJoinMessage('');
    try {
      await onJoinRoomByCode(code);
    } catch (error) {
      setJoinMessage(getErrorMessage(error));
    } finally {
      setJoinPending(false);
    }
  };
  const openRoom = async (room: RoomSummary) => {
    if (joinPending) return;
    setJoinPending(true);
    setJoiningRoomId(room.id);
    setJoinMessage('');
    try {
      await onOpenWaitingRoom(room);
    } catch (error) {
      setJoinMessage(getErrorMessage(error));
    } finally {
      setJoinPending(false);
      setJoiningRoomId('');
    }
  };

  return <section data-testid="lobby-screen" className="lobby-layout premium-lobby lobby-start" aria-label="윷놀이 시작 화면">
    <section className="panel lobby-hero-panel">
      <p className="section-kicker">실시간 온라인 윷놀이</p>
      <h1>친구들과 바로 즐기는 윷놀이</h1>
      <p className="lobby-hero-copy">방을 만들거나 공개 방에 참가해 모바일에서도 빠르게 시작하세요.</p>
      <div className="lobby-yut-visual" role="img" aria-label="윷가락 네 개 도식"><span></span><span></span><span></span><span></span></div>
      <div className="lobby-primary-actions" aria-label="로비 주요 기능">
        <button className="primary-cta" type="button" onClick={() => openDialog('create')}>방 만들기</button>
        <button className="primary-cta secondary-cta" type="button" onClick={() => openDialog('join')}>게임 참가</button>
        <button type="button" onClick={() => openDialog('howto')}>게임 방법</button>
        <button type="button" onClick={openSettings}>설정</button>
      </div>
    </section>

    {dialog === 'create' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet" role="dialog" aria-modal="true" aria-label="방 만들기" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button><p className="section-kicker">방 만들기</p><h2>새 방 만들기</h2><div className="form-grid lobby-form"><label htmlFor="room-title-input">방 제목<input id="room-title-input" data-testid="room-title-input" data-dialog-autofocus value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="친구들과 윷놀이" /></label><button data-testid="create-room-button" className="primary-cta create-room-submit-button" onClick={onCreateRoom} disabled={isCreatingRoom}>{isCreatingRoom ? <span className="button-loading" aria-hidden="true"></span> : null}{isCreatingRoom ? '생성 중...' : '방 생성하기'}</button></div></section></div>}

    {dialog === 'join' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet lobby-join-sheet" role="dialog" aria-modal="true" aria-label="게임 참가" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button><p className="section-kicker">게임 참가</p><h2>공개 방 찾기</h2><div className="code-join-row"><input data-dialog-autofocus value={code} onChange={(event) => { setCode(event.target.value); setJoinMessage(''); }} onKeyDown={(event) => { if (event.key === 'Enter') void submitCode(); }} placeholder="방 코드 입력" aria-label="방 코드 입력" /><button onClick={() => { void submitCode(); }} disabled={!code.trim() || joinPending}>{joinPending && !joiningRoomId ? '확인 중...' : '참가'}</button></div><div className="lobby-filter-row"><label><input type="checkbox" checked={waitingOnly} onChange={(event) => setWaitingOnly(event.target.checked)} /> 대기 중인 방만</label><label><input type="checkbox" checked={includeSpectatable} onChange={(event) => setIncludeSpectatable(event.target.checked)} /> 관전 가능 포함</label><span className="lobby-live-status" role="status">실시간 자동 갱신</span></div>{joinMessage && <p className="settings-feedback" role="alert">{joinMessage}</p>}<div className="room-list lobby-room-list">{visibleRooms.length ? visibleRooms.map((room) => { const badges = getLobbyRoomBadges(room); const occupancy = getLobbyRoomOccupancy(room); const roomStatus = isRoomInGame(room) ? '게임중' : '대기중'; return <article className="room-card lobby-room-card" key={room.id}><div className="lobby-room-content"><div className="lobby-room-main"><div className="lobby-room-title-row"><span className={`lobby-room-state-dot ${isRoomInGame(room) ? 'in-game' : 'waiting'}`} role="img" aria-label={roomStatus} title={roomStatus}></span><b>{room.title}</b></div><span className="lobby-room-meta" aria-label={`방 옵션: ${badges.map((badge) => badge.label).join(', ')}, 현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{roomStatus} · {badges.map((badge) => badge.label).join(' · ')}</span></div><span className="lobby-room-occupancy" aria-label={`현재 인원 ${occupancy.currentPlayers}/${occupancy.maxPlayers}`}>{occupancy.label}</span><button className="lobby-room-action" disabled={(isFirebaseConfigured && !currentUser) || joinPending} onClick={() => { void openRoom(room); }}>{joiningRoomId === room.id ? '입장 중...' : getRoomActionText(room)}</button></div></article>; }) : <div className="empty-lobby-room"><strong>표시할 공개 방이 없습니다</strong><p>방 목록은 실시간으로 갱신됩니다. 직접 방을 만들어 보세요.</p></div>}</div></section></div>}

    {dialog === 'howto' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet lobby-howto-sheet" role="dialog" aria-modal="true" aria-label="게임 방법" onMouseDown={(event) => event.stopPropagation()}><header><h2>게임 방법</h2><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button></header><div className="howto-list"><article><div className="howto-icon" role="img" aria-label="방 만들기 도식">＋</div><h3>게임 시작</h3><p>방 만들기로 대기실을 열거나 공개 방 목록에서 참가합니다. 초대받은 경우 방 코드를 입력해 같은 입장 흐름을 사용합니다.</p></article><article><div className="howto-icon" role="img" aria-label="윷 결과 도식">도개걸윷모</div><h3>윷 던지기</h3><p>도·개·걸·윷·모 결과로 말을 이동합니다. 낙은 이동하지 못하며, 윷이나 모처럼 추가 조건이 있는 결과는 남은 이동 스택에 표시됩니다.</p></article><article><div className="howto-icon" role="img" aria-label="말 이동 도식">●→●</div><h3>말 이동</h3><p>이동할 말과 갈림길을 선택합니다. 같은 편 말은 업을 수 있고, 상대 말을 잡으면 진행 기록에 남습니다.</p></article><article><div className="howto-icon" role="img" aria-label="재접속 도식">↻</div><h3>재접속과 관전</h3><p>플레이어가 이탈하면 AI가 이어서 플레이하고, 원래 플레이어가 돌아오면 통제권을 복구합니다. 관전자는 최신 상태와 진행 기록을 동기화해 중간 입장합니다.</p></article></div><button className="primary-cta" type="button" onClick={closeDialog}>확인하고 시작하기</button></section></div>}

    {dialog === 'settings' && <div className="lobby-sheet-backdrop" role="presentation" onMouseDown={closeDialog}><section ref={dialogRef} className="panel lobby-sheet" role="dialog" aria-modal="true" aria-label="설정" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" type="button" onClick={closeDialog} aria-label="닫기">×</button><p className="section-kicker">설정</p><h2>사용자 설정</h2><label>닉네임<input data-dialog-autofocus value={settingsDraft} maxLength={NICKNAME_MAX_LENGTH} onChange={(event) => { setSettingsDraft(event.target.value); setSettingsMessage(''); }} onKeyDown={(event) => { if (event.key === 'Enter') saveSettingsNickname(); }} aria-invalid={!nicknameValidation.valid} /></label><p className="nickname-helper">{settingsDraft.length}/{NICKNAME_MAX_LENGTH} · {nicknameValidation.valid ? '사용 가능한 닉네임입니다.' : nicknameValidation.message}</p><button className="primary-cta" type="button" onClick={saveSettingsNickname} disabled={!nicknameValidation.valid}>닉네임 저장</button>{settingsMessage && <p className="settings-feedback" role="status">{settingsMessage}</p>}<label className="sound-switch"><span>효과음</span><input type="checkbox" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} /><strong>{soundEnabled ? 'ON' : 'OFF'}</strong></label></section></div>}
  </section>;
}
