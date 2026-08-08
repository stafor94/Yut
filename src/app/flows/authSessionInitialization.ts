export type AuthSessionRuntime<TUser> = {
  listenAuthState: (callback: (user: TUser | null) => void) => () => void;
  signInAsGuest: () => Promise<TUser | null>;
};

type AuthSessionHandlers<TUser> = {
  onUser: (user: TUser | null) => void;
  onError: (error: unknown) => void;
};

export function startAuthSession<TUser>(
  runtime: AuthSessionRuntime<TUser>,
  handlers: AuthSessionHandlers<TUser>,
) {
  let active = true;
  let initialAuthStateReceived = false;
  let authenticatedUserEstablished = false;

  const applyUser = (user: TUser | null) => {
    if (active) handlers.onUser(user);
  };
  const applyAuthenticatedUser = (user: TUser) => {
    authenticatedUserEstablished = true;
    applyUser(user);
  };

  const unsubscribe = runtime.listenAuthState((user) => {
    if (user) applyAuthenticatedUser(user);
    else if (!authenticatedUserEstablished) applyUser(null);
    if (initialAuthStateReceived) return;
    initialAuthStateReceived = true;
    if (user) return;

    void runtime.signInAsGuest()
      .then((guestUser) => {
        if (guestUser) applyAuthenticatedUser(guestUser);
      })
      .catch((error) => {
        if (active) handlers.onError(error);
      });
  });

  return () => {
    active = false;
    unsubscribe();
  };
}
