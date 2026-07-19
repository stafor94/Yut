import { useRef, useState } from 'react';
import { createRoom, getRoom } from '../../features/room/services/roomService';
import { isFirebaseConfigured } from '../../services/firebase/firebaseApp';
import { signInAsGuest } from '../../services/firebase/firebaseAuth';
import { requestRoomCreation, type RequestRoomCreationParams, type RoomCreationRequest } from '../flows/roomCreationControllerFlow';

const defaultMakeRequestToken = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

export function useRoomCreationController(params: Omit<RequestRoomCreationParams, 'pendingRoomCreationRef' | 'runtime'>) {
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const pendingRoomCreationRef = useRef<RoomCreationRequest | null>(null);
  const creatingRoomRef = useRef(false);

  const handleCreateRoom = async () => {
    if (creatingRoomRef.current) return;
    creatingRoomRef.current = true;
    setIsCreatingRoom(true);
    try {
      await requestRoomCreation({
        ...params,
        pendingRoomCreationRef,
        runtime: { firebaseConfigured: isFirebaseConfigured, signInAsGuest, createRoom, getRoom, makeRequestToken: defaultMakeRequestToken },
      });
    } finally {
      creatingRoomRef.current = false;
      setIsCreatingRoom(false);
    }
  };

  return { isCreatingRoom, handleCreateRoom };
}
