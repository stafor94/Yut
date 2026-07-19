import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { listenAuthState, signInAsGuest } from '../../services/firebase/firebaseAuth';

export function useAuthSession(onAuthError: (message: string) => void) {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const rememberUser = (nextUser: User | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  };

  useEffect(() => {
    let mounted = true;
    const applyUser = (nextUser: User | null) => { if (mounted) rememberUser(nextUser); };
    const unsubscribe = listenAuthState(applyUser);
    signInAsGuest()
      .then((nextUser) => {
        if (!nextUser) return;
        applyUser(nextUser);
      })
      .catch((error) => onAuthError(error.message));
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [onAuthError]);

  return { user, userRef, rememberUser };
}
