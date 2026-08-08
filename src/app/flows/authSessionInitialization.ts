export type AuthSessionRuntime<TUser> = {
  listenAuthState: (callback: (user: TUser | null) => void) => () => void;
  signInAsGuest: () => Promise<TUser | null>;
  restoreUser: (user: TUser) => Promise<void>;
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
  let authenticatedUser: TUser | null = null;
  let restorePromise: Promise<void> | null = null;

  const applyUser = (user: TUser | null) => {
    if (active) handlers.onUser(user);
  };
  const applyAuthenticatedUser = (user: TUser) => {
    authenticatedUser = user;
    applyUser(user);
  };
  const restoreAuthenticatedUser = () => {
    if (!active || !authenticatedUser || restorePromise) return;
    const userToRestore = authenticatedUser;
    restorePromise = runtime.restoreUser(userToRestore)
      .catch((error) => {
        if (!active) return;
        authenticatedUser = null;
        applyUser(null);
        handlers.onError(error);
      })
      .finally(() => {
        restorePromise = null;
      });
  };

  const unsubscribe = runtime.listenAuthState((user) => {
    if (user) applyAuthenticatedUser(user);
    else if (authenticatedUser) restoreAuthenticatedUser();
    else applyUser(null);
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