import React, { createContext, useContext, useEffect, useReducer } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setAuthToken } from '../api/client';
import { AuthUser } from '../api/auth';

const TOKEN_KEY = 'pb_auth_token';
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
  signIn: (token: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, { status: 'loading' });

  useEffect(() => {
    (async () => {
      const [token, userJson] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      if (token && userJson) {
        setAuthToken(token);
        dispatch({ type: 'RESTORE_SIGNED_IN', token, user: JSON.parse(userJson) as AuthUser });
      } else {
        dispatch({ type: 'RESTORE_SIGNED_OUT' });
      }
    })();
  }, []);

  const signIn = async (token: string, user: AuthUser) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    setAuthToken(token);
    dispatch({ type: 'SIGN_IN', token, user });
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setAuthToken(null);
    dispatch({ type: 'SIGN_OUT' });
  };

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
