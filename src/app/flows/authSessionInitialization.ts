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

  const applyUser = (user: TUser | null) => {
    if (active) handlers.onUser(user);
  };

  const unsubscribe = runtime.listenAuthState((user) => {
    applyUser(user);
    if (initialAuthStateReceived) return;
    initialAuthStateReceived = true;
    if (user) return;

    void runtime.signInAsGuest()
      .then((guestUser) => {
        if (guestUser) applyUser(guestUser);
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
