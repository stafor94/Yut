import { useEffect, useState } from 'react';
import {
  STORAGE_KEYS,
  getInitialNickname,
  getStoredBoolean,
  getStoredNumber,
  getStoredPlayMode,
  getStoredText,
  type PieceCount,
  type PlayMode,
} from '../appState';

export function useAppPreferences() {
  const [nickname, setNickname] = useState(() => getInitialNickname());
  const [nicknameDraft, setNicknameDraft] = useState(() => getInitialNickname());
  const [title, setTitle] = useState(() => getStoredText(STORAGE_KEYS.title, '친구들과 윷놀이'));
  const [playMode, setPlayMode] = useState<PlayMode>(() => getStoredPlayMode());
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4>(() => getStoredNumber(STORAGE_KEYS.maxPlayers, 4, [2, 3, 4] as const));
  const [itemMode, setItemMode] = useState(() => getStoredBoolean(STORAGE_KEYS.itemMode, true));
  const [stackedRollMode, setStackedRollMode] = useState(() => getStoredBoolean(STORAGE_KEYS.stackedRollMode, false));
  const [pieceCount, setPieceCount] = useState<PieceCount>(() => getStoredNumber(STORAGE_KEYS.pieceCount, 4, [1, 2, 3, 4] as const));
  const [soundEnabled, setSoundEnabled] = useState(() => getStoredBoolean(STORAGE_KEYS.soundEnabled, true));

  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.nickname, nickname); }, [nickname]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.title, title); }, [title]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.playMode, playMode); }, [playMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.maxPlayers, String(maxPlayers)); }, [maxPlayers]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.itemMode, String(itemMode)); }, [itemMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.stackedRollMode, String(stackedRollMode)); }, [stackedRollMode]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.pieceCount, String(pieceCount)); }, [pieceCount]);
  useEffect(() => { window.localStorage.setItem(STORAGE_KEYS.soundEnabled, String(soundEnabled)); }, [soundEnabled]);

  return {
    nickname,
    setNickname,
    nicknameDraft,
    setNicknameDraft,
    title,
    setTitle,
    playMode,
    setPlayMode,
    maxPlayers,
    setMaxPlayers,
    itemMode,
    setItemMode,
    stackedRollMode,
    setStackedRollMode,
    pieceCount,
    setPieceCount,
    soundEnabled,
    setSoundEnabled,
  };
}
