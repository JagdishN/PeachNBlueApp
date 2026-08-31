import React, { createContext, useContext, useEffect, useReducer } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setAuthToken, setOnAuthExpired, setRefreshToken } from '../api/client';
import { AuthUser } from '../api/auth';

const TOKEN_KEY = 'pb_auth_token';
const REFRESH_TOKEN_KEY = 'pb_auth_refresh_token';
const USER_KEY = 'pb_auth_user';

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; token: string; user: AuthUser };

type AuthAction =
  | { type: 'RESTORE_SIGNED_IN'; token: string; user: AuthUser }
  | { type: 'RESTORE_SIGNED_OUT' }
  | { type: 'SIGN_IN'; token: string; user: AuthUser }
  | { type: 'SIGN_OUT' };

const reducer = (_state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'RESTORE_SIGNED_IN':
    case 'SIGN_IN':
      return { status: 'signedIn', token: action.token, user: action.user };
    case 'RESTORE_SIGNED_OUT':
    case 'SIGN_OUT':
      return { status: 'signedOut' };
  }
};

interface AuthContextValue {
  state: AuthState;
  signIn: (token: string, refreshToken: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        const [token, refreshTokenValue, userJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);

        if (token && refreshTokenValue && userJson) {
          setAuthToken(token);
          setRefreshToken(refreshTokenValue);
          dispatch({ type: 'RESTORE_SIGNED_IN', token, user: JSON.parse(userJson) as AuthUser });
        } else {
          dispatch({ type: 'RESTORE_SIGNED_OUT' });
        }
      } catch {
        // SecureStore is unavailable on this platform (e.g. web) — fall back
        // to signed-out rather than leaving auth state stuck on 'loading'.
        dispatch({ type: 'RESTORE_SIGNED_OUT' });
      }
    })();
  }, []);

  const signIn = async (token: string, refreshToken: string, user: AuthUser) => {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    } catch {
      // Persisting the session failed (e.g. SecureStore unavailable) — the
      // user is still signed in for this session, just not restored on relaunch.
    }
    setAuthToken(token);
    setRefreshToken(refreshToken);
    dispatch({ type: 'SIGN_IN', token, user });
  };

  const signOut = async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      await SecureStore.deleteItemAsync(USER_KEY);
    } catch {
      // Best-effort cleanup — proceed with signing out regardless.
    }
    setAuthToken(null);
    setRefreshToken(null);
    dispatch({ type: 'SIGN_OUT' });
  };

  // Lets api/client.ts fully sign the user out when the refresh token
  // itself has expired (the fixed 2-day session boundary), not just clear
  // the access token — registered/torn down with this provider's lifetime,
  // which in practice is the whole app's lifetime.
  useEffect(() => {
    setOnAuthExpired(() => {
      signOut();
    });
    return () => setOnAuthExpired(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
