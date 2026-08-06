import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { listenAuthState, signInAsGuest } from '../../services/firebase/firebaseAuth';
import { startAuthSession } from '../flows/authSessionInitialization';

export function useAuthSession(onAuthError: (message: string) => void) {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const rememberUser = (nextUser: User | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  };

  useEffect(() => startAuthSession(
    { listenAuthState, signInAsGuest },
    {
      onUser: rememberUser,
      onError: (error) => onAuthError(error instanceof Error ? error.message : '익명 로그인에 실패했습니다.'),
    },
  ), [onAuthError]);

  return { user, userRef, rememberUser };
}
